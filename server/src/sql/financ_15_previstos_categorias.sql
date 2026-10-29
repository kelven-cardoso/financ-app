-- Financ v2 · Migração 15 · previstos, valor da fixa por mês, categorias e fatura sem contar parcela duas vezes
-- 1) Parcelas de compras anteriores ao "total informado" da fatura não somam de novo depois dele
--    (a conferência da fatura cria as parcelas futuras com a data da parcela, mas a compra é antiga).
-- 2) Conta fixa / receita fixa com valor diferente (ou pulada) num mês específico: financ.recorrente_ajustes.
-- 3) financ.fn_previstos: o que ainda vai acontecer (fixas e receitas não lançadas), para o extrato do app.
-- 4) Categorias cadastradas (nome, ícone, tipo, ocultar), com renomear/juntar/excluir movendo os lançamentos.
-- Pode rodar de novo sem problema.

-- ============================================================== 1) fatura: parcela antiga não é "gasto depois do total informado"
CREATE OR REPLACE FUNCTION financ.fn_fatura_pos_ajuste(p_cartao_id integer, p_competencia date, p_ajustado_em timestamp with time zone)
 RETURNS numeric
 LANGUAGE sql
 STABLE
AS $function$
  -- o que entrou na fatura depois do total informado: lançado depois do ajuste E comprado a partir do dia do ajuste
  -- (para parcelas vale a data da compra, não a data da parcela: a parcela 3/3 de uma compra antiga já estava no total do banco)
  SELECT CASE WHEN p_ajustado_em IS NULL THEN 0 ELSE COALESCE(SUM(CASE WHEN l.tipo = 'saida' THEN l.valor ELSE -l.valor END), 0) END
    FROM financ.lancamentos l
    LEFT JOIN financ.parcelamentos pc ON pc.id = l.parcelamento_id
   WHERE l.cartao_id = p_cartao_id AND l.metodo = 'credito' AND l.competencia = financ.fn_mes(p_competencia)
     AND l.criado_em > p_ajustado_em
     AND COALESCE(pc.data_compra, l.data) >= (p_ajustado_em AT TIME ZONE 'America/Sao_Paulo')::date;
$function$;

-- ============================================================== 2) valor da fixa num mês específico
CREATE TABLE IF NOT EXISTS financ.recorrente_ajustes (
  id            serial PRIMARY KEY,
  recorrente_id int NOT NULL REFERENCES financ.recorrentes(id) ON DELETE CASCADE,
  competencia   date NOT NULL CHECK (competencia = date_trunc('month', competencia)::date),
  valor         numeric(12,2) CHECK (valor IS NULL OR valor >= 0),
  pular         boolean NOT NULL DEFAULT false,
  observacao    text,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (recorrente_id, competencia),
  CHECK (pular OR valor IS NOT NULL)
);

-- valor da fixa/receita fixa no mês (o mês do vencimento); NULL = não acontece nesse mês (pulada ou pendência cancelada)
CREATE OR REPLACE FUNCTION financ.fn_recorrente_valor_mes(p_id integer, p_mes date) RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN a.pular
                OR EXISTS (SELECT 1 FROM financ.pendencias pd WHERE pd.recorrente_id = r.id AND pd.competencia = financ.fn_mes(p_mes) AND pd.status = 'cancelada')
              THEN NULL ELSE COALESCE(a.valor, r.valor) END
    FROM financ.recorrentes r
    LEFT JOIN financ.recorrente_ajustes a ON a.recorrente_id = r.id AND a.competencia = financ.fn_mes(p_mes)
   WHERE r.id = p_id
$$;

-- a ocorrência do mês já virou lançamento? (no cartão, o lançamento fica na fatura em que cai o dia do vencimento)
CREATE OR REPLACE FUNCTION financ.fn_recorrente_lancada(p_id integer, p_mes date) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM financ.recorrentes r JOIN financ.lancamentos l ON l.recorrente_id = r.id
     WHERE r.id = p_id
       AND l.competencia = CASE WHEN l.metodo = 'credito' AND l.cartao_id IS NOT NULL
                                THEN financ.fn_competencia_credito(financ.fn_data_no_mes(financ.fn_mes(p_mes), r.dia_vencimento), l.cartao_id)
                                ELSE financ.fn_mes(p_mes) END)
$$;

-- ============================================================== 3) previstos (fixas e receitas fixas ainda não lançadas)
CREATE OR REPLACE FUNCTION financ.fn_previstos(p_de date, p_ate date) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_agg(x.j ORDER BY x.data, x.ord, x.id), '[]'::jsonb) FROM (
    SELECT rc.id, d.data, CASE WHEN rc.tipo = 'entrada' THEN 0 ELSE 1 END AS ord,
      jsonb_build_object(
        'recorrente_id', rc.id, 'mes', to_char(m, 'YYYY-MM'), 'data', d.data,
        'descricao', rc.descricao, 'categoria', rc.categoria, 'valor', v.val, 'valor_padrao', rc.valor, 'ajustado', v.val <> rc.valor,
        'tipo', rc.tipo, 'metodo', rc.metodo, 'cartao_id', rc.cartao_id, 'conta_id', rc.conta_id, 'confirmar', rc.confirmar,
        'competencia', to_char(financ.fn_competencia(d.data, rc.metodo, rc.cartao_id), 'YYYY-MM'),
        'atrasado', d.data < financ.fn_hoje(),
        'pendencia_id', (SELECT pd.id FROM financ.pendencias pd WHERE pd.recorrente_id = rc.id AND pd.competencia = m::date AND pd.status = 'aberta')) AS j
      FROM financ.recorrentes rc
      CROSS JOIN LATERAL generate_series(GREATEST(financ.fn_mes(p_de), financ.fn_mes(financ.fn_hoje()), financ.fn_mes(rc.inicio)),
                                         LEAST(financ.fn_mes(p_ate), COALESCE(financ.fn_mes(rc.fim), financ.fn_mes(p_ate))),
                                         interval '1 month') m
      CROSS JOIN LATERAL (SELECT financ.fn_data_no_mes(m::date, rc.dia_vencimento) AS data) d
      CROSS JOIN LATERAL (SELECT financ.fn_recorrente_valor_mes(rc.id, m::date) AS val) v
     WHERE rc.ativo AND v.val IS NOT NULL AND NOT financ.fn_recorrente_lancada(rc.id, m::date)
  ) x
$$;

