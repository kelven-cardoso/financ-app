import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  comparaSegredo, criarSessao, desbloquearSessao, evento, exigirSessao, hashSenha, lerSessao, limparCookie,
  registrarFalhaSenha, senhaBloqueadaAte, sha256, validarForcaSenha, verificarSenha, zerarFalhasSenha,
} from '../auth.js';
import { cfg } from '../config.js';
import { sql } from '../db.js';
import { corpo, ErroApi, semCache } from '../http.js';
import { opcoesAutenticacao, opcoesRegistro, verificarAutenticacao, verificarRegistro } from '../webauthn.js';

const limiteAuth = { config: { rateLimit: { max: 12, timeWindow: '1 minute' } } };

function horaSP(d: Date): string {
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
}

async function revogarSessaoAtual(req: FastifyRequest): Promise<void> {
  const s = await lerSessao(req);
  if (s) await sql`UPDATE financ_app.sessoes SET revogada_em = now() WHERE id = ${s.id}`;
}

export async function rotasAuth(app: FastifyInstance): Promise<void> {
  app.get('/api/auth/estado', async (req, reply) => {
    semCache(reply);
    const [u] = await sql<{ configurado: boolean; digitais: number }[]>`
      SELECT senha_hash IS NOT NULL AS configurado, (SELECT count(*)::int FROM financ_app.passkeys) AS digitais
        FROM financ_app.usuario WHERE id = 1`;
    const s = await lerSessao(req);
    return {
      configurado: u.configurado,
      digitais: u.digitais,
      sessao: s ? { metodo: s.metodo, bloqueada: s.bloqueada, bloqueio_min: s.bloqueio_min, digital_vinculada: !!s.passkey_id } : null,
      versao: cfg.versao,
    };
  });

  app.post('/api/auth/setup', limiteAuth, async (req, reply) => {
    const { token, senha } = corpo(z.object({ token: z.string().min(16).max(200), senha: z.string().min(1).max(200) }), req);
    const [u] = await sql<{ setup_token_hash: string | null }[]>`SELECT setup_token_hash FROM financ_app.usuario WHERE id = 1`;
    if (!cfg.setupToken || !comparaSegredo(token, cfg.setupToken) || u.setup_token_hash === sha256(token)) {
      await evento('senha_criada', false, req);
      throw new ErroApi(403, 'Este link de configuração não vale mais. Para criar uma nova senha, troque o SETUP_TOKEN no Easypanel.', 'setup_invalido');
    }
    const fraca = validarForcaSenha(senha);
    if (fraca) throw new ErroApi(400, fraca, 'senha_fraca');
    await sql`
      UPDATE financ_app.usuario
         SET senha_hash = ${await hashSenha(senha)}, senha_alterada_em = now(), setup_token_hash = ${sha256(token)},
             falhas = 0, bloqueado_ate = NULL
       WHERE id = 1`;
    // criar a senha pelo link também serve de recuperação: encerra todas as sessões abertas
    await sql`UPDATE financ_app.sessoes SET revogada_em = now() WHERE revogada_em IS NULL`;
    await evento('senha_criada', true, req);
    await criarSessao(req, reply, { metodo: 'setup' });
    return { ok: true };
  });

  app.post('/api/auth/login', limiteAuth, async (req, reply) => {
    const { senha } = corpo(z.object({ senha: z.string().min(1).max(200) }), req);
    const ate = await senhaBloqueadaAte();
    if (ate) throw new ErroApi(429, `Muitas tentativas com senha. Tente de novo às ${horaSP(ate)} ou entre com a digital.`, 'muitas_tentativas');
    const [u] = await sql<{ senha_hash: string | null }[]>`SELECT senha_hash FROM financ_app.usuario WHERE id = 1`;
    if (!(await verificarSenha(senha, u.senha_hash))) {
      await registrarFalhaSenha();
      await evento('entrada_senha', false, req);
      throw new ErroApi(401, 'Senha incorreta.', 'senha_incorreta');
    }
    await zerarFalhasSenha();
    await revogarSessaoAtual(req);
    await criarSessao(req, reply, { metodo: 'senha' });
    await evento('entrada_senha', true, req);
    return { ok: true };
  });

  app.post('/api/auth/digital/opcoes', limiteAuth, async (req, reply) => {
    semCache(reply);
    const { fluxo } = corpo(z.object({ fluxo: z.enum(['entrar', 'desbloquear']) }), req);
    if (fluxo === 'desbloquear') {
      const s = await exigirSessao(req, { permitirBloqueada: true });
      return opcoesAutenticacao('desbloquear', s.id, s.passkey_id);
    }
    return opcoesAutenticacao('entrar', null, null);
  });

  app.post('/api/auth/digital/verificar', limiteAuth, async (req, reply) => {
    const { fluxo, resposta } = corpo(
      z.object({ fluxo: z.enum(['entrar', 'desbloquear']), resposta: z.object({ id: z.string().max(400) }).passthrough() }),
      req,
    );
    if (fluxo === 'desbloquear') {
      const s = await exigirSessao(req, { permitirBloqueada: true });
      try {
        const pk = await verificarAutenticacao('desbloquear', s.id, resposta as never);
        await desbloquearSessao(s, pk.id);
        await evento('desbloqueio_digital', true, req, { aparelho: pk.nome });
      } catch (e) {
        await evento('desbloqueio_digital', false, req);
        throw e;
      }
      return { ok: true };
    }
    try {
      const pk = await verificarAutenticacao('entrar', null, resposta as never);
      await revogarSessaoAtual(req);
      await criarSessao(req, reply, { metodo: 'digital', passkeyId: pk.id, bloqueioMin: cfg.bloqueioPadraoMin });
      await evento('entrada_digital', true, req, { aparelho: pk.nome });
    } catch (e) {
      await evento('entrada_digital', false, req);
      throw e;
    }
    return { ok: true };
  });

  app.post('/api/auth/desbloquear', limiteAuth, async (req) => {
    const s = await exigirSessao(req, { permitirBloqueada: true });
    const { senha } = corpo(z.object({ senha: z.string().min(1).max(200) }), req);
    const ate = await senhaBloqueadaAte();
    if (ate) throw new ErroApi(429, `Muitas tentativas com senha. Tente de novo às ${horaSP(ate)} ou use a digital.`, 'muitas_tentativas');
    const [u] = await sql<{ senha_hash: string | null }[]>`SELECT senha_hash FROM financ_app.usuario WHERE id = 1`;
    if (!(await verificarSenha(senha, u.senha_hash))) {
      await registrarFalhaSenha();
      await evento('desbloqueio_senha', false, req);
      throw new ErroApi(401, 'Senha incorreta.', 'senha_incorreta');
    }
    await zerarFalhasSenha();
    await desbloquearSessao(s);
    await evento('desbloqueio_senha', true, req);
    return { ok: true };
  });

  app.post('/api/auth/sair', async (req, reply) => {
    await revogarSessaoAtual(req);
    limparCookie(reply);
    return { ok: true };
  });

  app.post('/api/auth/digital/registro/opcoes', async (req, reply) => {
    semCache(reply);
    const s = await exigirSessao(req);
    return opcoesRegistro(s.id);
  });

  app.post('/api/auth/digital/registro', async (req) => {
    const s = await exigirSessao(req);
    const { resposta, nome } = corpo(
      z.object({ resposta: z.object({ id: z.string().max(400) }).passthrough(), nome: z.string().trim().min(1).max(40) }),
      req,
    );
    const id = await verificarRegistro(s.id, resposta as never, nome);
    await sql`
      UPDATE financ_app.sessoes
         SET passkey_id = ${id},
             bloqueio_min = COALESCE(bloqueio_min, ${cfg.bloqueioPadraoMin}::int),
             desbloqueado_ate = now() + make_interval(mins => COALESCE(bloqueio_min, ${cfg.bloqueioPadraoMin}::int))
       WHERE id = ${s.id}`;
    await evento('digital_adicionada', true, req, { aparelho: nome });
    return { ok: true, id };
  });
}
