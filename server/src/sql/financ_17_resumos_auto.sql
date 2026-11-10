-- Financ · Migração 17: dados dos resumos automáticos em imagem (fechamento do cartão e quinzena)

-- Dados de um resumo: p_modelo = 'fatura' (cartão + mês da fatura; vazio = a fatura em aberto do cartão padrão)
-- ou 'quinzena' (início e fim; vazio = a quinzena em andamento). Usado pelo workflow "Resumo em imagem".
CREATE OR REPLACE FUNCTION financ.fn_resumo_auto(p_modelo text, p_cartao text DEFAULT '', p_mes text DEFAULT '', p_inicio text DEFAULT '', p_fim text DEFAULT '')
 RETURNS TABLE (modelo text, hoje date, chat_id text, dados jsonb)
 LANGUAGE sql STABLE
AS $function$
WITH p0 AS (
  SELECT p_modelo AS modelo, financ.fn_hoje() AS hoje,
         COALESCE(CASE WHEN p_cartao ~ '^[0-9]+$' THEN p_cartao::int ELSE financ.fn_resolver_cartao(NULLIF(p_cartao, '')) END, financ.fn_cartao_padrao()) AS cartao_id
), par AS (
  SELECT p0.modelo, p0.hoje, p0.cartao_id,
         -- sem mês: a fatura em aberto; sem datas: a quinzena em andamento
         COALESCE(financ.fn_parse_mes(NULLIF(p_mes, '')), financ.fn_competencia_credito(p0.hoje, p0.cartao_id)) AS comp,
         COALESCE(NULLIF(p_inicio, '')::date, CASE WHEN EXTRACT(day FROM p0.hoje) <= 15 THEN date_trunc('month', p0.hoje)::date ELSE (date_trunc('month', p0.hoje) + interval '15 days')::date END) AS ini,
         COALESCE(NULLIF(p_fim, '')::date, NULLIF(p_inicio, '')::date, p0.hoje) AS fim
    FROM p0
)
SELECT par.modelo, par.hoje, COALESCE(financ.fn_config('owner_lid'), financ.fn_config('owner_pn')) AS chat_id,
  CASE WHEN par.modelo = 'fatura' THEN (
    SELECT jsonb_build_object(
      'cartao', (SELECT nome FROM financ.cartoes WHERE id = par.cartao_id),
      'mes', to_char(par.comp, 'YYYY-MM'),
      'info', financ.fn_fatura_info(par.cartao_id, par.comp),
      'anterior', financ.fn_fatura_info(par.cartao_id, (par.comp - interval '1 month')::date)->'valor_fatura',
      'proxima', (SELECT COALESCE(sum(l.valor), 0) FROM financ.lancamentos l WHERE l.cartao_id = par.cartao_id AND l.metodo = 'credito' AND l.competencia = (par.comp + interval '1 month')::date),
      'n', count(*), 'n_parcelas', count(*) FILTER (WHERE f.origem = 'parcela'),
      'parcelas', COALESCE(sum(f.valor) FILTER (WHERE f.origem = 'parcela'), 0),
      'avista', COALESCE(sum(f.valor) FILTER (WHERE f.origem <> 'parcela'), 0),
      'top', (SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) FROM (SELECT l.data, l.descricao, l.categoria, l.valor, l.parcela_num, l.parcela_total FROM financ.lancamentos l
               WHERE l.cartao_id = par.cartao_id AND l.metodo = 'credito' AND l.competencia = par.comp ORDER BY l.valor DESC, l.id LIMIT 5) x),
      'cats', (SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) FROM (SELECT l.categoria, sum(l.valor) AS valor FROM financ.lancamentos l
               WHERE l.cartao_id = par.cartao_id AND l.metodo = 'credito' AND l.competencia = par.comp GROUP BY 1 ORDER BY 2 DESC LIMIT 4) x))
    FROM financ.lancamentos f WHERE f.cartao_id = par.cartao_id AND f.metodo = 'credito' AND f.competencia = par.comp)
  ELSE (
    SELECT jsonb_build_object(
      'inicio', par.ini, 'fim', par.fim,
      'entradas', COALESCE(sum(f.valor) FILTER (WHERE f.tipo = 'entrada'), 0),
      'saidas', COALESCE(sum(f.valor) FILTER (WHERE f.tipo = 'saida'), 0),
      'n', count(*) FILTER (WHERE f.tipo = 'saida'),
      'credito', COALESCE(sum(f.valor) FILTER (WHERE f.tipo = 'saida' AND f.metodo = 'credito'), 0),
      'top', (SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) FROM (SELECT l.data, l.descricao, l.categoria, l.valor, l.metodo, l.parcela_num, l.parcela_total FROM financ.lancamentos l
               WHERE l.tipo = 'saida' AND l.data BETWEEN par.ini AND par.fim ORDER BY l.valor DESC, l.id LIMIT 5) x),
      'cats', (SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) FROM (SELECT l.categoria, sum(l.valor) AS valor FROM financ.lancamentos l
               WHERE l.tipo = 'saida' AND l.data BETWEEN par.ini AND par.fim GROUP BY 1 ORDER BY 2 DESC LIMIT 4) x),
      'saldos', (SELECT COALESCE(jsonb_agg(jsonb_build_object('conta', c.nome, 'saldo', financ.fn_saldo_conta(c.id, par.hoje)) ORDER BY c.id), '[]'::jsonb)
                   FROM financ.contas c WHERE c.ativo AND financ.fn_conta_caixa(c.id)),
      'a_pagar', (SELECT jsonb_build_object('n', count(*), 'total', COALESCE(sum((p->>'valor')::numeric), 0))
                    FROM jsonb_array_elements(financ.fn_previstos(par.hoje, (par.hoje + 15))) p
                   WHERE p->>'tipo' = 'saida' AND p->>'metodo' <> 'credito' AND (p->>'data')::date BETWEEN par.hoje AND par.hoje + 15),
      'faturas', (SELECT COALESCE(jsonb_agg(jsonb_build_object('cartao', fi->>'cartao', 'valor', (fi->>'valor_fatura')::numeric, 'vencimento', fi->>'vencimento') ORDER BY fi->>'vencimento'), '[]'::jsonb)
                    FROM financ.cartoes c CROSS JOIN LATERAL generate_series(-1, 1) g
                    CROSS JOIN LATERAL (SELECT financ.fn_fatura_info(c.id, (financ.fn_competencia_credito(par.hoje, c.id) + (g || ' month')::interval)::date) AS fi) z
                   WHERE c.ativo AND NOT (fi->>'paga')::boolean AND (fi->>'valor_fatura')::numeric > 0 AND (fi->>'vencimento')::date BETWEEN par.hoje AND par.hoje + 15))
    FROM financ.lancamentos f WHERE f.data BETWEEN par.ini AND par.fim)
  END AS dados