-- ============================================================== 4) categorias
CREATE TABLE IF NOT EXISTS financ.categorias (
  id        serial PRIMARY KEY,
  nome      text NOT NULL CHECK (length(trim(nome)) BETWEEN 1 AND 60),
  icone     text CHECK (icone IS NULL OR icone ~ '^[a-z0-9-]{1,30}$'),
  tipo      text NOT NULL DEFAULT 'saida' CHECK (tipo IN ('saida','entrada','ambos')),
  ordem     int,
  oculta    boolean NOT NULL DEFAULT false,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_categorias_nome ON financ.categorias (financ.fn_norm(nome));

-- "jogos  online" -> "Jogos online" (só ajusta a primeira letra quando veio tudo minúsculo)
CREATE OR REPLACE FUNCTION financ.fn_categoria_nome(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN t IS NULL OR t = '' THEN NULL
              WHEN t = lower(t) THEN upper(left(t, 1)) || substr(t, 2)
              ELSE t END
    FROM (SELECT left(regexp_replace(trim(COALESCE(p, '')), '\s+', ' ', 'g'), 60) AS t) x
$$;

-- categorias padrão (as que o assistente usa) + as que já existem nos lançamentos
INSERT INTO financ.categorias (nome, icone, tipo, ordem)
SELECT x.nome, x.icone, x.tipo, x.ordem FROM (VALUES
  ('Alimentação', 'cesta', 'saida', 1), ('Restaurante', 'talheres', 'saida', 2), ('Transporte', 'carro', 'saida', 3),
  ('Moradia', 'casa', 'saida', 4), ('Saúde', 'saude', 'saida', 5), ('Lazer', 'lazer', 'saida', 6),
  ('Assinaturas', 'assinatura', 'saida', 7), ('Compras', 'sacola', 'saida', 8), ('Educação', 'educacao', 'saida', 9),
  ('Vestuário', 'roupa', 'saida', 10), ('Casa', 'sofa', 'saida', 11), ('Eletrônicos', 'eletronico', 'saida', 12),
  ('Pets', 'pet', 'saida', 13), ('Presentes', 'presente', 'saida', 14), ('Cuidados pessoais', 'cuidados', 'saida', 15),
  ('Investimentos', 'investimento', 'saida', 16), ('Impostos e taxas', 'imposto', 'saida', 17), ('Família', 'familia', 'saida', 18),
  ('Outros', 'outros', 'ambos', 99),
  ('Salário', 'salario', 'entrada', 1), ('Renda', 'salario', 'entrada', 2), ('Renda extra', 'trabalho', 'entrada', 3),
  ('Reembolso', 'reembolso', 'entrada', 4), ('Benefício', 'vale', 'entrada', 5)
) AS x(nome, icone, tipo, ordem)
ON CONFLICT DO NOTHING;

INSERT INTO financ.categorias (nome, tipo)
SELECT DISTINCT ON (financ.fn_norm(u.categoria)) financ.fn_categoria_nome(u.categoria),
       CASE WHEN bool_or(u.tipo = 'saida') OVER w AND bool_or(u.tipo = 'entrada') OVER w THEN 'ambos'
            WHEN bool_or(u.tipo = 'entrada') OVER w THEN 'entrada' ELSE 'saida' END
  FROM (SELECT categoria, tipo FROM financ.lancamentos
        UNION ALL SELECT categoria, tipo FROM financ.recorrentes
        UNION ALL SELECT categoria, 'saida' FROM financ.parcelamentos) u
 WHERE financ.fn_categoria_nome(u.categoria) IS NOT NULL
WINDOW w AS (PARTITION BY financ.fn_norm(u.categoria))
 ORDER BY financ.fn_norm(u.categoria), u.categoria
ON CONFLICT DO NOTHING;

-- categoria usada como entrada e saída vira "ambos"
UPDATE financ.categorias c SET tipo = 'ambos'
 WHERE c.tipo <> 'ambos'
   AND EXISTS (SELECT 1 FROM financ.lancamentos l WHERE financ.fn_norm(l.categoria) = financ.fn_norm(c.nome) AND l.tipo <> c.tipo);

-- todo lançamento/fixa/parcelamento usa a grafia cadastrada; categoria nova entra no cadastro sozinha
CREATE OR REPLACE FUNCTION financ.tg_categoria() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_nome text; v_tipo text := COALESCE(to_jsonb(NEW)->>'tipo', 'saida'); v_cad text;
BEGIN
  IF NEW.categoria IS NULL OR financ.fn_norm(NEW.categoria) IS NULL THEN RETURN NEW; END IF;
  IF v_tipo NOT IN ('saida','entrada') THEN v_tipo := 'saida'; END IF;
  SELECT nome, tipo INTO v_nome, v_cad FROM financ.categorias WHERE financ.fn_norm(nome) = financ.fn_norm(NEW.categoria);
  IF v_nome IS NULL THEN
    v_nome := financ.fn_categoria_nome(NEW.categoria);
    INSERT INTO financ.categorias (nome, tipo) VALUES (v_nome, v_tipo) ON CONFLICT DO NOTHING;
  ELSIF v_cad <> 'ambos' AND v_cad <> v_tipo THEN
    UPDATE financ.categorias SET tipo = 'ambos' WHERE financ.fn_norm(nome) = financ.fn_norm(v_nome);
  END IF;
  NEW.categoria := v_nome;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_lancamentos_categoria ON financ.lancamentos;
CREATE TRIGGER tg_lancamentos_categoria BEFORE INSERT OR UPDATE OF categoria ON financ.lancamentos
  FOR EACH ROW EXECUTE FUNCTION financ.tg_categoria();
DROP TRIGGER IF EXISTS tg_recorrentes_categoria ON financ.recorrentes;
CREATE TRIGGER tg_recorrentes_categoria BEFORE INSERT OR UPDATE OF categoria ON financ.recorrentes
  FOR EACH ROW EXECUTE FUNCTION financ.tg_categoria();
DROP TRIGGER IF EXISTS tg_parcelamentos_categoria ON financ.parcelamentos;
CREATE TRIGGER tg_parcelamentos_categoria BEFORE INSERT OR UPDATE OF categoria ON financ.parcelamentos
  FOR EACH ROW EXECUTE FUNCTION financ.tg_categoria();

-- leva tudo que está na categoria p_de para p_para (lançamentos, fixas, parcelamentos, itens da fatura e orçamentos)
CREATE OR REPLACE FUNCTION financ.fn_mover_categoria(p_de text, p_para text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE k text := financ.fn_norm(p_de); n int;
BEGIN
  UPDATE financ.lancamentos SET categoria = p_para, atualizado_em = now() WHERE financ.fn_norm(categoria) = k AND categoria IS DISTINCT FROM p_para;
  GET DIAGNOSTICS n = ROW_COUNT;
  UPDATE financ.recorrentes SET categoria = p_para WHERE financ.fn_norm(categoria) = k AND categoria IS DISTINCT FROM p_para;
  UPDATE financ.parcelamentos SET categoria = p_para WHERE financ.fn_norm(categoria) = k AND categoria IS DISTINCT FROM p_para;
  UPDATE financ.fatura_itens SET categoria = p_para WHERE financ.fn_norm(categoria) = k AND categoria IS DISTINCT FROM p_para;
  -- orçamento com o nome da categoria: renomeia se não colidir; senão passa a olhar a categoria nova
  UPDATE financ.orcamentos o SET categoria = p_para
   WHERE financ.fn_norm(o.categoria) = k
     AND NOT EXISTS (SELECT 1 FROM financ.orcamentos o2 WHERE o2.id <> o.id AND financ.fn_norm(o2.categoria) = financ.fn_norm(p_para));
  UPDATE financ.orcamentos o SET categorias = ARRAY[p_para]
   WHERE financ.fn_norm(o.categoria) = k AND (o.categorias IS NULL OR o.categorias = '{}');
  UPDATE financ.orcamentos SET categorias = ARRAY(SELECT DISTINCT CASE WHEN financ.fn_norm(x) = k THEN p_para ELSE x END FROM unnest(categorias) x)
   WHERE EXISTS (SELECT 1 FROM unnest(categorias) x WHERE financ.fn_norm(x) = k);
  UPDATE financ.orcamento_mes o SET categoria = p_para
   WHERE financ.fn_norm(o.categoria) = k
     AND NOT EXISTS (SELECT 1 FROM financ.orcamento_mes o2 WHERE o2.id <> o.id AND o2.competencia = o.competencia AND financ.fn_norm(o2.categoria) = financ.fn_norm(p_para));
  UPDATE financ.orcamento_mes SET categorias = ARRAY(SELECT DISTINCT CASE WHEN financ.fn_norm(x) = k THEN p_para ELSE x END FROM unnest(categorias) x)
   WHERE EXISTS (SELECT 1 FROM unnest(categorias) x WHERE financ.fn_norm(x) = k);
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION financ.fn_categorias_json(p_ocultas boolean DEFAULT true) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', c.id, 'nome', c.nome, 'icone', c.icone, 'tipo', c.tipo, 'oculta', c.oculta, 'ordem', c.ordem,
           'n', COALESCE(u.n, 0), 'n_saida', COALESCE(u.ns, 0), 'n_entrada', COALESCE(u.ne, 0), 'ultimo', u.ultimo,
           'n_fixas', COALESCE(r.n, 0))
         ORDER BY COALESCE(u.n, 0) DESC, c.ordem NULLS LAST, c.nome), '[]'::jsonb)
    FROM financ.categorias c
    LEFT JOIN (SELECT financ.fn_norm(categoria) AS k, count(*) AS n, count(*) FILTER (WHERE tipo = 'saida') AS ns,
                      count(*) FILTER (WHERE tipo = 'entrada') AS ne, max(data) AS ultimo
                 FROM financ.lancamentos GROUP BY 1) u ON u.k = financ.fn_norm(c.nome)
    LEFT JOIN (SELECT financ.fn_norm(categoria) AS k, count(*) AS n FROM financ.recorrentes GROUP BY 1) r ON r.k = financ.fn_norm(c.nome)
   WHERE p_ocultas OR NOT c.oculta
$$;

