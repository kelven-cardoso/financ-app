import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { comparaSegredo, evento, exigirSessao } from '../auth.js';
import { sql } from '../db.js';
import { corpo, ErroApi, semCache } from '../http.js';

/** App Android (android/): pacote e impressão digital do certificado que assina o APK (dado público). */
const PACOTE_ANDROID = 'tech.kelvencardoso.financ';
const CERTIFICADO_ANDROID = 'EF:F9:4C:45:C5:33:BE:D0:01:6E:26:F0:85:C4:EB:75:BA:A5:1F:BC:F6:CB:EE:A0:F1:51:AE:2C:C6:12:24:47';

/** Nunca guardar nem repassar código de segurança, senha ou token que venha numa notificação. */
const SENSIVEL = /(c[oó]digo|senha|token|verifica[cç][aã]o|autentica[cç][aã]o)/i;
const DINHEIRO = /R\$\s?\d/;

const zChave = z.string().regex(/^[A-Za-z0-9_-]{32,128}$/, 'chave inválida');

async function config(chave: string): Promise<string | null> {
  const [r] = await sql<{ v: string | null }[]>`SELECT financ.fn_config(${chave}) AS v`;
  return r?.v || null;
}

/** Repassa ao n8n ("Notificação → lançamento") o que ainda não foi; devolve quantas seguiram. */
export async function encaminharPendentes(): Promise<number> {
  const [url, chave] = await Promise.all([config('notif_webhook_url'), config('notif_token')]);
  if (!url || !chave) return 0;
  const pendentes = await sql<{ id: string; evento_id: string; app: string | null; titulo: string | null; texto: string | null; quando: Date | null }[]>`
    SELECT id, evento_id, app, titulo, texto, quando
      FROM financ.notif_capturas
     WHERE NOT encaminhado AND tentativas < 30 AND recebido_em > now() - interval '3 days'
     ORDER BY id
     LIMIT 20`;
  let enviados = 0;
  for (const p of pendentes) {
    let ok = false;
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-financ-chave': chave },
        body: JSON.stringify({ app: p.app ?? '', titulo: p.titulo ?? '', texto: p.texto ?? '', data: p.quando ? String(p.quando.getTime()) : '', id: p.evento_id }),
        signal: AbortSignal.timeout(10000),
      });
      ok = r.ok;
    } catch {
      ok = false;
    }
    await sql`
      UPDATE financ.notif_capturas
         SET encaminhado = ${ok}, tentativas = tentativas + 1, encaminhado_em = CASE WHEN ${ok} THEN now() ELSE encaminhado_em END
       WHERE id = ${p.id}`;
    if (ok) enviados++;
  }
  return enviados;
}

export async function rotasCaptura(app: FastifyInstance): Promise<void> {
  // Digital Asset Links: prova para o Android/Chrome que o APK e este site são do mesmo dono (tela cheia, sem barra)
  app.get('/.well-known/assetlinks.json', async (_req, reply) => {
    reply.header('Cache-Control', 'public, max-age=3600');
    reply.type('application/json');
    return [
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: { namespace: 'android_app', package_name: PACOTE_ANDROID, sha256_cert_fingerprints: [CERTIFICADO_ANDROID] },
      },
    ];
  });

  // situação da captura, para a tela Ajustes › Captura de notificações
  app.get('/api/captura', async (req, reply) => {
    semCache(reply);
    await exigirSessao(req);
    const [pareado, ultimas, [tot]] = await Promise.all([
      config('notif_token'),
      sql`SELECT id, recebido_em, quando, app, titulo, texto, encaminhado FROM financ.notif_capturas ORDER BY id DESC LIMIT 20`,
      sql<{ n7: number; pendentes: number }[]>`
        SELECT count(*) FILTER (WHERE recebido_em > now() - interval '7 days')::int AS n7,
               count(*) FILTER (WHERE NOT encaminhado AND recebido_em > now() - interval '3 days')::int AS pendentes
          FROM financ.notif_capturas`,
    ]);
    return { pareado: Boolean(pareado), ultimos_7_dias: tot?.n7 ?? 0, aguardando_repasse: tot?.pendentes ?? 0, ultimas };
  });

  // pareamento: o app Android gera a chave e a entrega aqui, de dentro do app já logado
  app.post('/api/captura/parear', async (req) => {
    await exigirSessao(req);
    const d = corpo(z.object({ chave: zChave }), req);
    await sql`
      INSERT INTO financ.config (chave, valor) VALUES ('notif_token', ${d.chave})
      ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = now()`;
    await evento('captura_pareada', true, req);
    return { ok: true };
  });

  // desfaz o pareamento: o aparelho pareado deixa de ser aceito
  app.post('/api/captura/desparear', async (req) => {
    await exigirSessao(req);
    await sql`DELETE FROM financ.config WHERE chave = 'notif_token'`;
    await evento('captura_despareada', true, req);
    return { ok: true };
  });

  // o app Android entrega uma notificação (sem sessão: vale a chave do aparelho pareado)
  app.post('/api/captura/notificacao', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req) => {
    const recebida = String(req.headers['x-financ-chave'] ?? '');
    const esperada = await config('notif_token');
    if (!esperada || !recebida || !comparaSegredo(recebida, esperada)) throw new ErroApi(401, 'Aparelho não pareado', 'nao_pareado');
    const d = corpo(
      z.object({
        teste: z.boolean().optional(),
        id: z.string().min(8).max(128).optional(),
        app: z.string().max(80).optional(),
        pacote: z.string().max(160).optional(),
        titulo: z.string().max(300).optional(),
        texto: z.string().max(4000).optional(),
        quando: z.number().int().positive().optional(),
      }),
      req,
    );
    if (d.teste) return { ok: true, teste: true };
    const titulo = (d.titulo ?? '').trim();
    const texto = (d.texto ?? '').trim();
    if (!d.id || (!titulo && !texto)) throw new ErroApi(400, 'Notificação sem conteúdo', 'invalido');
    const tudo = `${titulo}\n${texto}`;
    if (SENSIVEL.test(tudo) || !DINHEIRO.test(tudo)) return { ok: true, ignorada: true };
    const quando = d.quando && d.quando > 1_500_000_000_000 && d.quando < Date.now() + 86_400_000 ? new Date(d.quando) : new Date();
    const [nova] = await sql<{ id: string }[]>`
      INSERT INTO financ.notif_capturas (evento_id, quando, app, pacote, titulo, texto)
      VALUES (${d.id}, ${quando}, ${d.app ?? null}, ${d.pacote ?? null}, ${titulo || null}, ${texto || null})
      ON CONFLICT (evento_id) DO NOTHING
      RETURNING id`;
    if (nova) void encaminharPendentes().catch((e) => req.log.error(e, 'captura: repasse'));
    return { ok: true, nova: Boolean(nova) };
  });
}
