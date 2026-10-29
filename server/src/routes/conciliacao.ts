import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { comparaSegredo, evento, exigirSessao } from '../auth.js';
import { cfg } from '../config.js';
import { sql } from '../db.js';
import { lerFaturaNubank, textoDoPdf } from '../fatura.js';
import { corpo, ErroApi, semCache, zMes } from '../http.js';
import { snapshot } from '../snapshot.js';

type Json = Record<string, unknown>;
const LIMITE_PDF = 10 * 1024 * 1024;
const limiteImport = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } }, bodyLimit: LIMITE_PDF };

async function funcao(fn: 'fn_importar_fatura' | 'fn_conciliacao_fatura' | 'fn_aplicar_conciliacao', params: Json): Promise<Json> {
  const [r] = await sql.begin(async (tx) => tx`SELECT financ.${tx(fn)}(${tx.json(params as never)}) AS r`);
  const res = (r as unknown as { r: Json }).r;
  if (!res || res.ok === false) {
    const codigo = String(res?.codigo ?? 'regra');
    throw new ErroApi(codigo === 'sem_importacao' ? 404 : 422, String(res?.erro ?? 'Não foi possível concluir'), codigo);
  }
  return res;
}

async function importarPdf(pdf: Buffer, extra: { cartao_id?: number; origem: 'app' | 'email'; arquivo?: string; resumido?: boolean }) {
  const lida = lerFaturaNubank(await textoDoPdf(pdf));
  return funcao('fn_importar_fatura', { ...lida, ...extra });
}

const brl = (v: unknown) => Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** Texto do WhatsApp com o resultado da leitura (o n8n só repassa). */
function mensagem(c: Json): string {
  const imp = c.importacao as Json;
  const n = (c.contagem ?? {}) as Record<string, number>;
  const t = (c.totais ?? {}) as Record<string, number>;
  const comp = String(imp.competencia ?? '');
  const venc = String(imp.vencimento ?? '');
  const linhas = [
    `📄 *Fatura ${imp.cartao} de ${MESES[Number(comp.slice(5, 7)) - 1] ?? comp}* (vence ${venc.slice(8, 10)}/${venc.slice(5, 7)})`,
    `Total do banco: *${brl(imp.total)}*`,
  ];
  if (Number(imp.saldo_financiado) > 0) linhas.push(`↪️ inclui ${brl(imp.saldo_financiado)} de saldo anterior financiado (rotativo)`);
  const conferidos = (n.conferido ?? 0) + (n.lancado ?? 0);
  const partes: string[] = [];
  if (conferidos) partes.push(`✅ ${conferidos} já ${conferidos === 1 ? 'estava' : 'estavam'} no app`);
  if (n.diferente) partes.push(`⚠️ ${n.diferente} com valor diferente`);
  if (n.faltando) partes.push(`➕ ${n.faltando} ${n.faltando === 1 ? 'falta' : 'faltam'} (${brl(t.faltando)})`);
  if (partes.length) linhas.push(partes.join(' · '));
  const soApp = (c.so_no_app as unknown[] | undefined)?.length ?? 0;
  if (soApp) linhas.push(`❓ ${soApp} ${soApp === 1 ? 'lançamento' : 'lançamentos'} do app nessa fatura não ${soApp === 1 ? 'aparece' : 'aparecem'} no banco (${brl(t.so_no_app)})`);
  const link = `${cfg.origem}/carteira/cartao/${imp.cartao_id}/conferir?mes=${comp}`;
  if (!n.faltando && !n.diferente) {
    linhas.push('', soApp ? `Confira no app: ${link}` : 'Tudo bate com o app 👌');
  } else {
    linhas.push('', n.faltando ? `Responda *lança tudo da fatura* para eu lançar ${n.faltando === 1 ? 'o que falta' : `as ${n.faltando}`}, ou escolha no app: ${link}` : `Confira no app: ${link}`);
  }
  return linhas.join('\n');
}