CREATE OR REPLACE FUNCTION financ.fn_gerenciar_categoria(p jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_acao text := COALESCE(financ.fn_norm(p->>'acao'), 'listar'); c financ.categorias%ROWTYPE; d financ.categorias%ROWTYPE;
  v_nome text; v_novo text; v_tipo text; v_n int := 0; v_destino text; v_icone text;
BEGIN
  IF v_acao IN ('listar','consultar') THEN
    RETURN jsonb_build_object('ok', true, 'categorias', financ.fn_categorias_json(financ.fn_bool(p, 'incluir_ocultas', true)));
  END IF;

  v_icone := lower(financ.fn_txt(p, 'icone'));
  IF v_icone IS NOT NULL AND v_icone !~ '^[a-z0-9-]{1,30}$' THEN v_icone := NULL; END IF;
  v_tipo := financ.fn_norm(p->>'tipo');
  IF v_tipo NOT IN ('saida','entrada','ambos') THEN v_tipo := NULL; END IF;

  IF v_acao IN ('criar','adicionar','nova','novo') THEN
    v_nome := financ.fn_categoria_nome(financ.fn_txt(p, 'nome'));
    IF v_nome IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Dê um nome para a categoria'); END IF;
    SELECT * INTO c FROM financ.categorias WHERE financ.fn_norm(nome) = financ.fn_norm(v_nome);
    IF FOUND THEN
      IF c.oculta THEN
        UPDATE financ.categorias SET oculta = false, icone = COALESCE(v_icone, icone) WHERE id = c.id RETURNING * INTO c;
        RETURN jsonb_build_object('ok', true, 'acao', 'reexibir', 'categoria', to_jsonb(c));
      END IF;
      RETURN jsonb_build_object('ok', false, 'codigo', 'existe', 'erro', format('A categoria %s já existe.', c.nome));
    END IF;
    INSERT INTO financ.categorias (nome, icone, tipo) VALUES (v_nome, v_icone, COALESCE(v_tipo, 'saida')) RETURNING * INTO c;
    RETURN jsonb_build_object('ok', true, 'acao', 'criar', 'categoria', to_jsonb(c));
  END IF;

  IF financ.fn_num(p, 'id') IS NOT NULL THEN
    SELECT * INTO c FROM financ.categorias WHERE id = financ.fn_num(p, 'id')::int;
  ELSE
    SELECT * INTO c FROM financ.categorias WHERE financ.fn_norm(nome) = financ.fn_norm(COALESCE(financ.fn_txt(p, 'nome'), financ.fn_txt(p, 'categoria')));
  END IF;
  IF c.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Categoria não encontrada'); END IF;

  IF v_acao IN ('editar','renomear','alterar') THEN
    v_novo := financ.fn_categoria_nome(financ.fn_txt(p, 'novo_nome'));
    IF v_novo IS NOT NULL AND v_novo IS DISTINCT FROM c.nome THEN
      SELECT * INTO d FROM financ.categorias WHERE financ.fn_norm(nome) = financ.fn_norm(v_novo) AND id <> c.id;
      IF d.id IS NOT NULL THEN
        -- já existe: junta as duas (só com confirmação)
        IF NOT financ.fn_bool(p, 'juntar', false) THEN
          RETURN jsonb_build_object('ok', false, 'codigo', 'existe', 'destino', d.nome,
            'erro', format('Já existe a categoria %s. Juntar %s nela?', d.nome, c.nome));
        END IF;
        v_n := financ.fn_mover_categoria(c.nome, d.nome);
        DELETE FROM financ.categorias WHERE id = c.id;
        UPDATE financ.categorias SET tipo = 'ambos' WHERE id = d.id AND tipo <> c.tipo AND tipo <> 'ambos';
        SELECT * INTO d FROM financ.categorias WHERE financ.fn_norm(nome) = financ.fn_norm(v_novo);
        RETURN jsonb_build_object('ok', true, 'acao', 'juntar', 'de', c.nome, 'para', d.nome, 'movidos', v_n, 'categoria', to_jsonb(d));
      END IF;
      UPDATE financ.categorias SET nome = v_novo WHERE id = c.id;
      v_n := financ.fn_mover_categoria(c.nome, v_novo);
    END IF;
    UPDATE financ.categorias SET
      icone  = CASE WHEN p ? 'icone' THEN v_icone ELSE icone END,
      tipo   = COALESCE(v_tipo, tipo),
      oculta = financ.fn_bool(p, 'oculta', oculta),
      ordem  = COALESCE(financ.fn_num(p, 'ordem')::int, ordem)
    WHERE id = c.id RETURNING * INTO c;
    RETURN jsonb_build_object('ok', true, 'acao', 'editar', 'movidos', v_n, 'categoria', to_jsonb(c));
  END IF;

  IF v_acao IN ('excluir','apagar','remover') THEN
    IF financ.fn_norm(c.nome) = 'outros' THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'Outros é a categoria padrão e não pode ser excluída.');
    END IF;
    SELECT (SELECT count(*) FROM financ.lancamentos WHERE financ.fn_norm(categoria) = financ.fn_norm(c.nome))
         + (SELECT count(*) FROM financ.recorrentes WHERE financ.fn_norm(categoria) = financ.fn_norm(c.nome))
         + (SELECT count(*) FROM financ.parcelamentos WHERE financ.fn_norm(categoria) = financ.fn_norm(c.nome)) INTO v_n;
    v_destino := financ.fn_categoria_nome(financ.fn_txt(p, 'mover_para'));
    IF v_n > 0 THEN
      IF v_destino IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'codigo', 'em_uso', 'em_uso', v_n,
          'erro', format('%s está em uso (%s). Escolha para qual categoria mover.', c.nome, v_n));
      END IF;
      SELECT * INTO d FROM financ.categorias WHERE financ.fn_norm(nome) = financ.fn_norm(v_destino) AND id <> c.id;
      IF d.id IS NULL THEN
        INSERT INTO financ.categorias (nome, tipo) VALUES (v_destino, c.tipo) RETURNING * INTO d;
      END IF;
      DELETE FROM financ.categorias WHERE id = c.id;
      PERFORM financ.fn_mover_categoria(c.nome, d.nome);
    ELSE
      DELETE FROM financ.categorias WHERE id = c.id;
    END IF;
    RETURN jsonb_build_object('ok', true, 'acao', 'excluir', 'excluida', c.nome, 'movidos', v_n, 'para', d.nome);
  END IF;

  RETURN jsonb_build_object('ok', false, 'erro', 'Ação desconhecida: ' || v_acao || ' (use listar, criar, editar, excluir)');
END $$;


-- ============================================================== painel, projeção, resumo e rotina usam o valor do mês
CREATE OR REPLACE FUNCTION financ.fn_painel(p_de date, p_ate date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE v_hoje date := financ.fn_hoje(); v_mes_hoje date := financ.fn_mes(v_hoje); m date; v_fim date; v_status text;
  r jsonb := '[]'::jsonb; v_ent numeric; v_ent_prev numeric; v_fix_prev numeric; v_fix_lanc numeric; v_outras numeric; v_parc numeric;
  v_fat jsonb; v_fat_total numeric; v_fat_aberto numeric; v_desp numeric; v_contas jsonb; v_saldo numeric; v_apagar numeric; v_livre numeric;
  v_chain numeric := NULL; v_ent_items jsonb; v_fix_items jsonb; v_ent_fut numeric; v_sai_fut numeric; v_ent_fut_items jsonb; v_sai_fut_items jsonb;
BEGIN
  FOR m IN SELECT generate_series(financ.fn_mes(p_de), financ.fn_mes(p_ate), interval '1 month')::date LOOP
    v_status := CASE WHEN m < v_mes_hoje THEN 'realizado' WHEN m = v_mes_hoje THEN 'em_andamento' ELSE 'projetado' END;
    v_fim := CASE WHEN v_status = 'em_andamento' THEN v_hoje ELSE (m + interval '1 month - 1 day')::date END;
    -- entradas
    SELECT COALESCE(SUM(valor),0) INTO v_ent FROM financ.lancamentos WHERE tipo = 'entrada' AND competencia = m AND financ.fn_conta_caixa(conta_id);
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'descricao', descricao, 'valor', valor, 'data', data, 'conta', (SELECT nome FROM financ.contas WHERE id = l.conta_id)) ORDER BY data), '[]'::jsonb)
      INTO v_ent_items FROM financ.lancamentos l WHERE tipo = 'entrada' AND competencia = m AND financ.fn_conta_caixa(l.conta_id);
    -- fixas/receitas fixas ainda não lançadas no mês, com o valor daquele mês (pode ter sido ajustado ou pulado)
    SELECT COALESCE(SUM(v.val) FILTER (WHERE rc.tipo='entrada'),0), COALESCE(SUM(v.val) FILTER (WHERE rc.tipo='saida'),0),
           COALESCE(jsonb_agg(jsonb_build_object('recorrente_id', rc.id, 'descricao', rc.descricao, 'valor', v.val, 'valor_padrao', rc.valor, 'ajustado', v.val <> rc.valor,
             'dia', rc.dia_vencimento, 'tipo', rc.tipo, 'metodo', rc.metodo) ORDER BY rc.dia_vencimento), '[]'::jsonb)
      INTO v_ent_prev, v_fix_prev, v_fix_items
      FROM financ.recorrentes rc CROSS JOIN LATERAL (SELECT financ.fn_recorrente_valor_mes(rc.id, m) AS val) v
     WHERE rc.ativo AND financ.fn_conta_caixa(rc.conta_id) AND rc.inicio <= (m + interval '1 month - 1 day')::date AND (rc.fim IS NULL OR rc.fim >= m)
       AND (v_status <> 'realizado')
       AND v.val IS NOT NULL
       AND NOT financ.fn_recorrente_lancada(rc.id, m);
    -- saídas pagas pela conta (não crédito)
    SELECT COALESCE(SUM(valor) FILTER (WHERE origem = 'recorrente'),0), COALESCE(SUM(valor) FILTER (WHERE origem = 'parcela'),0), COALESCE(SUM(valor) FILTER (WHERE origem = 'avulso'),0)
      INTO v_fix_lanc, v_parc, v_outras FROM financ.lancamentos WHERE tipo = 'saida' AND metodo <> 'credito' AND competencia = m AND financ.fn_conta_caixa(conta_id);
    -- lançamentos com data futura dentro do mês em andamento: ainda vão entrar/sair (contam no fim do mês, não no saldo de hoje)
    v_ent_fut := 0; v_sai_fut := 0; v_ent_fut_items := '[]'::jsonb; v_sai_fut_items := '[]'::jsonb;
    IF v_status = 'em_andamento' THEN
      SELECT COALESCE(SUM(valor),0), COALESCE(jsonb_agg(jsonb_build_object('id', id, 'descricao', descricao, 'valor', valor, 'data', data) ORDER BY data), '[]'::jsonb) INTO v_ent_fut, v_ent_fut_items
        FROM financ.lancamentos WHERE tipo = 'entrada' AND competencia = m AND data > v_hoje AND financ.fn_conta_caixa(conta_id);
      SELECT COALESCE(SUM(valor),0), COALESCE(jsonb_agg(jsonb_build_object('id', id, 'descricao', descricao, 'valor', valor, 'data', data) ORDER BY data), '[]'::jsonb) INTO v_sai_fut, v_sai_fut_items
        FROM financ.lancamentos WHERE tipo = 'saida' AND metodo <> 'credito' AND competencia = m AND data > v_hoje AND financ.fn_conta_caixa(conta_id);
    END IF;
    -- faturas (totais ajustados ou calculados) — inclui as que só têm o total informado
    SELECT COALESCE(jsonb_agg(jsonb_build_object('cartao', fi->>'cartao', 'cartao_id', c.id, 'competencia', fi->>'competencia', 'valor', fi->'valor_fatura', 'ajustada', fi->'valor_ajustado', 'calculada', fi->'valor_calculado',
             'itens', fi->'itens', 'status', fi->>'status', 'paga', fi->'paga', 'vencimento', fi->>'vencimento', 'fechamento', fi->>'fechamento', 'data_pagamento', fi->'data_pagamento') ORDER BY c.id), '[]'::jsonb),
           COALESCE(SUM((fi->>'valor_fatura')::numeric),0),
           COALESCE(SUM((fi->>'valor_fatura')::numeric) FILTER (WHERE NOT (fi->>'paga')::boolean OR (fi->>'data_pagamento')::date > v_fim),0)
      INTO v_fat, v_fat_total, v_fat_aberto
      FROM financ.cartoes c CROSS JOIN LATERAL financ.fn_fatura_info(c.id, m) fi
     WHERE c.ativo AND ((fi->>'itens')::int > 0 OR fi->'valor_ajustado' IS NOT NULL AND (fi->>'valor_ajustado') <> 'null');
    v_desp := v_fat_total + v_fix_lanc + v_fix_prev + v_parc + v_outras;
    -- saldo em conta na data de referência (real) — para meses futuros, projeta
    SELECT COALESCE(jsonb_agg(jsonb_build_object('nome', nome, 'tipo', tipo, 'saldo', financ.fn_saldo_conta(id, LEAST(v_fim, v_hoje))) ORDER BY id), '[]'::jsonb),
           SUM(financ.fn_saldo_conta(id, LEAST(v_fim, v_hoje)))
      INTO v_contas, v_saldo FROM financ.contas WHERE ativo AND tipo <> 'beneficio';
    -- a pagar: faturas ainda abertas com competência até o mês + fixas previstas (não lançadas)
    SELECT COALESCE(SUM((fi->>'valor_fatura')::numeric),0) INTO v_apagar
      FROM financ.cartoes c CROSS JOIN LATERAL generate_series((m - interval '6 months')::date, m, interval '1 month') mm
      CROSS JOIN LATERAL financ.fn_fatura_info(c.id, mm::date) fi
     WHERE c.ativo AND (fi->>'valor_fatura')::numeric <> 0 AND (NOT (fi->>'paga')::boolean OR (fi->>'data_pagamento')::date > v_fim);
    v_apagar := v_apagar + v_fix_prev + v_sai_fut;
    IF v_status = 'projetado' THEN v_apagar := v_fat_total + v_fix_prev; END IF;
    IF v_status = 'projetado' THEN
      -- encadeia a partir do mês anterior: saldo livre anterior + entradas previstas − despesas previstas
      v_saldo := NULL;
      v_livre := COALESCE(v_chain, 0) + (v_ent + v_ent_prev) - v_desp;
    ELSE
      v_livre := CASE WHEN v_saldo IS NULL THEN NULL ELSE v_saldo - v_apagar + v_ent_prev + v_ent_fut END;
    END IF;
    v_chain := v_livre;
    r := r || jsonb_build_object(
      'mes', to_char(m,'YYYY-MM'), 'status', v_status, 'data_ref', v_fim,
      'entradas', v_ent, 'entradas_previstas', v_ent_prev, 'entradas_itens', v_ent_items, 'total_entradas', v_ent + v_ent_prev,
      'faturas', v_fat, 'faturas_total', v_fat_total, 'faturas_em_aberto', v_fat_aberto,
      'fixas_lancadas', v_fix_lanc, 'fixas_previstas', v_fix_prev, 'fixas_previstas_itens', v_fix_items,
      'parcelas_conta', v_parc, 'outras_saidas', v_outras, 'total_despesas', v_desp,
      'resultado', (v_ent + v_ent_prev) - v_desp,
      'saldo_contas', v_contas, 'saldo_em_conta', v_saldo,
      'a_pagar', v_apagar, 'a_receber', v_ent_prev + v_ent_fut,
      'entradas_futuras', v_ent_fut, 'entradas_futuras_itens', v_ent_fut_items, 'saidas_futuras', v_sai_fut, 'saidas_futuras_itens', v_sai_fut_items,
      'saldo_livre', v_livre, 'saldo_informado', v_saldo IS NOT NULL,
      'nota', CASE v_status WHEN 'realizado' THEN 'saldo em conta no fim do mês; saldo livre = saldo − faturas que ainda estavam abertas'
                            WHEN 'em_andamento' THEN 'saldo em conta hoje; saldo livre no fim do mês = saldo hoje − a pagar (faturas abertas, fixas previstas e saídas já lançadas pra frente) + a receber (receitas fixas previstas e entradas já lançadas com data futura)'
                            ELSE 'projeção: saldo livre do mês anterior + entradas previstas − despesas previstas' END);
  END LOOP;
  RETURN r;
