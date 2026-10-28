import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { exigirSessao } from '../auth.js';
import { sql, type Tx } from '../db.js';
import { corpo, ErroApi, idParam, semCache, zCor, zData, zFinal, zMes, zTexto, zValor, zValorLivre } from '../http.js';
import { snapshot } from '../snapshot.js';

// funções de negócio do schema financ que o app pode chamar (as mesmas do agente)
const FUNCOES = new Set([
  'fn_registrar_lancamento', 'fn_registrar_parcelamento', 'fn_editar_lancamento', 'fn_gerenciar_fatura',
  'fn_gerenciar_cartao', 'fn_gerenciar_conta', 'fn_saldo', 'fn_movimento_conta', 'fn_caixinha',
  'fn_gerenciar_recorrente', 'fn_gerenciar_orcamento',
]);

type Json = Record<string, unknown>;

/** Chama financ.<fn>(jsonb); erro de negócio ({ok:false}) vira 422 com a mensagem da função. */
async function chamar(tx: Tx, fn: string, params: Json): Promise<Json> {
  if (!FUNCOES.has(fn)) throw new Error(`função não permitida: ${fn}`);
  const limpo = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null));
  const [r] = await tx`SELECT financ.${tx(fn)}(${tx.json(limpo as never)}) AS r`;
  const res = (r as unknown as { r: Json }).r;
  if (!res || res.ok === false) throw new ErroApi(422, String(res?.erro ?? 'Não foi possível concluir'), 'regra');
  return res;
}

const ref = (id: number | null | undefined) => (id ? `#${id}` : undefined);
const bool = (v: boolean | undefined) => (v === undefined ? undefined : v ? 'true' : 'false');

/**
 * Toda alteração roda numa transação, aceita Idempotency-Key (fila offline reenviando)
 * e devolve o snapshot novo para o app trocar o estado de uma vez.
 */
async function mutacao(req: FastifyRequest, reply: FastifyReply, executar: (tx: Tx) => Promise<Json>) {
  await exigirSessao(req);
  semCache(reply);
  const chave = req.headers['idempotency-key'];
  const valida = typeof chave === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(chave);
  const resultado = await sql.begin(async (tx) => {
    if (valida) {
      const ins = await tx`INSERT INTO financ_app.idempotencia (chave) VALUES (${chave}) ON CONFLICT DO NOTHING RETURNING chave`;
      if (ins.length === 0) {
        const [anterior] = await tx<{ resultado: Json | null }[]>`SELECT resultado FROM financ_app.idempotencia WHERE chave = ${chave}`;
        return { ...(anterior?.resultado ?? {}), repetido: true } as Json;
      }
    }
    const r = await executar(tx as unknown as Tx);
    if (valida) await tx`UPDATE financ_app.idempotencia SET resultado = ${tx.json(r as never)} WHERE chave = ${chave}`;
    return r;
  });
  const comSnapshot = (req.query as { snapshot?: string } | undefined)?.snapshot !== '0';
  return { ok: true, resultado, snapshot: comSnapshot ? (await snapshot()).dados : undefined };
}

const METODOS = ['credito', 'debito', 'pix', 'dinheiro', 'boleto', 'vale'] as const;

const zLancamento = z.object({
  tipo: z.enum(['saida', 'entrada']),
  valor: zValor,
  descricao: z.string().trim().max(120).optional(),
  categoria: z.string().trim().max(60).optional(),
  metodo: z.enum(METODOS).optional(),
  cartao_id: z.number().int().positive().nullish(),
  conta_id: z.number().int().positive().nullish(),
  data: zData.optional(),
  observacao: z.string().trim().max(300).optional(),
  parcelas: z.number().int().min(1).max(48).optional(),
});