let tokenCache: { valor: string | null; ate: number } = { valor: null, ate: 0 };
async function tokenInterno(): Promise<string | null> {
  if (Date.now() < tokenCache.ate) return tokenCache.valor;
  const [r] = await sql<{ v: string | null }[]>`SELECT financ.fn_config('app_token_interno') AS v`;
  tokenCache = { valor: r?.v && r.v.length >= 32 ? r.v : null, ate: Date.now() + 60_000 };
  return tokenCache.valor;
}

async function exigirInterno(req: FastifyRequest): Promise<void> {
  const recebido = req.headers['x-financ-interno'];
  const esperado = await tokenInterno();
  if (!esperado || typeof recebido !== 'string' || !comparaSegredo(recebido, esperado)) {
    await evento('interno_negado', false, req);
    throw new ErroApi(401, 'Não autorizado', 'interno');
  }
}

export async function rotasConciliacao(app: FastifyInstance): Promise<void> {
  // PDF chega como corpo bruto (application/pdf)
  app.addContentTypeParser('application/pdf', { parseAs: 'buffer', bodyLimit: LIMITE_PDF }, (_req, body, done) => done(null, body));

  // enviar o PDF pelo app
  app.post('/api/faturas/importar', limiteImport, async (req, reply) => {
    await exigirSessao(req);
    semCache(reply);
    if (!Buffer.isBuffer(req.body)) throw new ErroApi(415, 'Envie o arquivo PDF da fatura.', 'nao_pdf');
    const q = z.object({ cartao_id: z.coerce.number().int().positive().optional(), nome: z.string().max(120).optional() }).parse(req.query ?? {});
    const conciliacao = await importarPdf(req.body, { cartao_id: q.cartao_id, origem: 'app', arquivo: q.nome });
    await evento('fatura_importada', true, req, { origem: 'app' });
    return { ok: true, conciliacao, snapshot: (await snapshot()).dados };
  });

  // o n8n manda o PDF que chegou no e-mail de fatura fechada
  app.post('/api/interno/fatura', limiteImport, async (req) => {
    await exigirInterno(req);
    if (!Buffer.isBuffer(req.body)) throw new ErroApi(415, 'Envie o arquivo PDF da fatura.', 'nao_pdf');
    const q = z.object({ nome: z.string().max(120).optional() }).parse(req.query ?? {});
    const conciliacao = await importarPdf(req.body, { origem: 'email', arquivo: q.nome, resumido: true });
    return { ok: true, mensagem: mensagem(conciliacao), conciliacao };
  });

  app.get('/api/faturas/conciliacao', async (req, reply) => {
    await exigirSessao(req);
    semCache(reply);
    const q = z.object({ cartao_id: z.coerce.number().int().positive(), mes: zMes }).parse(req.query ?? {});
    try {
      return { ok: true, conciliacao: await funcao('fn_conciliacao_fatura', { cartao: `#${q.cartao_id}`, mes: q.mes }) };
    } catch (e) {
      if (e instanceof ErroApi && e.codigo === 'sem_importacao') return { ok: true, conciliacao: null };
      throw e;
    }
  });

  app.post('/api/faturas/conciliacao', async (req, reply) => {
    await exigirSessao(req);
    semCache(reply);
    const b = corpo(
      z.object({
        importacao_id: z.number().int().positive(),
        acao: z.enum(['lancar', 'lancar_todos', 'ignorar', 'restaurar', 'vincular', 'usar_valor_banco', 'nao_e_o_mesmo', 'desvincular']),
        itens: z.array(z.number().int().positive()).max(500).default([]),
        categorias: z.record(z.string().regex(/^\d+$/), z.string().trim().min(1).max(60)).optional(),
      }),
      req,
    );
    const conciliacao = await funcao('fn_aplicar_conciliacao', b);
    return { ok: true, conciliacao, snapshot: (await snapshot()).dados };
  });
}