END $function$;


CREATE OR REPLACE FUNCTION financ.fn_projecao(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE v_hoje date := financ.fn_hoje(); v_ate date; v_de date; v_saldo_ini numeric := COALESCE(financ.fn_config('saldo_inicial','0')::numeric, 0);
  v_saldo_ref date := COALESCE(financ.fn_parse_mes(financ.fn_config('saldo_inicial_mes')), (SELECT COALESCE(MIN(competencia), financ.fn_mes(v_hoje)) FROM financ.lancamentos));
  m date; v_acum numeric; r jsonb := '[]'::jsonb; v_ent numeric; v_ent_prev numeric; v_fix numeric; v_fix_prev numeric; v_parc numeric; v_av numeric; v_aj numeric; v_cred jsonb; v_saldo_mes numeric;
BEGIN
  v_ate := COALESCE(financ.fn_parse_mes(financ.fn_txt(p,'ate')), financ.fn_parse_mes(financ.fn_txt(p,'mes')), (financ.fn_mes(v_hoje) + interval '2 month')::date);
  v_de := COALESCE(financ.fn_parse_mes(financ.fn_txt(p,'de')), LEAST(financ.fn_mes(v_hoje), v_saldo_ref));
  v_acum := v_saldo_ini;
  -- saldo acumulado considera tudo desde o mês de referência do saldo inicial
  IF v_saldo_ref < v_de THEN
    SELECT v_acum + COALESCE(SUM(CASE WHEN tipo='entrada' THEN valor ELSE -valor END),0) INTO v_acum FROM financ.lancamentos WHERE competencia >= v_saldo_ref AND competencia < v_de;
    v_acum := v_acum - financ.fn_ajuste_faturas(v_saldo_ref, (v_de - interval '1 month')::date);
  END IF;
  FOR m IN SELECT generate_series(v_de, v_ate, interval '1 month')::date LOOP
    SELECT COALESCE(SUM(valor) FILTER (WHERE tipo='entrada'),0),
           COALESCE(SUM(valor) FILTER (WHERE tipo='saida' AND origem='recorrente'),0),
           COALESCE(SUM(valor) FILTER (WHERE tipo='saida' AND origem='parcela'),0),
           COALESCE(SUM(valor) FILTER (WHERE tipo='saida' AND origem='avulso'),0)
      INTO v_ent, v_fix, v_parc, v_av FROM financ.lancamentos WHERE competencia = m;
    -- recorrentes ainda não lançadas neste mês (só a partir de hoje)
    SELECT COALESCE(SUM(v.val) FILTER (WHERE rc.tipo='entrada'),0), COALESCE(SUM(v.val) FILTER (WHERE rc.tipo='saida'),0) INTO v_ent_prev, v_fix_prev
    FROM financ.recorrentes rc CROSS JOIN LATERAL (SELECT financ.fn_recorrente_valor_mes(rc.id, m) AS val) v
    WHERE rc.ativo AND rc.inicio <= m AND (rc.fim IS NULL OR rc.fim >= m)
      AND financ.fn_data_no_mes(m, rc.dia_vencimento) >= v_hoje
      AND v.val IS NOT NULL
      AND NOT financ.fn_recorrente_lancada(rc.id, m);
    SELECT COALESCE(jsonb_agg(jsonb_build_object('cartao', c.nome, 'valor', fi->'valor_fatura', 'status', fi->>'status', 'vencimento', fi->>'vencimento')), '[]'::jsonb) INTO v_cred
      FROM financ.cartoes c CROSS JOIN LATERAL financ.fn_fatura_info(c.id, m) fi WHERE c.ativo AND (fi->>'itens')::int > 0;
    v_aj := financ.fn_ajuste_faturas(m, m);
    v_saldo_mes := (v_ent + v_ent_prev) - (v_fix + v_fix_prev + v_parc + v_av + v_aj);
    v_acum := v_acum + v_saldo_mes;
    r := r || jsonb_build_object('mes', to_char(m,'YYYY-MM'), 'status', CASE WHEN m < financ.fn_mes(v_hoje) THEN 'realizado' WHEN m = financ.fn_mes(v_hoje) THEN 'em_andamento' ELSE 'projetado' END,
      'entradas_lancadas', v_ent, 'entradas_previstas', v_ent_prev, 'fixas_lancadas', v_fix, 'fixas_previstas', v_fix_prev,
      'parcelas', v_parc, 'avulsos', v_av, 'ajuste_faturas', v_aj, 'total_saidas', v_fix + v_fix_prev + v_parc + v_av + v_aj, 'total_entradas', v_ent + v_ent_prev,
      'saldo_mes', v_saldo_mes, 'saldo_acumulado', v_acum, 'faturas', v_cred);
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'saldo_inicial', v_saldo_ini, 'saldo_inicial_mes', to_char(v_saldo_ref,'YYYY-MM'), 'hoje', v_hoje, 'meses', r,
    'nota', 'saldo_acumulado = saldo_inicial + soma dos saldos mensais (realizado + previsto). Use configurar(saldo_atual) para calibrar.');
END $function$;