const zCartao = z.object({
  nome: zTexto(40),
  limite: z.number().finite().nonnegative().max(10_000_000).nullish(),
  dia_fechamento: z.number().int().min(1).max(31),
  dia_vencimento: z.number().int().min(1).max(31),
  competencia_por: z.enum(['vencimento', 'fechamento']).optional(),
  cor: zCor.optional(),
  final: z.union([zFinal, z.literal('')]).nullish(),
  bandeira: z.string().trim().max(20).nullish(),
  apelidos: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
  padrao: z.boolean().optional(),
  ordem: z.number().int().min(0).max(999).optional(),
});

const zConta = z.object({
  nome: zTexto(40),
  tipo: z.enum(['pf', 'pj', 'outro', 'beneficio']),
  cor: zCor.optional(),
  instituicao: z.string().trim().max(40).nullish(),
  final: z.union([zFinal, z.literal('')]).nullish(),
  bandeira: z.string().trim().max(20).nullish(),
  apelidos: z.array(z.string().trim().min(1).max(40)).max(12).optional(),
  padrao: z.boolean().optional(),
  ordem: z.number().int().min(0).max(999).optional(),
  saldo: zValorLivre.optional(),
  data: zData.optional(),
  recarga: z.object({ valor: zValor, dia: z.number().int().min(1).max(31) }).nullish(),
});

const zRecorrente = z.object({
  descricao: zTexto(80),
  valor: zValor,
  tipo: z.enum(['saida', 'entrada']),
  dia_vencimento: z.number().int().min(1).max(31),
  metodo: z.enum(METODOS).optional(),
  cartao_id: z.number().int().positive().nullish(),
  conta_id: z.number().int().positive().nullish(),
  categoria: z.string().trim().max(60).optional(),
  confirmar: z.boolean().optional(),
  lembrar_antes: z.boolean().optional(),
  inicio: zMes.optional(),
  fim: zMes.nullish(),
});

