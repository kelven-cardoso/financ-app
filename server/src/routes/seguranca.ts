import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { evento, exigirSessao, hashSenha, validarForcaSenha, verificarSenha } from '../auth.js';
import { sql } from '../db.js';
import { corpo, ErroApi, semCache } from '../http.js';
import { chaveSpki } from '../webauthn.js';

export async function rotasSeguranca(app: FastifyInstance): Promise<void> {
  app.get('/api/seguranca', async (req, reply) => {
    semCache(reply);
    const s = await exigirSessao(req);
    const [sessoes, digitais, eventos, [u]] = await Promise.all([
      sql`SELECT id, criado_em, ultimo_uso, metodo, user_agent, ip, bloqueio_min, (id = ${s.id}) AS atual,
                 (SELECT nome FROM financ_app.passkeys p WHERE p.id = s.passkey_id) AS digital
            FROM financ_app.sessoes s
           WHERE revogada_em IS NULL AND expira_em > now()
           ORDER BY (id = ${s.id}) DESC, ultimo_uso DESC`,
      sql`SELECT id, nome, criado_em, ultimo_uso, tipo_dispositivo, sincronizada FROM financ_app.passkeys ORDER BY criado_em`,
      sql`SELECT criado_em, tipo, ok, ip, user_agent, detalhe FROM financ_app.eventos ORDER BY criado_em DESC LIMIT 40`,
      sql<{ senha_alterada_em: Date | null }[]>`SELECT senha_alterada_em FROM financ_app.usuario WHERE id = 1`,
    ]);
    return {
      sessao_atual: { bloqueio_min: s.bloqueio_min, metodo: s.metodo, digital_vinculada: s.passkey_id },
      sessoes,
      digitais,
      eventos,
      senha_alterada_em: u.senha_alterada_em,
    };
  });

  // chaves públicas das digitais, para o app conferir o desbloqueio quando estiver sem internet
  app.get('/api/seguranca/chaves-locais', async (req, reply) => {
    semCache(reply);
    await exigirSessao(req);
    const linhas = await sql<{ id: string; chave_publica: Uint8Array }[]>`SELECT id, chave_publica FROM financ_app.passkeys`;
    return linhas.map((p) => ({ id: p.id, ...chaveSpki(new Uint8Array(p.chave_publica)) })).filter((p) => 'spki' in p && p.spki);
  });

  app.put('/api/seguranca/bloqueio', async (req) => {
    const s = await exigirSessao(req);
    const { minutos } = corpo(z.object({ minutos: z.union([z.null(), z.number().int().min(1).max(1440)]) }), req);
    await sql`
      UPDATE financ_app.sessoes
         SET bloqueio_min = ${minutos},
             desbloqueado_ate = CASE WHEN ${minutos}::int IS NULL THEN NULL ELSE now() + make_interval(mins => ${minutos}::int) END
       WHERE id = ${s.id}`;
    await evento('bloqueio_alterado', true, req, { minutos });
    return { ok: true };
  });

  app.patch('/api/seguranca/digitais/:id', async (req) => {
    await exigirSessao(req);
    const id = String((req.params as { id: string }).id);
    const { nome } = corpo(z.object({ nome: z.string().trim().min(1).max(40) }), req);
    const r = await sql`UPDATE financ_app.passkeys SET nome = ${nome} WHERE id = ${id} RETURNING id`;
    if (!r.length) throw new ErroApi(404, 'Digital não encontrada');
    return { ok: true };
  });

  app.delete('/api/seguranca/digitais/:id', async (req) => {
    await exigirSessao(req);
    const id = String((req.params as { id: string }).id);
    const [r] = await sql<{ nome: string }[]>`DELETE FROM financ_app.passkeys WHERE id = ${id} RETURNING nome`;
    if (!r) throw new ErroApi(404, 'Digital não encontrada');
    await evento('digital_removida', true, req, { aparelho: r.nome });
    return { ok: true };
  });

  app.delete('/api/seguranca/sessoes/:id', async (req) => {
    const s = await exigirSessao(req);
    const id = String((req.params as { id: string }).id);
    if (id === s.id) throw new ErroApi(400, 'Para encerrar esta sessão, use Sair.');
    await sql`UPDATE financ_app.sessoes SET revogada_em = now() WHERE id = ${id} AND revogada_em IS NULL`;
    await evento('sessao_encerrada', true, req);
    return { ok: true };
  });

  app.post('/api/seguranca/sessoes/encerrar-outras', async (req) => {
    const s = await exigirSessao(req);
    const r = await sql`UPDATE financ_app.sessoes SET revogada_em = now() WHERE id <> ${s.id} AND revogada_em IS NULL RETURNING id`;
    await evento('sessoes_encerradas', true, req, { quantidade: r.length });
    return { ok: true, encerradas: r.length };
  });

  app.post('/api/seguranca/senha', { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } }, async (req) => {
    const s = await exigirSessao(req);
    const { atual, nova } = corpo(z.object({ atual: z.string().min(1).max(200), nova: z.string().min(1).max(200) }), req);
    const [u] = await sql<{ senha_hash: string | null }[]>`SELECT senha_hash FROM financ_app.usuario WHERE id = 1`;
    if (!(await verificarSenha(atual, u.senha_hash))) {
      await evento('senha_alterada', false, req);
      throw new ErroApi(401, 'A senha atual não confere.', 'senha_incorreta');
    }
    const fraca = validarForcaSenha(nova);
    if (fraca) throw new ErroApi(400, fraca, 'senha_fraca');
    await sql`UPDATE financ_app.usuario SET senha_hash = ${await hashSenha(nova)}, senha_alterada_em = now() WHERE id = 1`;
    await sql`UPDATE financ_app.sessoes SET revogada_em = now() WHERE id <> ${s.id} AND revogada_em IS NULL`;
    await evento('senha_alterada', true, req);
    return { ok: true };
  });
}