CREATE OR REPLACE FUNCTION financ.fn_resumo_periodo(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE v_base text := COALESCE(financ.fn_norm(p->>'base'), 'competencia'); v_ini date; v_fim date; v_mes date; v_hoje date := financ.fn_hoje();
  r jsonb; v_sai numeric; v_ent numeric; v_prev_fix numeric; v_prev_ent numeric; v_qtd int; v_ajuste numeric;
BEGIN
  v_mes := financ.fn_parse_mes(financ.fn_txt(p,'mes'));
  IF v_mes IS NOT NULL THEN v_ini := v_mes; v_fim := (v_mes + interval '1 month - 1 day')::date;
  ELSE
    v_ini := financ.fn_parse_data(financ.fn_txt(p,'inicio'), financ.fn_mes(v_hoje));
    v_fim := financ.fn_parse_data(financ.fn_txt(p,'fim'), (financ.fn_mes(v_hoje) + interval '1 month - 1 day')::date);
  END IF;
  SELECT COALESCE(SUM(valor) FILTER (WHERE tipo='saida'),0), COALESCE(SUM(valor) FILTER (WHERE tipo='entrada'),0), COUNT(*) INTO v_sai, v_ent, v_qtd
    FROM financ.lancamentos l WHERE financ.fn_periodo_ok(l.data, l.competencia, v_base, v_ini, v_fim);
  IF v_base = 'competencia' THEN v_ajuste := financ.fn_ajuste_faturas(v_ini, v_fim); ELSE v_ajuste := 0; END IF;
  v_sai := v_sai + v_ajuste;
  -- previstos ainda não lançados (fixas/receitas com vencimento dentro do período e sem lançamento na competência)
  SELECT COALESCE(SUM(CASE WHEN rc.tipo='saida' THEN v.val END),0), COALESCE(SUM(CASE WHEN rc.tipo='entrada' THEN v.val END),0) INTO v_prev_fix, v_prev_ent
  FROM financ.recorrentes rc
  CROSS JOIN LATERAL generate_series(financ.fn_mes(v_ini), financ.fn_mes(v_fim), interval '1 month') m
  CROSS JOIN LATERAL (SELECT financ.fn_recorrente_valor_mes(rc.id, m::date) AS val) v
  WHERE rc.ativo AND rc.inicio <= m::date AND (rc.fim IS NULL OR rc.fim >= m::date)
    AND financ.fn_data_no_mes(m::date, rc.dia_vencimento) BETWEEN GREATEST(v_ini, v_hoje) AND v_fim
    AND v.val IS NOT NULL
    AND NOT financ.fn_recorrente_lancada(rc.id, m::date);
  r := jsonb_build_object(
    'ok', true, 'base', v_base, 'inicio', v_ini, 'fim', v_fim,
    'total_saidas', v_sai, 'ajuste_faturas', v_ajuste, 'total_entradas', v_ent, 'saldo', v_ent - v_sai,
    'previsto_fixas_nao_lancadas', v_prev_fix, 'previsto_entradas_nao_lancadas', v_prev_ent,
    'saldo_projetado_periodo', (v_ent + v_prev_ent) - (v_sai + v_prev_fix),
    'qtd_lancamentos', v_qtd,
    'por_categoria', COALESCE((SELECT jsonb_agg(jsonb_build_object('categoria', categoria, 'valor', s, 'qtd', q, 'pct', ROUND(100*s/NULLIF(v_sai,0),1)) ORDER BY s DESC)
       FROM (SELECT categoria, SUM(valor) s, COUNT(*) q FROM financ.lancamentos l WHERE financ.fn_periodo_ok(l.data, l.competencia, v_base, v_ini, v_fim) AND tipo='saida' GROUP BY categoria) x), '[]'::jsonb),
    'por_metodo', COALESCE((SELECT jsonb_agg(jsonb_build_object('metodo', metodo, 'cartao', cartao, 'valor', s, 'qtd', q) ORDER BY s DESC)
       FROM (SELECT t.metodo, c.nome cartao, SUM(t.valor) s, COUNT(*) q FROM financ.lancamentos t LEFT JOIN financ.cartoes c ON c.id=t.cartao_id
             WHERE financ.fn_periodo_ok(t.data, t.competencia, v_base, v_ini, v_fim) AND t.tipo='saida' GROUP BY t.metodo, c.nome) x), '[]'::jsonb),
    'por_origem', COALESCE((SELECT jsonb_agg(jsonb_build_object('origem', origem, 'valor', s, 'qtd', q) ORDER BY s DESC)
       FROM (SELECT origem, SUM(valor) s, COUNT(*) q FROM financ.lancamentos l WHERE financ.fn_periodo_ok(l.data, l.competencia, v_base, v_ini, v_fim) AND tipo='saida' GROUP BY origem) x), '[]'::jsonb),
    'maiores_gastos', COALESCE((SELECT jsonb_agg(jsonb_build_object('data', data, 'descricao', descricao, 'categoria', categoria, 'valor', valor, 'metodo', metodo) ORDER BY valor DESC)
       FROM (SELECT * FROM financ.lancamentos l WHERE financ.fn_periodo_ok(l.data, l.competencia, v_base, v_ini, v_fim) AND tipo='saida' ORDER BY valor DESC LIMIT 5) x), '[]'::jsonb),
    'entradas', COALESCE((SELECT jsonb_agg(jsonb_build_object('data', data, 'descricao', descricao, 'valor', valor) ORDER BY data)
       FROM financ.lancamentos l WHERE financ.fn_periodo_ok(l.data, l.competencia, v_base, v_ini, v_fim) AND tipo='entrada'), '[]'::jsonb),
    'orcamentos', CASE WHEN v_base = 'competencia' THEN (SELECT jsonb_agg(financ.fn_status_orcamento(categoria, financ.fn_mes(v_ini))) FROM financ.orcamentos WHERE ativo) END,
    'media_diaria_saidas', ROUND(v_sai / GREATEST(1, LEAST(v_fim, v_hoje) - v_ini + 1), 2)
  );
  RETURN r;
END $function$;


CREATE OR REPLACE FUNCTION financ.fn_rotina_diaria(p_data date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE v_hoje date := COALESCE(p_data, financ.fn_hoje()); v_mes date := financ.fn_mes(v_hoje); v_amanha date := v_hoje + 1;
  rc record; v_id int; v_comp date;
  fixas jsonb := '[]'::jsonb; receitas jsonb := '[]'::jsonb; lembretes jsonb := '[]'::jsonb; faturas jsonb := '[]'::jsonb; pend jsonb := '[]'::jsonb; orc jsonb := '[]'::jsonb;
  fi jsonb; c record; d record; v_resumo_semana jsonb; v_resumo_mes jsonb; v_sem_ini date; v_sem_fim date;
BEGIN
  FOR rc IN SELECT r.*, financ.fn_recorrente_valor_mes(r.id, v_mes) AS valor_mes FROM financ.recorrentes r
             WHERE r.ativo AND r.tipo = 'saida' AND r.inicio <= v_mes AND (r.fim IS NULL OR r.fim >= v_mes)
             AND financ.fn_data_no_mes(v_mes, r.dia_vencimento) = v_hoje
             AND financ.fn_recorrente_valor_mes(r.id, v_mes) IS NOT NULL
             AND NOT financ.fn_recorrente_lancada(r.id, v_mes)
             AND NOT EXISTS (SELECT 1 FROM financ.lancamentos l WHERE l.recorrente_id = r.id AND l.competencia = financ.fn_competencia(v_hoje, r.metodo, r.cartao_id)) LOOP
    v_comp := financ.fn_competencia(v_hoje, rc.metodo, rc.cartao_id);
    INSERT INTO financ.lancamentos (data, competencia, descricao, categoria, valor, tipo, metodo, cartao_id, conta_id, origem, recorrente_id, observacao)
    VALUES (v_hoje, v_comp, rc.descricao, rc.categoria, rc.valor_mes, 'saida', rc.metodo, rc.cartao_id, CASE WHEN rc.metodo = 'credito' THEN NULL ELSE COALESCE(rc.conta_id, financ.fn_conta_padrao()) END, 'recorrente', rc.id, 'gerado automaticamente')
    ON CONFLICT DO NOTHING RETURNING id INTO v_id;
    IF v_id IS NOT NULL THEN
      IF rc.cartao_id IS NOT NULL THEN INSERT INTO financ.faturas (cartao_id, competencia) VALUES (rc.cartao_id, v_comp) ON CONFLICT DO NOTHING; END IF;
      fixas := fixas || jsonb_build_object('descricao', rc.descricao, 'valor', rc.valor_mes, 'metodo', rc.metodo, 'categoria', rc.categoria, 'ajustado', rc.valor_mes <> rc.valor);
    END IF;
  END LOOP;
  FOR rc IN SELECT r.*, financ.fn_recorrente_valor_mes(r.id, v_mes) AS valor_mes FROM financ.recorrentes r
             WHERE r.ativo AND r.tipo = 'entrada' AND r.inicio <= v_mes AND (r.fim IS NULL OR r.fim >= v_mes)
             AND financ.fn_data_no_mes(v_mes, r.dia_vencimento) = v_hoje
             AND financ.fn_recorrente_valor_mes(r.id, v_mes) IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM financ.lancamentos l WHERE l.recorrente_id = r.id AND l.competencia = v_mes) LOOP
    IF rc.confirmar THEN
      INSERT INTO financ.pendencias (tipo, recorrente_id, competencia, descricao, valor_esperado) VALUES ('confirmar_receita', rc.id, v_mes, rc.descricao, rc.valor_mes)
      ON CONFLICT (recorrente_id, competencia) DO NOTHING RETURNING id INTO v_id;
      IF v_id IS NOT NULL THEN receitas := receitas || jsonb_build_object('descricao', rc.descricao, 'valor', rc.valor_mes); END IF;
    ELSE
      INSERT INTO financ.lancamentos (data, competencia, descricao, categoria, valor, tipo, metodo, conta_id, origem, recorrente_id, observacao)
      VALUES (v_hoje, v_mes, rc.descricao, rc.categoria, rc.valor_mes, 'entrada', rc.metodo, COALESCE(rc.conta_id, financ.fn_conta_padrao()), 'recorrente', rc.id, 'gerado automaticamente') ON CONFLICT DO NOTHING;
      fixas := fixas || jsonb_build_object('descricao', rc.descricao, 'valor', rc.valor_mes, 'metodo', rc.metodo, 'categoria', rc.categoria, 'tipo', 'entrada');
    END IF;
  END LOOP;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('descricao', pd.descricao, 'valor', pd.valor_esperado, 'desde', pd.criado_em::date)), '[]'::jsonb) INTO pend
    FROM financ.pendencias pd WHERE pd.status = 'aberta' AND pd.criado_em::date < v_hoje;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('descricao', r.descricao, 'valor', v.val, 'metodo', r.metodo, 'dia', r.dia_vencimento) ORDER BY v.val DESC), '[]'::jsonb) INTO lembretes
    FROM financ.recorrentes r CROSS JOIN LATERAL (SELECT financ.fn_recorrente_valor_mes(r.id, v_amanha) AS val) v
   WHERE r.ativo AND r.tipo = 'saida' AND r.lembrar_antes AND r.metodo <> 'credito'
      AND r.inicio <= financ.fn_mes(v_amanha) AND (r.fim IS NULL OR r.fim >= financ.fn_mes(v_amanha))
      AND financ.fn_data_no_mes(financ.fn_mes(v_amanha), r.dia_vencimento) = v_amanha
      AND v.val IS NOT NULL AND NOT financ.fn_recorrente_lancada(r.id, v_amanha);
  FOR c IN SELECT * FROM financ.cartoes WHERE ativo LOOP
    FOR d IN SELECT fi2 FROM (SELECT financ.fn_fatura_info(c.id, financ.fn_competencia_credito(v_hoje, c.id)) fi2
                              UNION ALL SELECT financ.fn_fatura_info(c.id, (financ.fn_competencia_credito(v_hoje, c.id) - interval '1 month')::date)) z LOOP
      fi := d.fi2;
      IF (fi->>'itens')::int = 0 THEN CONTINUE; END IF;
      IF NOT (fi->>'paga')::boolean AND (fi->>'fechamento')::date = v_amanha THEN faturas := faturas || (fi || jsonb_build_object('evento', 'fecha_amanha')); END IF;
      IF NOT (fi->>'paga')::boolean AND (fi->>'fechamento')::date = v_hoje THEN faturas := faturas || (fi || jsonb_build_object('evento', 'fecha_hoje')); END IF;
      IF NOT (fi->>'paga')::boolean AND (fi->>'vencimento')::date = v_hoje + 2 THEN faturas := faturas || (fi || jsonb_build_object('evento', 'vence_em_2_dias')); END IF;
      IF NOT (fi->>'paga')::boolean AND (fi->>'vencimento')::date = v_hoje THEN faturas := faturas || (fi || jsonb_build_object('evento', 'vence_hoje')); END IF;
    END LOOP;
  END LOOP;
  IF EXTRACT(isodow FROM v_hoje) = 1 THEN
    SELECT COALESCE(jsonb_agg(s), '[]'::jsonb) INTO orc FROM (SELECT financ.fn_status_orcamento(categoria, v_mes) s FROM financ.orcamentos WHERE ativo) x WHERE (s->>'pct')::numeric >= 90;
    v_sem_ini := v_hoje - 7; v_sem_fim := v_hoje - 1;
    v_resumo_semana := financ.fn_resumo_periodo(jsonb_build_object('base','data','inicio', v_sem_ini, 'fim', v_sem_fim));
  END IF;
  IF EXTRACT(day FROM v_hoje) = 1 THEN
    v_resumo_mes := financ.fn_resumo_periodo(jsonb_build_object('mes', to_char((v_mes - interval '1 month')::date,'YYYY-MM')));
  END IF;
  RETURN jsonb_build_object('data', v_hoje, 'fixas_registradas', fixas, 'receitas_perguntar', receitas, 'pendencias_antigas', pend,
    'vencem_amanha', lembretes, 'faturas', faturas, 'orcamentos_alerta', orc, 'resumo_semana', v_resumo_semana, 'resumo_mes_anterior', v_resumo_mes,
    'saldos', (SELECT COALESCE(jsonb_agg(jsonb_build_object('conta', nome, 'saldo', financ.fn_saldo_conta(id, v_hoje)) ORDER BY id), '[]'::jsonb) FROM financ.contas WHERE ativo),
    'resumo_mes_atual', (SELECT jsonb_build_object('saidas', r->'total_saidas', 'entradas', r->'total_entradas', 'saldo_projetado', r->'saldo_projetado_periodo') FROM financ.fn_resumo_periodo(jsonb_build_object('mes', to_char(v_mes,'YYYY-MM'))) r));
