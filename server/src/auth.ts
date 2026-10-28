import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { cfg } from './config.js';
import { sql } from './db.js';
import { ErroApi, userAgent } from './http.js';

const scrypt = promisify(scryptCb) as (senha: string, salt: Buffer, keylen: number, opts: object) => Promise<Buffer>;
const N = 2 ** 15, R = 8, P = 1, TAM = 32;
const MAXMEM = 128 * N * R * 2;

export async function hashSenha(senha: string): Promise<string> {
  const salt = randomBytes(16);
  const h = await scrypt(senha.normalize('NFKC'), salt, TAM, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${Math.log2(N)}$${R}$${P}$${salt.toString('base64url')}$${h.toString('base64url')}`;
}

export async function verificarSenha(senha: string, armazenado: string | null): Promise<boolean> {
  // sem senha cadastrada ainda gasta o mesmo tempo, para não revelar o estado
  const partes = (armazenado ?? `scrypt$15$8$1$${randomBytes(16).toString('base64url')}$${randomBytes(32).toString('base64url')}`).split('$');
  if (partes.length !== 6 || partes[0] !== 'scrypt') return false;
  const [, logN, r, p, saltB64, hashB64] = partes;
  const n = 2 ** Number(logN);
  const esperado = Buffer.from(hashB64, 'base64url');
  const h = await scrypt(senha.normalize('NFKC'), Buffer.from(saltB64, 'base64url'), esperado.length, {
    N: n, r: Number(r), p: Number(p), maxmem: 128 * n * Number(r) * 2,
  });
  return armazenado !== null && h.length === esperado.length && timingSafeEqual(h, esperado);
}

export function sha256(texto: string): string {
  return createHash('sha256').update(texto).digest('hex');
}

export function comparaSegredo(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb) && a.length > 0;
}

export type Sessao = {
  id: string;
  metodo: string;
  passkey_id: string | null;
  bloqueio_min: number | null;
  desbloqueado_ate: Date | null;
  criado_em: Date;
  ultimo_uso: Date;
  bloqueada: boolean;
};

declare module 'fastify' {
  interface FastifyRequest {
    sessao?: Sessao | null;
  }
}

export async function evento(tipo: string, ok: boolean, req: FastifyRequest | null, detalhe?: Record<string, unknown>): Promise<void> {
  try {
    await sql`INSERT INTO financ_app.eventos (tipo, ok, ip, user_agent, detalhe)
              VALUES (${tipo}, ${ok}, ${req?.ip ?? null}, ${req ? userAgent(req) : null}, ${detalhe ? sql.json(detalhe as never) : null})`;
  } catch (e) {
    req?.log.error(e, 'falha ao registrar evento');
  }
}

export async function criarSessao(
  req: FastifyRequest,
  reply: FastifyReply,
  opts: { metodo: 'senha' | 'digital' | 'setup'; passkeyId?: string | null; bloqueioMin?: number | null },
): Promise<void> {
  const token = randomBytes(32).toString('base64url');
  const bloqueio = opts.bloqueioMin === undefined ? null : opts.bloqueioMin;
  await sql`
    INSERT INTO financ_app.sessoes (id, expira_em, metodo, passkey_id, bloqueio_min, desbloqueado_ate, user_agent, ip)
    VALUES (${sha256(token)}, now() + make_interval(days => ${cfg.sessaoDias}), ${opts.metodo}, ${opts.passkeyId ?? null},
            ${bloqueio}, CASE WHEN ${bloqueio}::int IS NULL THEN NULL ELSE now() + make_interval(mins => ${bloqueio}::int) END,
            ${userAgent(req)}, ${req.ip})`;
  reply.setCookie(cfg.cookie, token, {
    httpOnly: true,
    secure: cfg.https,
    sameSite: 'strict',
    path: '/',
    maxAge: cfg.sessaoDias * 86400,
  });
}

export function limparCookie(reply: FastifyReply): void {
  reply.clearCookie(cfg.cookie, { path: '/', secure: cfg.https, httpOnly: true, sameSite: 'strict' });
}

/** Lê a sessão do cookie (sem decidir se pode acessar dados). */
export async function lerSessao(req: FastifyRequest): Promise<Sessao | null> {
  if (req.sessao !== undefined) return req.sessao;
  const token = req.cookies?.[cfg.cookie];
  if (!token || token.length > 100) {
    req.sessao = null;
    return null;
  }
  const [s] = await sql<Omit<Sessao, 'bloqueada'>[]>`
    SELECT id, metodo, passkey_id, bloqueio_min, desbloqueado_ate, criado_em, ultimo_uso
      FROM financ_app.sessoes
     WHERE id = ${sha256(token)} AND revogada_em IS NULL AND expira_em > now()`;
  if (!s) {
    req.sessao = null;
    return null;
  }
  const bloqueada = s.bloqueio_min !== null && (!s.desbloqueado_ate || s.desbloqueado_ate.getTime() < Date.now());
  req.sessao = { ...s, bloqueada };
  return req.sessao;
}

/**
 * Exige sessão válida e desbloqueada. Cada uso empurra o bloqueio automático para frente
 * (o app só chama a API com a tela aberta) e renova a validade da sessão.
 */
export async function exigirSessao(req: FastifyRequest, opts: { permitirBloqueada?: boolean } = {}): Promise<Sessao> {
  const s = await lerSessao(req);
  if (!s) throw new ErroApi(401, 'Entre para continuar', 'sem_sessao');
  if (s.bloqueada && !opts.permitirBloqueada) throw new ErroApi(423, 'App bloqueado', 'bloqueado');
  if (!s.bloqueada) await tocarSessao(s);
  return s;
}

export async function tocarSessao(s: Sessao): Promise<void> {
  await sql`
    UPDATE financ_app.sessoes
       SET ultimo_uso = now(),
           expira_em = now() + make_interval(days => ${cfg.sessaoDias}),
           desbloqueado_ate = CASE WHEN bloqueio_min IS NULL THEN NULL ELSE now() + make_interval(mins => bloqueio_min) END
     WHERE id = ${s.id}`;
}

export async function desbloquearSessao(s: Sessao, passkeyId?: string | null): Promise<void> {
  await sql`
    UPDATE financ_app.sessoes
       SET desbloqueado_ate = CASE WHEN bloqueio_min IS NULL THEN NULL ELSE now() + make_interval(mins => bloqueio_min) END,
           ultimo_uso = now(),
           passkey_id = COALESCE(passkey_id, ${passkeyId ?? null})
     WHERE id = ${s.id}`;
}

/** Controle de tentativas de senha (usuário único). */
export async function senhaBloqueadaAte(): Promise<Date | null> {
  const [u] = await sql<{ bloqueado_ate: Date | null }[]>`SELECT bloqueado_ate FROM financ_app.usuario WHERE id = 1`;
  return u?.bloqueado_ate && u.bloqueado_ate.getTime() > Date.now() ? u.bloqueado_ate : null;
}

export async function registrarFalhaSenha(): Promise<void> {
  // a cada 5 falhas seguidas: 15 min, 30 min, 1 h... até 24 h
  await sql`
    UPDATE financ_app.usuario
       SET falhas = falhas + 1,
           bloqueado_ate = CASE WHEN (falhas + 1) % 5 = 0
                                THEN now() + LEAST(interval '24 hours', interval '15 minutes' * power(2, (falhas + 1) / 5 - 1))
                                ELSE bloqueado_ate END
     WHERE id = 1`;
}

export async function zerarFalhasSenha(): Promise<void> {
  await sql`UPDATE financ_app.usuario SET falhas = 0, bloqueado_ate = NULL WHERE id = 1`;
}

export function validarForcaSenha(senha: string): string | null {
  if (senha.length < 10) return 'Use pelo menos 10 caracteres.';
  if (senha.length > 200) return 'Senha longa demais.';
  if (/^(.)\1+$/.test(senha)) return 'Evite repetir o mesmo caractere.';
  const tipos = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(senha)).length;
  if (tipos < 2 && senha.length < 16) return 'Misture letras e números, ou use uma frase com 16+ caracteres.';
  return null;
}
