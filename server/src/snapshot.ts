import { createHash } from 'node:crypto';
import { sql } from './db.js';

type Executor = { unsafe: typeof sql.unsafe } & typeof sql;

/**
 * Tudo que o app precisa para funcionar, inclusive sem internet: contas, cartões e faturas,
 * caixinhas, fixas, orçamentos, painel de 12 meses e os lançamentos dos últimos 12 meses (mais os futuros).
 * Os números derivados (saldo livre, faturas, a pagar) vêm das mesmas funções SQL que o agente usa.
 */
export async function snapshot(db: Executor = sql as Executor): Promise<{ dados: Record<string, unknown>; etag: string }> {
  const [r] = await db<{ snap: Record<string, unknown> }[]>`
    WITH h AS (SELECT financ.fn_hoje() AS hoje, financ.fn_mes(financ.fn_hoje()) AS mes)
    SELECT jsonb_build_object(
      'hoje', h.hoje,
      'mes', to_char(h.mes, 'YYYY-MM'),
      'padrao', jsonb_build_object(
          'cartao_id', financ.fn_cartao_padrao(),
          'conta_id', financ.fn_conta_padrao(),
          'metodo', COALESCE(financ.fn_metodo(financ.fn_config('metodo_padrao')), 'credito')),
      'contas', COALESCE((SELECT jsonb_agg(financ.fn_conta_json(c.id) ORDER BY c.ordem NULLS LAST, c.id)
                            FROM financ.contas c WHERE c.ativo), '[]'::jsonb),
      'cartoes', COALESCE((
         SELECT jsonb_agg(financ.fn_cartao_json(c.id) || jsonb_build_object(
                  'competencia_atual', to_char(financ.fn_competencia_credito(h.hoje, c.id), 'YYYY-MM'),
                  'faturas', (
                     SELECT COALESCE(jsonb_agg(financ.fn_fatura_info(c.id, k.m) ORDER BY k.m), '[]'::jsonb)
                       FROM (SELECT g::date AS m
                               FROM generate_series((financ.fn_competencia_credito(h.hoje, c.id) - interval '5 months')::date,
                                                    (financ.fn_competencia_credito(h.hoje, c.id) + interval '2 months')::date,
                                                    interval '1 month') g
                             UNION
                             SELECT DISTINCT l.competencia FROM financ.lancamentos l
                              WHERE l.cartao_id = c.id AND l.metodo = 'credito'
                                AND l.competencia > financ.fn_competencia_credito(h.hoje, c.id)) k))
                ORDER BY c.ordem NULLS LAST, c.id)
           FROM financ.cartoes c WHERE c.ativo), '[]'::jsonb),
      'caixinhas', COALESCE((SELECT jsonb_agg(financ.fn_caixinha_json(x.id) || jsonb_build_object('cor', x.cor) ORDER BY x.id)
                               FROM financ.caixinhas x WHERE x.ativo), '[]'::jsonb),
      'recorrentes', COALESCE((
         SELECT jsonb_agg(financ.fn_recorrente_json(r.id) || jsonb_build_object(
                  'cartao_id', r.cartao_id, 'conta_id', r.conta_id,
                  'lancado_mes', EXISTS (SELECT 1 FROM financ.lancamentos l WHERE l.recorrente_id = r.id AND l.competencia = h.mes))
                ORDER BY r.ativo DESC, r.tipo DESC, r.dia_vencimento, r.id)
           FROM financ.recorrentes r), '[]'::jsonb),
      'orcamentos', financ.fn_orcamentos_mes(h.hoje),
      'orcamentos_cadastro', COALESCE((SELECT jsonb_agg(jsonb_build_object('categoria', o.categoria, 'valor_mes', o.valor_mes,
                                         'categorias', COALESCE(o.categorias, ARRAY[o.categoria])) ORDER BY o.categoria)
                                         FROM financ.orcamentos o WHERE o.ativo), '[]'::jsonb),
      'painel', financ.fn_painel((h.mes - interval '5 months')::date, (h.mes + interval '6 months')::date),
      'fluxo', financ.fn_fluxo_conta_mes(h.hoje),
      'lancamentos', COALESCE((
         SELECT jsonb_agg(jsonb_build_object(
                  'id', l.id, 'data', l.data, 'competencia', to_char(l.competencia, 'YYYY-MM'),
                  'descricao', l.descricao, 'categoria', l.categoria, 'valor', l.valor, 'tipo', l.tipo, 'metodo', l.metodo,
                  'cartao_id', l.cartao_id, 'conta_id', l.conta_id, 'origem', l.origem, 'parcelamento_id', l.parcelamento_id,
                  'parcela_num', l.parcela_num, 'parcela_total', l.parcela_total, 'recorrente_id', l.recorrente_id,
                  'observacao', l.observacao, 'criado_em', l.criado_em)
                ORDER BY l.data DESC, l.id DESC)
           FROM financ.lancamentos l
          WHERE l.data >= (h.mes - interval '12 months')::date OR l.competencia >= (h.mes - interval '12 months')::date), '[]'::jsonb),
      'movimentos', COALESCE((
         SELECT jsonb_agg(jsonb_build_object('id', m.id, 'conta_id', m.conta_id, 'data', m.data, 'valor', m.valor,
                  'tipo', m.tipo, 'descricao', m.descricao, 'fatura_id', m.fatura_id) ORDER BY m.data DESC, m.id DESC)
           FROM financ.movimentos_conta m WHERE m.data >= (h.mes - interval '12 months')::date), '[]'::jsonb),
      'saldos_informados', COALESCE((
         SELECT jsonb_agg(jsonb_build_object('conta_id', s.conta_id, 'data', s.data, 'saldo', s.saldo) ORDER BY s.data DESC)
           FROM financ.saldos s WHERE s.data >= (h.mes - interval '12 months')::date), '[]'::jsonb),
      'categorias', COALESCE((
         SELECT jsonb_agg(jsonb_build_object('nome', x.categoria, 'tipo', x.tipo, 'n', x.n, 'ultimo', x.ultimo) ORDER BY x.n DESC, x.categoria)
           FROM (SELECT categoria, tipo, count(*) AS n, max(data) AS ultimo FROM financ.lancamentos GROUP BY categoria, tipo) x), '[]'::jsonb)
    ) AS snap
    FROM h`;
  const dados = r.snap;
  const etag = '"' + createHash('sha1').update(JSON.stringify(dados)).digest('base64url') + '"';
  return { dados: { ...dados, gerado_em: new Date().toISOString() }, etag };
}