END $function$;


CREATE OR REPLACE FUNCTION financ.fn_confirmar_recebimento(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE v_acao text := COALESCE(financ.fn_norm(p->>'acao'), 'confirmar'); v_pd financ.pendencias%ROWTYPE; rc financ.recorrentes%ROWTYPE;
  v_desc text := financ.fn_norm(p->>'descricao'); v_valor numeric := financ.fn_num(p,'valor'); v_data date := financ.fn_parse_data(financ.fn_txt(p,'data'), financ.fn_hoje());
  v_conta int := financ.fn_resolver_conta(financ.fn_txt(p,'conta')); v_id int; v_comp date;
BEGIN
  SELECT pd.* INTO v_pd FROM financ.pendencias pd LEFT JOIN financ.recorrentes r ON r.id = pd.recorrente_id
   WHERE pd.status = 'aberta' AND (v_desc IS NULL OR v_desc = '' OR financ.fn_norm(COALESCE(pd.descricao, r.descricao)) LIKE '%' || v_desc || '%')
   ORDER BY pd.criado_em DESC LIMIT 1;
  IF v_acao IN ('cancelar','ignorar') THEN
    IF v_pd.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Nenhuma pendência aberta'); END IF;
    UPDATE financ.pendencias SET status = 'cancelada', resolvido_em = now() WHERE id = v_pd.id;
    RETURN jsonb_build_object('ok', true, 'acao', 'cancelar', 'pendencia', v_pd.descricao);
  END IF;
  IF v_acao IN ('listar','pendentes') THEN
    RETURN jsonb_build_object('ok', true, 'pendencias', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', id, 'descricao', descricao, 'valor_esperado', valor_esperado, 'competencia', to_char(competencia,'YYYY-MM'), 'criado_em', criado_em) ORDER BY criado_em DESC)
      FROM financ.pendencias WHERE status = 'aberta'), '[]'::jsonb));
  END IF;
  IF v_pd.id IS NOT NULL THEN
    SELECT * INTO rc FROM financ.recorrentes WHERE id = v_pd.recorrente_id;
    v_comp := v_pd.competencia;
    INSERT INTO financ.lancamentos (data, competencia, descricao, categoria, valor, tipo, metodo, conta_id, origem, recorrente_id, observacao)
    VALUES (v_data, v_comp, COALESCE(rc.descricao, v_pd.descricao), COALESCE(rc.categoria,'Renda'), COALESCE(v_valor, v_pd.valor_esperado), 'entrada', COALESCE(rc.metodo,'pix'), COALESCE(v_conta, rc.conta_id, financ.fn_conta_padrao()), 'recorrente', v_pd.recorrente_id, 'confirmado via WhatsApp')
    ON CONFLICT (recorrente_id, competencia) WHERE recorrente_id IS NOT NULL DO UPDATE SET valor = EXCLUDED.valor, data = EXCLUDED.data, conta_id = EXCLUDED.conta_id, atualizado_em = now()
    RETURNING id INTO v_id;
    UPDATE financ.pendencias SET status = 'confirmada', valor_confirmado = COALESCE(v_valor, v_pd.valor_esperado), resolvido_em = now() WHERE id = v_pd.id;
    RETURN jsonb_build_object('ok', true, 'acao', 'confirmar', 'lancamento', financ.fn_lancamento_json(v_id), 'pendencia_resolvida', true,
      'diferenca_esperado', CASE WHEN v_valor IS NOT NULL THEN v_valor - v_pd.valor_esperado END,
      'saldo_conta', (SELECT jsonb_build_object('conta', ct.nome, 'saldo', financ.fn_saldo_conta(ct.id)) FROM financ.lancamentos l JOIN financ.contas ct ON ct.id = l.conta_id WHERE l.id = v_id));
  END IF;
  IF v_desc IS NOT NULL AND v_desc <> '' THEN
    SELECT * INTO rc FROM financ.recorrentes WHERE tipo = 'entrada' AND ativo AND financ.fn_norm(descricao) LIKE '%' || v_desc || '%' ORDER BY id LIMIT 1;
  ELSE
    SELECT * INTO rc FROM financ.recorrentes WHERE tipo = 'entrada' AND ativo ORDER BY valor DESC LIMIT 1;
  END IF;
  IF rc.id IS NOT NULL THEN
    v_comp := financ.fn_mes(v_data);
    INSERT INTO financ.lancamentos (data, competencia, descricao, categoria, valor, tipo, metodo, conta_id, origem, recorrente_id, observacao)
    VALUES (v_data, v_comp, rc.descricao, rc.categoria, COALESCE(v_valor, financ.fn_recorrente_valor_mes(rc.id, v_comp), rc.valor), 'entrada', rc.metodo, COALESCE(v_conta, rc.conta_id, financ.fn_conta_padrao()), 'recorrente', rc.id, 'confirmado via WhatsApp')
    ON CONFLICT (recorrente_id, competencia) WHERE recorrente_id IS NOT NULL DO UPDATE SET valor = EXCLUDED.valor, data = EXCLUDED.data, conta_id = EXCLUDED.conta_id, atualizado_em = now()
    RETURNING id INTO v_id;
    UPDATE financ.pendencias SET status = 'confirmada', valor_confirmado = COALESCE(v_valor, financ.fn_recorrente_valor_mes(rc.id, v_comp), rc.valor), resolvido_em = now() WHERE recorrente_id = rc.id AND competencia = v_comp AND status = 'aberta';
    RETURN jsonb_build_object('ok', true, 'acao', 'confirmar', 'lancamento', financ.fn_lancamento_json(v_id), 'pendencia_resolvida', false,
      'saldo_conta', (SELECT jsonb_build_object('conta', ct.nome, 'saldo', financ.fn_saldo_conta(ct.id)) FROM financ.lancamentos l JOIN financ.contas ct ON ct.id = l.conta_id WHERE l.id = v_id));
  END IF;
  RETURN jsonb_build_object('ok', false, 'erro', 'Nenhuma pendência aberta nem receita recorrente correspondente. Use registrar_lancamento com tipo=entrada.');
END $function$;