export async function rotasDados(app: FastifyInstance): Promise<void> {
  app.get('/api/snapshot', async (req, reply) => {
    await exigirSessao(req);
    semCache(reply);
    const { dados, etag } = await snapshot();
    reply.header('ETag', etag);
    if (req.headers['if-none-match'] === etag) return reply.code(304).send();
    return dados;
  });

  // ---------------------------------------------------------------- lançamentos
  app.post('/api/lancamentos', (req, reply) => {
    const b = corpo(zLancamento, req);
    return mutacao(req, reply, (tx) => {
      if (b.parcelas && b.parcelas > 1) {
        if (b.tipo !== 'saida') throw new ErroApi(400, 'Só saídas podem ser parceladas.');
        return chamar(tx, 'fn_registrar_parcelamento', {
          descricao: b.descricao, valor_total: b.valor, n_parcelas: b.parcelas, metodo: b.metodo ?? 'credito',
          cartao: ref(b.cartao_id), categoria: b.categoria, data_compra: b.data, mensagem_original: 'app',
        });
      }
      return chamar(tx, 'fn_registrar_lancamento', {
        descricao: b.descricao, valor: b.valor, tipo: b.tipo, metodo: b.metodo, cartao: ref(b.cartao_id), conta: ref(b.conta_id),
        categoria: b.categoria, data: b.data, observacao: b.observacao, mensagem_original: 'app',
      });
    });
  });

  app.patch('/api/lancamentos/:id', (req, reply) => {
    const id = idParam(req);
    const b = corpo(zLancamento.omit({ parcelas: true }).partial(), req);
    return mutacao(req, reply, (tx) =>
      chamar(tx, 'fn_editar_lancamento', {
        id, descricao: b.descricao, valor: b.valor, tipo: b.tipo, metodo: b.metodo, cartao: ref(b.cartao_id), conta: ref(b.conta_id),
        categoria: b.categoria, data: b.data, observacao: b.observacao,
      }),
    );
  });

  app.delete('/api/lancamentos/:id', (req, reply) => {
    const id = idParam(req);
    const escopo = (req.query as { escopo?: string }).escopo === 'parcelamento' ? 'parcelamento' : 'um';
    return mutacao(req, reply, (tx) => chamar(tx, 'fn_editar_lancamento', { id, acao: 'excluir', escopo }));
  });

  // ---------------------------------------------------------------- faturas
  app.post('/api/faturas', (req, reply) => {
    const b = corpo(z.object({
      cartao_id: z.number().int().positive(),
      mes: zMes,
      acao: z.enum(['pagar', 'ajustar', 'limpar_ajuste', 'reabrir']),
      valor: zValor.optional(),
      conta_id: z.number().int().positive().nullish(),
      data: zData.optional(),
    }), req);
    return mutacao(req, reply, (tx) =>
      chamar(tx, 'fn_gerenciar_fatura', { acao: b.acao, cartao: ref(b.cartao_id), mes: b.mes, valor: b.valor, conta: ref(b.conta_id), data: b.data }),
    );
  });

  // ---------------------------------------------------------------- cartões de crédito
  const paramsCartao = (b: Partial<z.infer<typeof zCartao>>) => ({
    limite: b.limite ?? undefined, dia_fechamento: b.dia_fechamento, dia_vencimento: b.dia_vencimento,
    competencia_por: b.competencia_por, cor: b.cor, final: b.final === undefined ? undefined : b.final ?? '',
    bandeira: b.bandeira === undefined ? undefined : b.bandeira ?? '', apelidos: b.apelidos?.join(','), padrao: bool(b.padrao), ordem: b.ordem,
  });

  app.post('/api/cartoes', (req, reply) => {
    const b = corpo(zCartao, req);
    return mutacao(req, reply, (tx) => chamar(tx, 'fn_gerenciar_cartao', { acao: 'criar', nome: b.nome, ...paramsCartao(b) }));
  });

  app.patch('/api/cartoes/:id', (req, reply) => {
    const id = idParam(req);
    const b = corpo(zCartao.partial(), req);
    return mutacao(req, reply, (tx) => chamar(tx, 'fn_gerenciar_cartao', { acao: 'editar', id, novo_nome: b.nome, ...paramsCartao(b) }));
  });

  app.delete('/api/cartoes/:id', (req, reply) => {
    const id = idParam(req);
    return mutacao(req, reply, (tx) => chamar(tx, 'fn_gerenciar_cartao', { acao: 'desativar', id }));
  });

  // ---------------------------------------------------------------- contas (inclui cartões de benefício)
  const paramsConta = (b: Partial<z.infer<typeof zConta>>) => ({
    tipo: b.tipo, cor: b.cor, instituicao: b.instituicao === undefined ? undefined : b.instituicao ?? '',
    final: b.final === undefined ? undefined : b.final ?? '', bandeira: b.bandeira === undefined ? undefined : b.bandeira ?? '',
    apelidos: b.apelidos?.join(','), padrao: bool(b.padrao), ordem: b.ordem,
  });

  app.post('/api/contas', (req, reply) => {
    const b = corpo(zConta, req);
    return mutacao(req, reply, async (tx) => {
      const r = await chamar(tx, 'fn_gerenciar_conta', { acao: 'criar', nome: b.nome, saldo: b.saldo, data: b.data, ...paramsConta(b) });
      const contaId = (r.conta as { id: number }).id;
      if (b.tipo === 'beneficio' && b.recarga) {
        await chamar(tx, 'fn_gerenciar_recorrente', {
          acao: 'criar', descricao: `Recarga ${b.nome}`, tipo: 'entrada', valor: b.recarga.valor, dia_vencimento: b.recarga.dia,
          metodo: 'vale', conta: ref(contaId), categoria: 'Benefício', confirmar: 'false',
        });
      }
      return r;
    });
  });

  app.patch('/api/contas/:id', (req, reply) => {
    const id = idParam(req);
    const b = corpo(zConta.omit({ saldo: true, data: true, recarga: true }).partial(), req);
    return mutacao(req, reply, (tx) => chamar(tx, 'fn_gerenciar_conta', { acao: 'editar', id, novo_nome: b.nome, ...paramsConta(b) }));
  });

  app.delete('/api/contas/:id', (req, reply) => {
    const id = idParam(req);
    return mutacao(req, reply, (tx) => chamar(tx, 'fn_gerenciar_conta', { acao: 'desativar', id }));
  });

  app.post('/api/contas/:id/saldo', (req, reply) => {
    const id = idParam(req);
    const b = corpo(z.object({ saldo: zValorLivre, data: zData.optional() }), req);
    return mutacao(req, reply, (tx) => chamar(tx, 'fn_saldo', { acao: 'ajustar', conta: ref(id), saldo: b.saldo, data: b.data }));
  });

  app.post('/api/transferencias', (req, reply) => {
    const b = corpo(z.object({
      de_id: z.number().int().positive(), para_id: z.number().int().positive(), valor: zValor,
      data: zData.optional(), descricao: z.string().trim().max(80).optional(),
    }), req);
    if (b.de_id === b.para_id) throw new ErroApi(400, 'Escolha contas diferentes.');
    return mutacao(req, reply, (tx) =>
      chamar(tx, 'fn_movimento_conta', { acao: 'transferir', de: ref(b.de_id), para: ref(b.para_id), valor: b.valor, data: b.data, descricao: b.descricao }),
    );
  });

  // ---------------------------------------------------------------- caixinhas
  app.post('/api/caixinhas', (req, reply) => {
    const b = corpo(z.object({
      nome: zTexto(40), meta: zValor.nullish(), rendimento: z.string().trim().max(40).optional(), saldo: zValorLivre.optional(), cor: zCor.optional(),
    }), req);
    return mutacao(req, reply, async (tx) => {
      const r = await chamar(tx, 'fn_caixinha', { acao: 'criar', nome: b.nome, meta: b.meta ?? undefined, rendimento: b.rendimento, saldo: b.saldo });
      if (b.cor) await tx`UPDATE financ.caixinhas SET cor = ${b.cor} WHERE id = ${(r.caixinha as { id: number }).id}`;
      return r;
    });
  });

  app.patch('/api/caixinhas/:id', (req, reply) => {
    const id = idParam(req);
    const b = corpo(z.object({
      nome: zTexto(40).optional(), meta: zValor.nullish(), rendimento: z.string().trim().max(40).optional(), cor: zCor.optional(),
    }), req);
    return mutacao(req, reply, async (tx) => {
      const p: Json = { acao: 'editar', caixinha: ref(id), novo_nome: b.nome, rendimento: b.rendimento };
      if (b.meta !== undefined) p.meta = b.meta ?? '';
      const [r] = await tx`SELECT financ.fn_caixinha(${tx.json(p as never)}) AS r`;
      const res = (r as unknown as { r: Json }).r;
      if (res.ok === false) throw new ErroApi(422, String(res.erro));
      if (b.cor) await tx`UPDATE financ.caixinhas SET cor = ${b.cor} WHERE id = ${id}`;
      return res;
    });
  });

  app.delete('/api/caixinhas/:id', (req, reply) => {
    const id = idParam(req);
    return mutacao(req, reply, (tx) => chamar(tx, 'fn_caixinha', { acao: 'remover', caixinha: ref(id) }));
  });

  app.post('/api/caixinhas/:id/movimento', (req, reply) => {
    const id = idParam(req);
    const b = corpo(z.object({
      acao: z.enum(['aportar', 'resgatar', 'saldo']), valor: zValorLivre, conta_id: z.number().int().positive().nullish(), data: zData.optional(),
    }), req);
    if (b.acao !== 'saldo' && b.valor <= 0) throw new ErroApi(400, 'Informe um valor maior que zero.');
    return mutacao(req, reply, (tx) =>
      chamar(tx, 'fn_caixinha', {
        acao: b.acao, caixinha: ref(id), valor: b.acao === 'saldo' ? undefined : b.valor, saldo: b.acao === 'saldo' ? b.valor : undefined,
        conta: ref(b.conta_id), data: b.data,
      }),
    );
  });

  app.get('/api/caixinhas/:id/historico', async (req, reply) => {
    await exigirSessao(req);
    semCache(reply);
    const id = idParam(req);
    const [r] = await sql`SELECT financ.fn_caixinha(${sql.json({ acao: 'historico', caixinha: ref(id), limite: 60 } as never)}) AS r`;
    return (r as { r: Json }).r;
  });

  app.post('/api/caixinhas/:id/desfazer', (req, reply) => {
    const id = idParam(req);
    const b = corpo(z.object({ movimento_id: z.number().int().positive() }), req);
    return mutacao(req, reply, (tx) => chamar(tx, 'fn_caixinha', { acao: 'desfazer', caixinha: ref(id), id: b.movimento_id }));
  });

  // ---------------------------------------------------------------- contas fixas e receitas fixas
  const paramsRecorrente = (b: Partial<z.infer<typeof zRecorrente>>) => ({
    valor: b.valor, tipo: b.tipo, dia_vencimento: b.dia_vencimento, metodo: b.metodo, cartao: ref(b.cartao_id), conta: ref(b.conta_id),
    categoria: b.categoria, confirmar: bool(b.confirmar), lembrar_antes: bool(b.lembrar_antes), inicio: b.inicio, fim: b.fim ?? undefined,
  });

  app.post('/api/recorrentes', (req, reply) => {
    const b = corpo(zRecorrente, req);
    return mutacao(req, reply, (tx) => chamar(tx, 'fn_gerenciar_recorrente', { acao: 'criar', descricao: b.descricao, ...paramsRecorrente(b) }));
  });

  app.patch('/api/recorrentes/:id', (req, reply) => {
    const id = idParam(req);
    const b = corpo(zRecorrente.partial(), req);
    return mutacao(req, reply, (tx) =>
      chamar(tx, 'fn_gerenciar_recorrente', { acao: 'editar', id, nova_descricao: b.descricao, ...paramsRecorrente(b) }),
    );
  });

  app.post('/api/recorrentes/:id/estado', (req, reply) => {
    const id = idParam(req);
    const b = corpo(z.object({ ativo: z.boolean() }), req);
    return mutacao(req, reply, (tx) => chamar(tx, 'fn_gerenciar_recorrente', { acao: b.ativo ? 'reativar' : 'desativar', id }));
  });

  app.delete('/api/recorrentes/:id', (req, reply) => {
    const id = idParam(req);
    return mutacao(req, reply, (tx) => chamar(tx, 'fn_gerenciar_recorrente', { acao: 'excluir', id }));
  });

  // ---------------------------------------------------------------- orçamentos
  app.post('/api/orcamentos', (req, reply) => {
    const b = corpo(z.object({
      categoria: zTexto(60), valor: zValor.optional(), categorias: z.array(zTexto(60)).max(20).optional(),
      escopo: z.enum(['padrao', 'mes']).default('padrao'), mes: zMes.optional(),
    }), req);
    return mutacao(req, reply, (tx) =>
      chamar(tx, 'fn_gerenciar_orcamento', { acao: 'definir', categoria: b.categoria, valor: b.valor, categorias: b.categorias, escopo: b.escopo, mes: b.mes }),
    );
  });

  app.post('/api/orcamentos/remover', (req, reply) => {
    const b = corpo(z.object({ categoria: zTexto(60), escopo: z.enum(['padrao', 'mes']).default('padrao'), mes: zMes.optional() }), req);
    return mutacao(req, reply, (tx) => chamar(tx, 'fn_gerenciar_orcamento', { acao: 'remover', categoria: b.categoria, escopo: b.escopo, mes: b.mes }));
  });
}
