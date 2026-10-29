-- Financ v2 · Migração 13 · conciliação da fatura do banco (PDF da fatura fechada)
-- Guarda os itens lidos do PDF, confere com os lançamentos do app sem duplicar e lança o que falta.
-- Pode rodar de novo sem problema.

CREATE TABLE IF NOT EXISTS financ.fatura_importacoes (
  id               serial PRIMARY KEY,
  cartao_id        int NOT NULL REFERENCES financ.cartoes(id),
  competencia      date NOT NULL,
  vencimento       date,
  fechamento       date,
  periodo_ini      date,
  total            numeric(12,2),
  saldo_financiado numeric(12,2) NOT NULL DEFAULT 0,
  empresa          boolean NOT NULL DEFAULT false,
  origem           text NOT NULL DEFAULT 'app' CHECK (origem IN ('email','app')),
  arquivo          text,
  checagem         jsonb,
  criado_em        timestamptz NOT NULL DEFAULT now(),
  atualizado_em    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cartao_id, competencia)
);

CREATE TABLE IF NOT EXISTS financ.fatura_itens (
  id              serial PRIMARY KEY,
  importacao_id   int NOT NULL REFERENCES financ.fatura_importacoes(id) ON DELETE CASCADE,
  chave           text NOT NULL,
  ordem           int NOT NULL DEFAULT 0,
  data            date NOT NULL,
  descricao       text NOT NULL,
  descricao_limpa text NOT NULL,
  valor           numeric(12,2) NOT NULL CHECK (valor >= 0),
  tipo            text NOT NULL CHECK (tipo IN ('compra','encargo','estorno')),
  parcela_num     int,
  parcela_total   int,
  final           text,
  categoria       text,
  status          text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','lancado','ignorado')),
  lancamento_id   int REFERENCES financ.lancamentos(id) ON DELETE SET NULL,
  criado_em       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (importacao_id, chave)
);
ALTER TABLE financ.fatura_itens ADD COLUMN IF NOT EXISTS rejeitados int[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS ix_fatura_itens_lanc ON financ.fatura_itens (lancamento_id) WHERE lancamento_id IS NOT NULL;

-- descrição do extrato sem prefixos de maquininha, NuPay e Parcela k/N
CREATE OR REPLACE FUNCTION financ.fn_fatura_desc_limpa(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT initcap(lower(trim(regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(COALESCE(p, ''), '\s+-\s+Parcela\s+\d+/\d+\s*$', '', 'i'),
        '\s+-\s+NuPay\s*$', '', 'i'),
      '^(mp|ifd|pag|ec|dl|ebn|paygo|lite|jim\.com|valori|pg|pagseguro|sumup|ton|htm|zp|ppro)\s*\*\s*', '', 'i'),
    '\s{2,}', ' ', 'g'))))
$$;