-- ============================================================== fixas: ajustes por mês no JSON e nas ações
CREATE OR REPLACE FUNCTION financ.fn_recorrente_json(p_id integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  SELECT jsonb_build_object('id', r.id, 'descricao', r.descricao, 'categoria', r.categoria, 'valor', r.valor, 'tipo', r.tipo,
    'dia_vencimento', r.dia_vencimento, 'metodo', r.metodo, 'cartao', c.nome, 'conta', ct.nome, 'confirmar', r.confirmar, 'lembrar_antes', r.lembrar_antes,
    'inicio', r.inicio, 'fim', r.fim, 'ativo', r.ativo,
    'ajustes', COALESCE((SELECT jsonb_agg(jsonb_build_object('mes', to_char(a.competencia, 'YYYY-MM'), 'valor', a.valor, 'pular', a.pular, 'observacao', a.observacao) ORDER BY a.competencia)
                           FROM financ.recorrente_ajustes a WHERE a.recorrente_id = r.id AND a.competencia >= financ.fn_mes(financ.fn_hoje())), '[]'::jsonb))
  FROM financ.recorrentes r LEFT JOIN financ.cartoes c ON c.id = r.cartao_id LEFT JOIN financ.contas ct ON ct.id = r.conta_id WHERE r.id = p_id
$function$;


CREATE OR REPLACE FUNCTION financ.fn_gerenciar_recorrente(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE v_acao text := COALESCE(financ.fn_norm(p->>'acao'), 'criar'); v_id int; r financ.recorrentes%ROWTYPE;
  v_tipo text; v_metodo text; v_cartao int; v_conta int; v_dia int; v_hoje date := financ.fn_hoje(); v_prox date; v_desc text;
  v_mes date; v_venc date; v_comp date; v_lanc financ.lancamentos%ROWTYPE; v_val numeric; v_data date; v_lid int; v_ed jsonb;
BEGIN
  IF v_acao IN ('listar','consultar') THEN
    RETURN jsonb_build_object('ok', true, 'recorrentes', COALESCE((SELECT jsonb_agg(financ.fn_recorrente_json(id) ORDER BY tipo, dia_vencimento)
      FROM financ.recorrentes WHERE ativo OR financ.fn_bool(p,'incluir_inativos',false)), '[]'::jsonb));
  END IF;
  IF v_acao IN ('criar','adicionar','novo') THEN
    v_tipo := COALESCE(NULLIF(financ.fn_norm(p->>'tipo'),''), 'saida'); IF v_tipo NOT IN ('saida','entrada') THEN v_tipo := 'saida'; END IF;
    v_dia := financ.fn_num(p,'dia_vencimento')::int; v_desc := financ.fn_txt(p,'descricao');
    IF v_dia IS NULL OR v_dia < 1 OR v_dia > 31 THEN RETURN jsonb_build_object('ok', false, 'erro', 'Informe o dia do mês (1-31)'); END IF;
    IF v_desc IS NULL OR financ.fn_num(p,'valor') IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Informe descrição e valor'); END IF;
    v_metodo := COALESCE(financ.fn_metodo(p->>'metodo'), 'pix');
    v_cartao := financ.fn_resolver_cartao(financ.fn_txt(p,'cartao'));
    v_conta := financ.fn_resolver_conta(financ.fn_txt(p,'conta'));
    IF v_conta IS NOT NULL AND NOT financ.fn_conta_caixa(v_conta) AND financ.fn_metodo(p->>'metodo') IS NULL THEN v_metodo := 'vale'; END IF;
    IF v_metodo = 'vale' AND (v_conta IS NULL OR financ.fn_conta_caixa(v_conta)) THEN v_conta := financ.fn_conta_beneficio(financ.fn_txt(p,'conta')); END IF;
    IF v_metodo = 'credito' AND v_cartao IS NULL THEN v_cartao := financ.fn_cartao_padrao(); END IF;
    IF v_metodo <> 'credito' THEN v_cartao := NULL; IF v_conta IS NULL THEN v_conta := financ.fn_conta_padrao(); END IF; ELSE v_conta := NULL; END IF;
    INSERT INTO financ.recorrentes (descricao, categoria, valor, tipo, dia_vencimento, metodo, cartao_id, conta_id, confirmar, lembrar_antes, inicio, fim)
    VALUES (v_desc, COALESCE(financ.fn_txt(p,'categoria'), CASE WHEN v_tipo='entrada' THEN 'Renda' ELSE 'Outros' END), financ.fn_num(p,'valor'), v_tipo, v_dia, v_metodo, v_cartao, v_conta,
      financ.fn_bool(p,'confirmar', v_tipo = 'entrada'), financ.fn_bool(p,'lembrar_antes', true),
      COALESCE(financ.fn_parse_mes(financ.fn_txt(p,'inicio')), financ.fn_mes(v_hoje)), financ.fn_parse_mes(financ.fn_txt(p,'fim')))
    RETURNING id INTO v_id;
    v_prox := financ.fn_data_no_mes(v_hoje, v_dia); IF v_prox < v_hoje THEN v_prox := financ.fn_data_no_mes((financ.fn_mes(v_hoje) + interval '1 month')::date, v_dia); END IF;
    RETURN jsonb_build_object('ok', true, 'acao', 'criar', 'recorrente', financ.fn_recorrente_json(v_id), 'proxima_ocorrencia', v_prox);
  END IF;
  IF financ.fn_num(p,'id') IS NOT NULL THEN v_id := financ.fn_num(p,'id')::int;
  ELSE SELECT id INTO v_id FROM financ.recorrentes WHERE financ.fn_norm(descricao) LIKE '%' || financ.fn_norm(p->>'descricao') || '%' ORDER BY ativo DESC, id DESC LIMIT 1; END IF;
  SELECT * INTO r FROM financ.recorrentes WHERE id = v_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Recorrente não encontrado'); END IF;
  -- ---------------------------------------------------------------- ações de um mês só (mes = YYYY-MM do vencimento; vazio = mês atual)
  IF v_acao IN ('ajustar_mes','valor_mes','mudar_mes','alterar_mes','pular_mes','pular','desfazer_mes','restaurar_mes','voltar_padrao',
                'lancar_mes','lancar_agora','ja_paguei','paguei','recebi') THEN
    v_mes := COALESCE(financ.fn_parse_mes(financ.fn_txt(p,'mes')), financ.fn_mes(v_hoje));
    IF v_mes < financ.fn_mes(r.inicio) OR (r.fim IS NOT NULL AND v_mes > r.fim) THEN
      RETURN jsonb_build_object('ok', false, 'erro', format('%s não vale em %s (vai de %s%s).', r.descricao, to_char(v_mes,'MM/YYYY'),
        to_char(r.inicio,'MM/YYYY'), COALESCE(' a ' || to_char(r.fim,'MM/YYYY'), ' em diante')));
    END IF;
    v_venc := financ.fn_data_no_mes(v_mes, r.dia_vencimento);
    SELECT l.* INTO v_lanc FROM financ.lancamentos l
     WHERE l.recorrente_id = r.id
       AND l.competencia = CASE WHEN l.metodo = 'credito' AND l.cartao_id IS NOT NULL THEN financ.fn_competencia_credito(v_venc, l.cartao_id) ELSE v_mes END
     ORDER BY l.id DESC LIMIT 1;

    IF v_acao IN ('ajustar_mes','valor_mes','mudar_mes','alterar_mes') THEN
      v_val := financ.fn_num(p,'valor');
      IF v_val IS NULL OR v_val <= 0 THEN RETURN jsonb_build_object('ok', false, 'erro', 'Informe o valor deste mês (para não ter nesse mês, use pular_mes).'); END IF;
      IF v_lanc.id IS NOT NULL THEN
        -- já lançada: corrige o lançamento
        v_ed := financ.fn_editar_lancamento(jsonb_build_object('id', v_lanc.id, 'valor', v_val));
        IF NOT COALESCE((v_ed->>'ok')::boolean, false) THEN RETURN v_ed; END IF;
        RETURN jsonb_build_object('ok', true, 'acao', 'ajustar_mes', 'mes', to_char(v_mes,'YYYY-MM'), 'valor', v_val, 'lancamento_atualizado', true,
          'lancamento', financ.fn_lancamento_json(v_lanc.id), 'recorrente', financ.fn_recorrente_json(r.id));
      END IF;
      IF v_val = r.valor THEN
        DELETE FROM financ.recorrente_ajustes WHERE recorrente_id = r.id AND competencia = v_mes;
      ELSE
        INSERT INTO financ.recorrente_ajustes (recorrente_id, competencia, valor, pular, observacao)
        VALUES (r.id, v_mes, v_val, false, financ.fn_txt(p,'observacao'))
        ON CONFLICT (recorrente_id, competencia) DO UPDATE
          SET valor = EXCLUDED.valor, pular = false, observacao = COALESCE(EXCLUDED.observacao, financ.recorrente_ajustes.observacao), atualizado_em = now();
      END IF;
      UPDATE financ.pendencias SET valor_esperado = v_val WHERE recorrente_id = r.id AND competencia = v_mes AND status = 'aberta';
      RETURN jsonb_build_object('ok', true, 'acao', 'ajustar_mes', 'mes', to_char(v_mes,'YYYY-MM'), 'valor', v_val, 'valor_padrao', r.valor,
        'vencimento', v_venc, 'recorrente', financ.fn_recorrente_json(r.id));
    END IF;

    IF v_acao IN ('pular_mes','pular') THEN
      IF v_lanc.id IS NOT NULL THEN
        RETURN jsonb_build_object('ok', false, 'erro', format('%s de %s já foi lançada (%s, R$ %s). Se não aconteceu, exclua esse lançamento.',
          r.descricao, to_char(v_mes,'MM/YYYY'), to_char(v_lanc.data,'DD/MM'), replace(to_char(v_lanc.valor, 'FM999999990.00'), '.', ',')), 'lancamento', financ.fn_lancamento_json(v_lanc.id));
      END IF;
      INSERT INTO financ.recorrente_ajustes (recorrente_id, competencia, valor, pular, observacao)
      VALUES (r.id, v_mes, NULL, true, financ.fn_txt(p,'observacao'))
      ON CONFLICT (recorrente_id, competencia) DO UPDATE
        SET valor = NULL, pular = true, observacao = COALESCE(EXCLUDED.observacao, financ.recorrente_ajustes.observacao), atualizado_em = now();
      UPDATE financ.pendencias SET status = 'cancelada', resolvido_em = now() WHERE recorrente_id = r.id AND competencia = v_mes AND status = 'aberta';
      RETURN jsonb_build_object('ok', true, 'acao', 'pular_mes', 'mes', to_char(v_mes,'YYYY-MM'), 'vencimento', v_venc, 'recorrente', financ.fn_recorrente_json(r.id));
    END IF;

    IF v_acao IN ('desfazer_mes','restaurar_mes','voltar_padrao') THEN
      DELETE FROM financ.recorrente_ajustes WHERE recorrente_id = r.id AND competencia = v_mes;
      UPDATE financ.pendencias SET status = 'aberta', resolvido_em = NULL WHERE recorrente_id = r.id AND competencia = v_mes AND status = 'cancelada';
      UPDATE financ.pendencias SET valor_esperado = r.valor WHERE recorrente_id = r.id AND competencia = v_mes AND status = 'aberta';
      RETURN jsonb_build_object('ok', true, 'acao', 'desfazer_mes', 'mes', to_char(v_mes,'YYYY-MM'), 'valor', r.valor, 'recorrente', financ.fn_recorrente_json(r.id));
    END IF;

    -- lancar_mes: "já paguei" / "já recebi" (antes do dia ou atrasada)
    IF v_lanc.id IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'erro', format('%s de %s já está lançada (%s, R$ %s).', r.descricao, to_char(v_mes,'MM/YYYY'),
        to_char(v_lanc.data,'DD/MM'), replace(to_char(v_lanc.valor, 'FM999999990.00'), '.', ',')), 'lancamento', financ.fn_lancamento_json(v_lanc.id));
    END IF;
    IF v_mes > financ.fn_mes(v_hoje) THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'Dá para lançar só a do mês atual ou de meses anteriores. Para um mês futuro, ajuste o valor ou pule o mês.');
    END IF;
    v_val := COALESCE(financ.fn_num(p,'valor'), financ.fn_recorrente_valor_mes(r.id, v_mes), r.valor);
    IF v_val IS NULL OR v_val <= 0 THEN RETURN jsonb_build_object('ok', false, 'erro', 'Informe o valor.'); END IF;
    IF r.metodo = 'credito' AND r.cartao_id IS NOT NULL THEN
      v_data := v_venc;  -- no cartão a cobrança cai no dia do vencimento
      v_comp := financ.fn_competencia_credito(v_data, r.cartao_id);
      v_conta := NULL;
    ELSE
      v_data := financ.fn_parse_data(financ.fn_txt(p,'data'), LEAST(v_venc, v_hoje));
      v_comp := v_mes;   -- é a conta daquele mês, mesmo paga em outro dia
      v_conta := COALESCE(financ.fn_resolver_conta(financ.fn_txt(p,'conta')), r.conta_id, financ.fn_conta_padrao());
    END IF;
    INSERT INTO financ.lancamentos (data, competencia, descricao, categoria, valor, tipo, metodo, cartao_id, conta_id, origem, recorrente_id, observacao)
    VALUES (v_data, v_comp, r.descricao, r.categoria, v_val, r.tipo, r.metodo, CASE WHEN r.metodo = 'credito' THEN r.cartao_id END, v_conta,
            'recorrente', r.id, COALESCE(financ.fn_txt(p,'observacao'), 'lançado manualmente'))
    RETURNING id INTO v_lid;
    IF r.metodo = 'credito' AND r.cartao_id IS NOT NULL THEN
      INSERT INTO financ.faturas (cartao_id, competencia) VALUES (r.cartao_id, v_comp) ON CONFLICT DO NOTHING;
    END IF;
    UPDATE financ.pendencias SET status = 'confirmada', valor_confirmado = v_val, resolvido_em = now()
     WHERE recorrente_id = r.id AND competencia = v_mes AND status = 'aberta';
    DELETE FROM financ.recorrente_ajustes WHERE recorrente_id = r.id AND competencia = v_mes AND pular;
    RETURN jsonb_build_object('ok', true, 'acao', 'lancar_mes', 'mes', to_char(v_mes,'YYYY-MM'), 'lancamento', financ.fn_lancamento_json(v_lid),
      'recorrente', financ.fn_recorrente_json(r.id),
      'saldo_conta', CASE WHEN v_conta IS NOT NULL THEN (SELECT jsonb_build_object('conta', ct.nome, 'saldo', financ.fn_saldo_conta(ct.id)) FROM financ.contas ct WHERE ct.id = v_conta) END);
  END IF;
  IF v_acao IN ('desativar','encerrar','cancelar','parar') THEN
    UPDATE financ.recorrentes SET ativo = false, fim = COALESCE(financ.fn_parse_mes(financ.fn_txt(p,'fim')), financ.fn_mes(v_hoje)) WHERE id = v_id;
  ELSIF v_acao IN ('reativar','ativar') THEN
    UPDATE financ.recorrentes SET ativo = true, fim = NULL WHERE id = v_id;
  ELSIF v_acao IN ('excluir','apagar','remover') THEN
    DELETE FROM financ.pendencias WHERE recorrente_id = v_id;
    UPDATE financ.lancamentos SET recorrente_id = NULL WHERE recorrente_id = v_id;
    DELETE FROM financ.recorrentes WHERE id = v_id;
    RETURN jsonb_build_object('ok', true, 'acao', 'excluir', 'excluido', r.descricao);
  ELSE
    v_metodo := COALESCE(financ.fn_metodo(p->>'metodo'), r.metodo);
    v_cartao := CASE WHEN financ.fn_txt(p,'cartao') IS NOT NULL THEN financ.fn_resolver_cartao(financ.fn_txt(p,'cartao')) ELSE r.cartao_id END;
    v_conta := CASE WHEN financ.fn_txt(p,'conta') IS NOT NULL THEN financ.fn_resolver_conta(financ.fn_txt(p,'conta')) ELSE r.conta_id END;
    IF v_conta IS NOT NULL AND NOT financ.fn_conta_caixa(v_conta) AND financ.fn_metodo(p->>'metodo') IS NULL THEN v_metodo := 'vale'; END IF;
    IF v_metodo = 'vale' AND (v_conta IS NULL OR financ.fn_conta_caixa(v_conta)) THEN v_conta := financ.fn_conta_beneficio(financ.fn_txt(p,'conta')); END IF;
    IF v_metodo = 'credito' AND v_cartao IS NULL THEN v_cartao := financ.fn_cartao_padrao(); END IF;
    IF v_metodo <> 'credito' THEN v_cartao := NULL; IF v_conta IS NULL THEN v_conta := financ.fn_conta_padrao(); END IF; ELSE v_conta := NULL; END IF;
    UPDATE financ.recorrentes SET
      descricao = COALESCE(financ.fn_txt(p,'nova_descricao'), descricao),
      categoria = COALESCE(financ.fn_txt(p,'categoria'), categoria),
      valor = COALESCE(financ.fn_num(p,'valor'), valor),
      dia_vencimento = COALESCE(financ.fn_num(p,'dia_vencimento')::int, dia_vencimento),
      metodo = v_metodo, cartao_id = v_cartao, conta_id = v_conta,
      confirmar = financ.fn_bool(p,'confirmar', confirmar), lembrar_antes = financ.fn_bool(p,'lembrar_antes', lembrar_antes),
      fim = COALESCE(financ.fn_parse_mes(financ.fn_txt(p,'fim')), fim)
    WHERE id = v_id;
  END IF;
  RETURN jsonb_build_object('ok', true, 'acao', v_acao, 'recorrente', financ.fn_recorrente_json(v_id));