FROM par
$function$;

-- O que ainda falta enviar hoje: a fatura que fechou ontem (uma por cartão) e a quinzena que terminou ontem (dias 1 e 16).
-- Cada resumo sai uma vez só: depois de enviado, o workflow grava a chave em financ.notificacoes.
CREATE OR REPLACE FUNCTION financ.fn_resumos_pendentes(p_hoje date DEFAULT NULL)
 RETURNS TABLE (modelo text, cartao text, mes text, inicio text, fim text, chave text)
 LANGUAGE sql STABLE
AS $function$
  WITH h AS (SELECT COALESCE(p_hoje, financ.fn_hoje()) AS hoje),
  fat AS (
    SELECT 'fatura'::text AS modelo, c.id::text AS cartao, to_char(k.comp, 'YYYY-MM') AS mes, ''::text AS inicio, ''::text AS fim,
           'resumo_fatura:' || c.id || ':' || to_char(k.comp, 'YYYY-MM') AS chave, 1 AS ord
      FROM financ.cartoes c CROSS JOIN h
      CROSS JOIN LATERAL (SELECT (financ.fn_competencia_credito(h.hoje, c.id) - (n || ' month')::interval)::date AS comp FROM generate_series(0, 1) n) k
      CROSS JOIN LATERAL (SELECT financ.fn_fatura_info(c.id, k.comp) AS fi) f
     WHERE c.ativo AND (f.fi->>'itens')::int > 0 AND (f.fi->>'fechamento')::date = h.hoje - 1
  ),
  qz AS (
    SELECT 'quinzena'::text, ''::text, ''::text, q.ini::text, (h.hoje - 1)::text, 'resumo_quinzena:' || q.ini, 2
      FROM h CROSS JOIN LATERAL (
        SELECT CASE WHEN EXTRACT(day FROM h.hoje) = 16 THEN date_trunc('month', h.hoje)::date
                    WHEN EXTRACT(day FROM h.hoje) = 1 THEN (date_trunc('month', h.hoje - 1) + interval '15 days')::date END AS ini) q
     WHERE q.ini IS NOT NULL
  )
  SELECT x.modelo, x.cartao, x.mes, x.inicio, x.fim, x.chave
    FROM (SELECT * FROM fat UNION ALL SELECT * FROM qz) x
   WHERE NOT EXISTS (SELECT 1 FROM financ.notificacoes n WHERE n.chave = x.chave)
   ORDER BY x.ord, x.chave
$function$;