-- chave do estabelecimento (duas primeiras palavras, sem acento/números) para lembrar categorias
CREATE OR REPLACE FUNCTION financ.fn_fatura_chave_loja(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT array_to_string((regexp_split_to_array(trim(regexp_replace(regexp_replace(COALESCE(financ.fn_norm(financ.fn_fatura_desc_limpa(p)), ''), '[^a-z ]', ' ', 'g'), '\s+', ' ', 'g')), ' '))[1:2], ' ')
$$;

-- categoria sugerida: primeiro o que já foi usado para a mesma loja, depois regras simples
CREATE OR REPLACE FUNCTION financ.fn_fatura_categoria(p_desc text, p_tipo text DEFAULT 'compra') RETURNS text LANGUAGE plpgsql STABLE AS $$
DECLARE v_loja text := financ.fn_fatura_chave_loja(p_desc); v_cat text; d text := COALESCE(financ.fn_norm(p_desc), '');
BEGIN
  IF p_tipo = 'encargo' THEN RETURN 'Impostos e taxas'; END IF;
  IF v_loja <> '' THEN
    SELECT l.categoria INTO v_cat
      FROM financ.fatura_itens i JOIN financ.lancamentos l ON l.id = i.lancamento_id
     WHERE financ.fn_fatura_chave_loja(i.descricao) = v_loja AND l.categoria <> 'Outros'
     GROUP BY l.categoria ORDER BY count(*) DESC, max(l.atualizado_em) DESC LIMIT 1;
    IF v_cat IS NOT NULL THEN RETURN v_cat; END IF;
  END IF;
  RETURN CASE
    WHEN d ~ '(ifood|ifd\*|restaurant|lanche|pizza|burger|subway|acai|chopp|churrasc|padaria|panific|paocrocante|pamonh|sorvet|eskimo|assados|cafe|bar e|espetinho|sushi|mc ?donald|bk |outback|coco bambu)' THEN 'Restaurante'
    WHEN d ~ '(mercat|supercouto|supermerc|super |mercado|atacad|assai|carrefour|hortifruti|acougue|sacolao|pao de acucar|bretas|tatico)' THEN 'Alimentação'
    WHEN d ~ '(posto|combust|ipiranga|shell|petrobras|br mania|uber|99 ?app|99pop|cabify|estaciona|pedagio|sem parar|veloe|conectcar)' THEN 'Transporte'
    WHEN d ~ '(loteri|mega sena|mega sorte|steam|playstation|xbox|nintendo|cinema|cinemark|moviecom|ingresso|velox|ticket|sympla|eventim)' THEN 'Lazer'
    WHEN d ~ '(google|youtube|apple\.com|onedrive|microsoft|spotify|netflix|disney|hbo|max\.com|prime video|amazon prime|vivoeasy|deezer|chatgpt|openai|claude|anthropic|icloud)' THEN 'Assinaturas'
    WHEN d ~ '(farmac|drogari|droga |orto|odonto|clinic|hospital|laborat|saude|pague menos|raia|panvel)' THEN 'Saúde'
    WHEN d ~ '(riachuelo|renner|centauro|pernambucanas|c&a|cea |zara|hering|marisa|netshoes|nike|adidas|calcad)' THEN 'Vestuário'
    WHEN d ~ '(ferrag|leroy|construc|madeir|tok ?stok|camicado|casa e video|americanas|magazine|magalu)' THEN 'Casa'
    WHEN d ~ '(azul|gol linhas|latam|vai ?de ?promo|decolar|booking|airbnb|hotel|pousada|localiza|movida|unidas)' THEN 'Transporte'
    WHEN d ~ '(tiktok|shopee|amazon|mercadolivre|mercado livre|aliexpress|shein|temu)' THEN 'Compras'
    WHEN d ~ '(juros|iof|multa|encargo|anuidade|tarifa)' THEN 'Impostos e taxas'
    ELSE 'Outros' END;
END $$;

-- lê o cartão/mês da conciliação a partir de {importacao_id} ou {cartao, mes}
CREATE OR REPLACE FUNCTION financ.fn_fatura_importacao_alvo(p jsonb) RETURNS int LANGUAGE plpgsql STABLE AS $$
DECLARE v_id int; v_cartao int; v_mes date;
BEGIN
  IF financ.fn_num(p, 'importacao_id') IS NOT NULL THEN
    SELECT id INTO v_id FROM financ.fatura_importacoes WHERE id = financ.fn_num(p, 'importacao_id')::int;
    RETURN v_id;
  END IF;
  v_cartao := COALESCE(financ.fn_resolver_cartao(financ.fn_txt(p, 'cartao')), financ.fn_cartao_padrao());
  v_mes := financ.fn_parse_mes(financ.fn_txt(p, 'mes'));
  IF v_mes IS NULL THEN
    SELECT id INTO v_id FROM financ.fatura_importacoes WHERE cartao_id = v_cartao ORDER BY competencia DESC LIMIT 1;
  ELSE
    SELECT id INTO v_id FROM financ.fatura_importacoes WHERE cartao_id = v_cartao AND competencia = v_mes;
  END IF;
  RETURN v_id;
END $$;

-- confere os itens do banco com os lançamentos do app (calculado na hora, nada é alterado)
CREATE OR REPLACE FUNCTION financ.fn_conciliacao_fatura(p jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE imp financ.fatura_importacoes%ROWTYPE; pr record; v_resumido boolean := financ.fn_bool(p, 'resumido', false);
  v_itens jsonb; v_so_app jsonb; v_cont jsonb; v_fat jsonb; v_app numeric; v_banco numeric; v_falta numeric;
BEGIN
  SELECT * INTO imp FROM financ.fatura_importacoes WHERE id = financ.fn_fatura_importacao_alvo(p);
  IF imp.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'codigo', 'sem_importacao', 'erro', 'Ainda não li o PDF dessa fatura. Envie o PDF no app (cartão → Conferir com o banco) ou espere o e-mail de fechamento.');
  END IF;

  IF to_regclass('pg_temp._conc_cand') IS NULL THEN
    CREATE TEMP TABLE _conc_cand (id int PRIMARY KEY, data date, valor numeric, tipo text, competencia date, parcela_num int, usado boolean) ON COMMIT DROP;
  END IF;
  IF to_regclass('pg_temp._conc_it') IS NULL THEN
    CREATE TEMP TABLE _conc_it (id int PRIMARY KEY, data date, valor numeric, dir text, parcela_num int, estado text, match_id int, rejeitados int[]) ON COMMIT DROP;
  END IF;
  TRUNCATE _conc_cand; TRUNCATE _conc_it;

  -- lançamentos do app que podem ser desta fatura (mesmo mês ou data dentro do período), sem os já ligados a outra fatura
  INSERT INTO _conc_cand
  SELECT l.id, l.data, l.valor, l.tipo, l.competencia, l.parcela_num, false
    FROM financ.lancamentos l
   WHERE l.cartao_id = imp.cartao_id AND l.metodo = 'credito' AND l.status = 'confirmado'
     AND (l.competencia = imp.competencia
          OR l.data BETWEEN COALESCE(imp.periodo_ini, imp.competencia - 35) - 5 AND COALESCE(imp.fechamento, imp.vencimento, imp.competencia + 30) + 5)
     AND NOT EXISTS (SELECT 1 FROM financ.fatura_itens o WHERE o.lancamento_id = l.id AND o.importacao_id <> imp.id);

  INSERT INTO _conc_it
  SELECT i.id, i.data, i.valor, CASE WHEN i.tipo = 'estorno' THEN 'entrada' ELSE 'saida' END, i.parcela_num,
         CASE WHEN i.status = 'ignorado' THEN 'ignorado' END, NULL, i.rejeitados
    FROM financ.fatura_itens i WHERE i.importacao_id = imp.id;

  -- 0) ligações já feitas (lançado pela conferência ou confirmado por você)
  UPDATE _conc_it t SET match_id = i.lancamento_id,
         estado = CASE WHEN i.status = 'lancado' THEN 'lancado' ELSE 'conferido' END
    FROM financ.fatura_itens i
   WHERE i.id = t.id AND t.estado IS NULL AND i.lancamento_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM _conc_cand c WHERE c.id = i.lancamento_id);
  UPDATE _conc_cand c SET usado = true WHERE c.id IN (SELECT match_id FROM _conc_it WHERE match_id IS NOT NULL);

  -- 1) mesmo valor (centavo a centavo), data próxima; os melhores pares primeiro
  FOR pr IN
    SELECT t.id AS tid, c.id AS cid
      FROM _conc_it t JOIN _conc_cand c ON c.tipo = t.dir AND abs(c.valor - t.valor) < 0.005
     WHERE t.estado IS NULL AND NOT c.usado AND NOT (c.id = ANY (t.rejeitados))
       AND abs(c.data - t.data) <= CASE WHEN c.competencia = imp.competencia THEN 10 ELSE 3 END
     ORDER BY (c.competencia = imp.competencia) DESC, (c.parcela_num IS NOT DISTINCT FROM t.parcela_num) DESC, abs(c.data - t.data), t.data, t.id, c.id
  LOOP
    CONTINUE WHEN EXISTS (SELECT 1 FROM _conc_it WHERE id = pr.tid AND estado IS NOT NULL) OR EXISTS (SELECT 1 FROM _conc_cand WHERE id = pr.cid AND usado);
    UPDATE _conc_it SET estado = 'conferido', match_id = pr.cid WHERE id = pr.tid;
    UPDATE _conc_cand SET usado = true WHERE id = pr.cid;
  END LOOP;

  -- 2) valor quase igual (até 5%, mínimo R$ 0,50) e data quase igual: o mesmo gasto digitado arredondado
  FOR pr IN
    SELECT t.id AS tid, c.id AS cid
      FROM _conc_it t JOIN _conc_cand c ON c.tipo = t.dir AND abs(c.valor - t.valor) <= GREATEST(0.50, t.valor * 0.05)
     WHERE t.estado IS NULL AND NOT c.usado AND NOT (c.id = ANY (t.rejeitados)) AND abs(c.data - t.data) <= 2
       AND (c.competencia = imp.competencia OR c.data BETWEEN COALESCE(imp.periodo_ini, c.data) AND COALESCE(imp.fechamento, c.data))
     ORDER BY abs(c.valor - t.valor), abs(c.data - t.data), t.id, c.id
  LOOP
    CONTINUE WHEN EXISTS (SELECT 1 FROM _conc_it WHERE id = pr.tid AND estado IS NOT NULL) OR EXISTS (SELECT 1 FROM _conc_cand WHERE id = pr.cid AND usado);
    UPDATE _conc_it SET estado = 'diferente', match_id = pr.cid WHERE id = pr.tid;
    UPDATE _conc_cand SET usado = true WHERE id = pr.cid;
  END LOOP;

  UPDATE _conc_it SET estado = 'faltando' WHERE estado IS NULL;

  SELECT jsonb_object_agg(e, n) INTO v_cont FROM (
    SELECT e, count(t.id) AS n FROM unnest(ARRAY['faltando','diferente','conferido','lancado','ignorado']) e
      LEFT JOIN _conc_it t ON t.estado = e GROUP BY e) x;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', i.id, 'data', i.data, 'descricao', i.descricao, 'descricao_limpa', i.descricao_limpa, 'valor', i.valor, 'tipo', i.tipo,
           'parcela', CASE WHEN i.parcela_total > 1 THEN i.parcela_num || '/' || i.parcela_total END,
           'final', i.final, 'categoria', COALESCE(i.categoria, financ.fn_fatura_categoria(i.descricao, i.tipo)),
           'estado', t.estado,
           'lancamento', CASE WHEN t.match_id IS NOT NULL THEN (
               SELECT jsonb_build_object('id', l.id, 'data', l.data, 'descricao', l.descricao, 'valor', l.valor, 'categoria', l.categoria,
                                         'competencia', to_char(l.competencia, 'YYYY-MM'), 'outro_mes', l.competencia <> imp.competencia,
                                         'parcela', CASE WHEN l.parcela_total > 1 THEN l.parcela_num || '/' || l.parcela_total END)
                 FROM financ.lancamentos l WHERE l.id = t.match_id) END)
         ORDER BY CASE t.estado WHEN 'faltando' THEN 0 WHEN 'diferente' THEN 1 ELSE 2 END, i.data, i.ordem), '[]'::jsonb)
    INTO v_itens
    FROM financ.fatura_itens i JOIN _conc_it t ON t.id = i.id
   WHERE NOT v_resumido OR t.estado IN ('faltando', 'diferente');

  -- no app, nesta fatura, sem correspondente no banco
  SELECT COALESCE(jsonb_agg(financ.fn_lancamento_json(c.id) ORDER BY c.data, c.id), '[]'::jsonb) INTO v_so_app
    FROM _conc_cand c WHERE NOT c.usado AND c.competencia = imp.competencia;

  SELECT COALESCE(sum(CASE WHEN tipo = 'estorno' THEN -valor ELSE valor END), 0) INTO v_banco FROM financ.fatura_itens WHERE importacao_id = imp.id;
  SELECT COALESCE(sum(CASE WHEN i.tipo = 'estorno' THEN -i.valor ELSE i.valor END), 0) INTO v_falta
    FROM financ.fatura_itens i JOIN _conc_it t ON t.id = i.id WHERE t.estado = 'faltando';
  SELECT COALESCE(sum(CASE WHEN l.tipo = 'entrada' THEN -l.valor ELSE l.valor END), 0) INTO v_app
    FROM financ.lancamentos l WHERE l.cartao_id = imp.cartao_id AND l.metodo = 'credito' AND l.competencia = imp.competencia AND l.status = 'confirmado';
  v_fat := financ.fn_fatura_info(imp.cartao_id, imp.competencia);

  IF v_resumido THEN
    v_itens := (SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) FROM (SELECT x FROM jsonb_array_elements(v_itens) x LIMIT 15) s);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'importacao', jsonb_build_object(
      'id', imp.id, 'cartao_id', imp.cartao_id, 'cartao', (SELECT nome FROM financ.cartoes WHERE id = imp.cartao_id),
      'competencia', to_char(imp.competencia, 'YYYY-MM'), 'vencimento', imp.vencimento, 'fechamento', imp.fechamento, 'periodo_ini', imp.periodo_ini,
      'total', imp.total, 'saldo_financiado', imp.saldo_financiado, 'origem', imp.origem, 'atualizado_em', imp.atualizado_em, 'checagem', imp.checagem),
    'contagem', v_cont,
    'totais', jsonb_build_object(
      'banco_total', imp.total, 'banco_itens', v_banco, 'faltando', v_falta,
      'app_lancado', v_app, 'app_fatura', v_fat->'valor_fatura',
      'so_no_app', (SELECT COALESCE(sum(CASE WHEN c.tipo = 'entrada' THEN -c.valor ELSE c.valor END), 0) FROM _conc_cand c WHERE NOT c.usado AND c.competencia = imp.competencia),
      'diferenca', round(v_banco - v_app, 2)),
    'fatura_app', v_fat,
    'itens', v_itens,
    'so_no_app', CASE WHEN v_resumido THEN (SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) FROM (SELECT x FROM jsonb_array_elements(v_so_app) x LIMIT 10) s) ELSE v_so_app END
  );