END $function$;


-- ============================================================== contexto do assistente: categorias cadastradas e meses especiais das fixas
CREATE OR REPLACE FUNCTION financ.fn_contexto_agente()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  SELECT financ.fn_contexto_agente_base() || jsonb_build_object(
    'caixinhas', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'nome', nome, 'apelidos', to_jsonb(apelidos), 'saldo', financ.fn_caixinha_saldo(id), 'rendimento', rendimento) ORDER BY id), '[]'::jsonb) FROM financ.caixinhas WHERE ativo),
    'guardado_total', (SELECT COALESCE(SUM(financ.fn_caixinha_saldo(id)),0) FROM financ.caixinhas WHERE ativo),
    'categorias', (SELECT jsonb_build_object(
                     'saida', COALESCE(jsonb_agg(c.nome ORDER BY c.ordem NULLS LAST, c.nome) FILTER (WHERE c.tipo IN ('saida','ambos')), '[]'::jsonb),
                     'entrada', COALESCE(jsonb_agg(c.nome ORDER BY c.ordem NULLS LAST, c.nome) FILTER (WHERE c.tipo IN ('entrada','ambos')), '[]'::jsonb))
                     FROM financ.categorias c WHERE NOT c.oculta),
    'fixas_meses_especiais', (SELECT COALESCE(jsonb_agg(jsonb_build_object('recorrente_id', r.id, 'descricao', r.descricao, 'mes', to_char(a.competencia,'YYYY-MM'),
                                'valor', a.valor, 'valor_padrao', r.valor, 'pulada', a.pular) ORDER BY a.competencia, r.descricao), '[]'::jsonb)
                                FROM financ.recorrente_ajustes a JOIN financ.recorrentes r ON r.id = a.recorrente_id
                               WHERE r.ativo AND a.competencia >= financ.fn_mes(financ.fn_hoje())));
$function$;