END $$;

-- grava (ou atualiza) os itens lidos do PDF; reimportar o mesmo PDF não duplica nada
CREATE OR REPLACE FUNCTION financ.fn_importar_fatura(p jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_cartao int; v_empresa boolean := financ.fn_bool(p, 'empresa', false); c financ.cartoes%ROWTYPE;
  v_venc date := financ.fn_parse_data(financ.fn_txt(p, 'vencimento'), NULL); v_fech date := financ.fn_parse_data(financ.fn_txt(p, 'fechamento'), NULL);
  v_ini date := financ.fn_parse_data(financ.fn_txt(p, 'periodo_ini'), NULL); v_comp date; v_imp int; v_chaves text[];
BEGIN
  IF v_venc IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Não achei a data de vencimento no PDF.'); END IF;
  IF jsonb_typeof(p->'itens') <> 'array' THEN RETURN jsonb_build_object('ok', false, 'erro', 'Nenhum item lido do PDF.'); END IF;

  IF financ.fn_num(p, 'cartao_id') IS NOT NULL THEN
    SELECT id INTO v_cartao FROM financ.cartoes WHERE id = financ.fn_num(p, 'cartao_id')::int AND ativo;
  END IF;
  IF v_cartao IS NULL THEN
    v_cartao := financ.fn_resolver_cartao(financ.fn_config(CASE WHEN v_empresa THEN 'cartao_fatura_empresa' ELSE 'cartao_fatura_pessoal' END));
  END IF;
  IF v_cartao IS NULL AND v_empresa THEN
    v_cartao := COALESCE(financ.fn_resolver_cartao('pj'), financ.fn_resolver_cartao('empresa'));
  END IF;
  v_cartao := COALESCE(v_cartao, financ.fn_cartao_padrao());
  IF v_cartao IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Nenhum cartão cadastrado para essa fatura.'); END IF;
  SELECT * INTO c FROM financ.cartoes WHERE id = v_cartao;

  -- mês da fatura no app segue a regra do cartão (mês do vencimento ou do fechamento)
  v_comp := CASE WHEN c.competencia_por = 'fechamento' AND v_fech IS NOT NULL THEN financ.fn_mes(v_fech) ELSE financ.fn_mes(v_venc) END;

  INSERT INTO financ.fatura_importacoes AS f (cartao_id, competencia, vencimento, fechamento, periodo_ini, total, saldo_financiado, empresa, origem, arquivo, checagem)
  VALUES (v_cartao, v_comp, v_venc, v_fech, v_ini, financ.fn_num(p, 'total'), COALESCE(financ.fn_num(p, 'saldo_financiado'), 0), v_empresa,
          CASE WHEN p->>'origem' = 'email' THEN 'email' ELSE 'app' END, financ.fn_txt(p, 'arquivo'), p->'checagem')
  ON CONFLICT (cartao_id, competencia) DO UPDATE
     SET vencimento = EXCLUDED.vencimento, fechamento = EXCLUDED.fechamento, periodo_ini = EXCLUDED.periodo_ini, total = EXCLUDED.total,
         saldo_financiado = EXCLUDED.saldo_financiado, empresa = EXCLUDED.empresa, origem = EXCLUDED.origem,
         arquivo = EXCLUDED.arquivo, checagem = EXCLUDED.checagem, atualizado_em = now()
  RETURNING id INTO v_imp;

  WITH lidos AS (
    SELECT (x->>'data')::date AS data, x->>'descricao' AS descricao, round((x->>'valor')::numeric, 2) AS valor,
           CASE WHEN x->>'tipo' IN ('encargo','estorno') THEN x->>'tipo' ELSE 'compra' END AS tipo,
           NULLIF(x->>'parcela_num', '')::int AS parcela_num, NULLIF(x->>'parcela_total', '')::int AS parcela_total,
           NULLIF(x->>'final', '') AS final, n AS ordem
      FROM jsonb_array_elements(p->'itens') WITH ORDINALITY AS a(x, n)
     WHERE (x->>'valor')::numeric > 0 AND x->>'data' ~ '^\d{4}-\d{2}-\d{2}$'
  ), com_chave AS (
    SELECT l.*, to_char(l.data, 'YYYY-MM-DD') || '|' || l.valor || '|' || l.tipo || '|' || COALESCE(financ.fn_norm(l.descricao), '') || '|'
             || row_number() OVER (PARTITION BY l.data, l.valor, l.tipo, financ.fn_norm(l.descricao) ORDER BY l.ordem) AS chave
      FROM lidos l
  ), gravados AS (
    INSERT INTO financ.fatura_itens AS i (importacao_id, chave, ordem, data, descricao, descricao_limpa, valor, tipo, parcela_num, parcela_total, final, categoria)
    SELECT v_imp, k.chave, k.ordem, k.data, k.descricao, financ.fn_fatura_desc_limpa(k.descricao), k.valor, k.tipo, k.parcela_num, k.parcela_total, k.final,
           financ.fn_fatura_categoria(k.descricao, k.tipo)
      FROM com_chave k
    ON CONFLICT (importacao_id, chave) DO UPDATE SET ordem = EXCLUDED.ordem, final = EXCLUDED.final
    RETURNING i.chave
  )
  SELECT array_agg(chave) INTO v_chaves FROM gravados;

  -- itens que sumiram numa nova leitura (e ainda não foram usados) saem
  DELETE FROM financ.fatura_itens WHERE importacao_id = v_imp AND status = 'pendente' AND lancamento_id IS NULL
     AND NOT (chave = ANY (COALESCE(v_chaves, '{}')));

  RETURN financ.fn_conciliacao_fatura(jsonb_build_object('importacao_id', v_imp, 'resumido', p->'resumido'));
END $$;

-- ações da conferência: lançar o que falta, ignorar, usar o valor do banco, confirmar/desfazer ligação
CREATE OR REPLACE FUNCTION financ.fn_aplicar_conciliacao(p jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_imp int := financ.fn_fatura_importacao_alvo(p); imp financ.fatura_importacoes%ROWTYPE;
  v_acao text := COALESCE(financ.fn_norm(p->>'acao'), ''); v_ids int[]; conc jsonb; x jsonb; i financ.fatura_itens%ROWTYPE;
  v_cat text; r jsonb; v_lanc int; n int := 0; v_total numeric := 0; v_fat financ.faturas%ROWTYPE; v_erros jsonb := '[]'::jsonb; v_movidos int := 0;
BEGIN
  IF v_imp IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'codigo', 'sem_importacao', 'erro', 'Ainda não li o PDF dessa fatura.');
  END IF;
  SELECT * INTO imp FROM financ.fatura_importacoes WHERE id = v_imp;
  SELECT COALESCE(array_agg(v::int), '{}') INTO v_ids FROM jsonb_array_elements_text(COALESCE(p->'itens', '[]'::jsonb)) v WHERE v ~ '^\d+$';

  IF v_acao = 'nao_e_o_mesmo' THEN
    conc := financ.fn_conciliacao_fatura(jsonb_build_object('importacao_id', v_imp));
    FOR x IN SELECT e FROM jsonb_array_elements(conc->'itens') e
              WHERE e->>'estado' IN ('diferente', 'conferido') AND (e->>'id')::int = ANY (v_ids) AND e->'lancamento' IS NOT NULL LOOP
      UPDATE financ.fatura_itens SET rejeitados = array_append(rejeitados, (x->'lancamento'->>'id')::int), lancamento_id = NULL, status = 'pendente'
       WHERE id = (x->>'id')::int;
      n := n + 1;
    END LOOP;
    RETURN financ.fn_conciliacao_fatura(jsonb_build_object('importacao_id', v_imp, 'resumido', p->'resumido')) || jsonb_build_object('aplicado', n);
  END IF;

  IF v_acao IN ('ignorar', 'restaurar', 'desvincular') THEN
    UPDATE financ.fatura_itens SET
      status = CASE WHEN v_acao = 'ignorar' THEN 'ignorado' ELSE 'pendente' END,
      lancamento_id = CASE WHEN v_acao = 'desvincular' THEN NULL ELSE lancamento_id END
     WHERE importacao_id = v_imp AND id = ANY (v_ids);
    GET DIAGNOSTICS n = ROW_COUNT;
    RETURN financ.fn_conciliacao_fatura(jsonb_build_object('importacao_id', v_imp, 'resumido', p->'resumido')) || jsonb_build_object('aplicado', n);
  END IF;

  conc := financ.fn_conciliacao_fatura(jsonb_build_object('importacao_id', v_imp));

  IF v_acao IN ('vincular', 'usar_valor_banco') THEN
    FOR x IN SELECT e FROM jsonb_array_elements(conc->'itens') e WHERE e->>'estado' = 'diferente' AND (e->>'id')::int = ANY (v_ids) LOOP
      IF v_acao = 'usar_valor_banco' THEN
        UPDATE financ.lancamentos SET valor = (x->>'valor')::numeric, atualizado_em = now() WHERE id = (x->'lancamento'->>'id')::int;
      END IF;
      UPDATE financ.fatura_itens SET lancamento_id = (x->'lancamento'->>'id')::int, status = 'pendente' WHERE id = (x->>'id')::int;
      n := n + 1;
    END LOOP;
    RETURN financ.fn_conciliacao_fatura(jsonb_build_object('importacao_id', v_imp, 'resumido', p->'resumido')) || jsonb_build_object('aplicado', n);
  END IF;

  IF v_acao NOT IN ('lancar', 'lancar_todos') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Ação desconhecida: ' || COALESCE(v_acao, '?'));
  END IF;

  FOR x IN SELECT e FROM jsonb_array_elements(conc->'itens') e
            WHERE e->>'estado' = 'faltando' AND (v_acao = 'lancar_todos' OR (e->>'id')::int = ANY (v_ids)) LOOP
    SELECT * INTO i FROM financ.fatura_itens WHERE id = (x->>'id')::int;
    v_cat := COALESCE(NULLIF(p->'categorias'->>(i.id::text), ''), i.categoria, financ.fn_fatura_categoria(i.descricao, i.tipo));
    v_lanc := NULL;
    IF i.tipo <> 'estorno' AND i.parcela_total > 1 AND i.parcela_num BETWEEN 1 AND i.parcela_total THEN
      -- compra parcelada: cria esta parcela e as próximas (as próximas faturas já vêm conferidas)
      r := financ.fn_registrar_parcelamento(jsonb_build_object(
             'descricao', i.descricao_limpa, 'valor_parcela', i.valor, 'n_parcelas', i.parcela_total, 'primeira_parcela', i.parcela_num,
             'data_compra', to_char((i.data - make_interval(months => i.parcela_num - 1))::date, 'YYYY-MM-DD'),
             'cartao', '#' || imp.cartao_id, 'metodo', 'credito', 'categoria', v_cat,
             'mensagem_original', 'Fatura do banco: ' || i.descricao));
      IF (r->>'ok')::boolean THEN
        SELECT id INTO v_lanc FROM financ.lancamentos WHERE parcelamento_id = (r->>'parcelamento_id')::int AND parcela_num = i.parcela_num;
      END IF;
    ELSE
      r := financ.fn_registrar_lancamento(jsonb_build_object(
             'descricao', CASE WHEN i.tipo = 'estorno' THEN 'Estorno ' || i.descricao_limpa ELSE i.descricao_limpa END,
             'valor', i.valor, 'data', to_char(i.data, 'YYYY-MM-DD'), 'tipo', CASE WHEN i.tipo = 'estorno' THEN 'entrada' ELSE 'saida' END,
             'metodo', 'credito', 'cartao', '#' || imp.cartao_id, 'categoria', v_cat,
             'mensagem_original', 'Fatura do banco: ' || i.descricao));
      IF (r->>'ok')::boolean THEN v_lanc := (r->'lancamento'->>'id')::int; END IF;
      IF v_lanc IS NULL AND (r->>'ok')::boolean THEN v_lanc := (r->>'id')::int; END IF;
    END IF;
    IF v_lanc IS NULL THEN
      v_erros := v_erros || jsonb_build_object('item', i.id, 'erro', COALESCE(r->>'erro', 'não lançado'));
      CONTINUE;
    END IF;
    -- o banco diz em qual fatura entrou; o app segue isso
    UPDATE financ.lancamentos SET competencia = imp.competencia WHERE id = v_lanc AND competencia <> imp.competencia;
    INSERT INTO financ.faturas (cartao_id, competencia) VALUES (imp.cartao_id, imp.competencia) ON CONFLICT DO NOTHING;
    UPDATE financ.fatura_itens SET status = 'lancado', lancamento_id = v_lanc, categoria = v_cat WHERE id = i.id;
    n := n + 1; v_total := v_total + CASE WHEN i.tipo = 'estorno' THEN -i.valor ELSE i.valor END;
  END LOOP;

  -- gastos que já estavam no app, mas noutra fatura: o banco diz que são desta
  FOR x IN SELECT e FROM jsonb_array_elements(conc->'itens') e
            WHERE e->>'estado' IN ('conferido', 'lancado') AND (e->'lancamento'->>'outro_mes')::boolean
              AND (v_acao = 'lancar_todos' OR (e->>'id')::int = ANY (v_ids)) LOOP
    UPDATE financ.lancamentos SET competencia = imp.competencia, atualizado_em = now() WHERE id = (x->'lancamento'->>'id')::int;
    UPDATE financ.fatura_itens SET lancamento_id = (x->'lancamento'->>'id')::int WHERE id = (x->>'id')::int AND lancamento_id IS NULL;
    v_movidos := v_movidos + 1;
  END LOOP;
  IF v_movidos > 0 THEN
    INSERT INTO financ.faturas (cartao_id, competencia) VALUES (imp.cartao_id, imp.competencia) ON CONFLICT DO NOTHING;
  END IF;

  -- se a fatura já tinha o total informado igual ao do banco, o que entrou agora faz parte dele (não soma de novo)
  SELECT * INTO v_fat FROM financ.faturas WHERE cartao_id = imp.cartao_id AND competencia = imp.competencia;
  IF n > 0 AND v_fat.valor_ajustado IS NOT NULL AND imp.total IS NOT NULL AND abs(v_fat.valor_ajustado - imp.total) < 0.02 THEN
    UPDATE financ.faturas SET ajustado_em = now() WHERE id = v_fat.id;
  END IF;

  RETURN financ.fn_conciliacao_fatura(jsonb_build_object('importacao_id', v_imp, 'resumido', p->'resumido'))
         || jsonb_build_object('aplicado', n, 'valor_aplicado', v_total, 'movidos', v_movidos, 'erros', v_erros);
END $$;
