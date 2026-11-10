-- Financ · Migração 16: acertos da auditoria de 10/11/2026
--  1) lançamento com o nome de uma fixa do mês ("internet paga") vira o lançamento da fixa, em vez de avulso
--  2) categoria: sem categoria (ou "Outros"), usa a que a mesma descrição já teve
--  3) confirmar recebimento nunca sobrescreve uma receita fixa já lançada no mês (dois salários no mês)
--  4) propostas (e-mail / notificação) não perguntam o que já está lançado nem o que outra origem já propôs
--  5) consulta SQL livre do agente roda com um usuário só de leitura, sem acesso às chaves da config

-- ============================================================== 2) categoria que a descrição já teve
CREATE OR REPLACE FUNCTION financ.fn_categoria_historica(p_desc text, p_tipo text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT l.categoria FROM financ.lancamentos l
   WHERE l.tipo = p_tipo AND financ.fn_norm(l.descricao) = financ.fn_norm(p_desc)
     AND financ.fn_norm(l.categoria) IS DISTINCT FROM 'outros'
   GROUP BY l.categoria ORDER BY count(*) DESC, max(l.id) DESC LIMIT 1
$$;

-- ============================================================== 1) registrar lançamento (liga à fixa do mês)
CREATE OR REPLACE FUNCTION financ.fn_registrar_lancamento(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE v_desc text := financ.fn_txt(p,'descricao'); v_valor numeric := financ.fn_num(p,'valor');
  v_tipo text := COALESCE(financ.fn_norm(p->>'tipo'), 'saida'); v_metodo text := financ.fn_metodo(p->>'metodo');
  v_cartao int := financ.fn_resolver_cartao(financ.fn_txt(p,'cartao')); v_cat text := financ.fn_txt(p,'categoria');
  v_conta int := financ.fn_resolver_conta(financ.fn_txt(p,'conta'));
  v_data date := financ.fn_parse_data(financ.fn_txt(p,'data'), financ.fn_hoje()); v_comp date; v_id int; v_assumido text := '';
  v_fatura jsonb; v_orc jsonb; rc financ.recorrentes%ROWTYPE; v_mes date; v_fixa jsonb; v_hist text; v_cat_hist boolean := false; v_prop int;
BEGIN
  IF v_valor IS NULL OR v_valor <= 0 THEN RETURN jsonb_build_object('ok', false, 'erro', 'Valor inválido ou ausente'); END IF;
  IF v_tipo NOT IN ('saida','entrada') THEN v_tipo := 'saida'; END IF;
  v_mes := financ.fn_mes(v_data);

  -- é a fixa do mês? mesmo nome (ou nome contido, com valor parecido), ainda não lançada neste mês
  IF v_desc IS NOT NULL AND NOT financ.fn_bool(p,'avulso',false) THEN
    SELECT r.* INTO rc
      FROM financ.recorrentes r
      CROSS JOIN LATERAL (SELECT COALESCE((SELECT a.valor FROM financ.recorrente_ajustes a
                                            WHERE a.recorrente_id = r.id AND a.competencia = v_mes AND NOT a.pular), r.valor) AS ref,
                                 financ.fn_norm(r.descricao) AS nr, financ.fn_norm(v_desc) AS nl) x
     WHERE r.ativo AND r.tipo = v_tipo AND financ.fn_mes(r.inicio) <= v_mes AND (r.fim IS NULL OR r.fim >= v_mes)
       AND NOT financ.fn_recorrente_lancada(r.id, v_mes)
       AND ((x.nl = x.nr AND v_valor BETWEEN x.ref * 0.5 AND x.ref * 2)
            OR (strpos(' ' || x.nl || ' ', ' ' || x.nr || ' ') > 0 AND v_valor BETWEEN x.ref * 0.7 AND x.ref * 1.3)
            OR (length(x.nl) >= 4 AND strpos(' ' || x.nr || ' ', ' ' || x.nl || ' ') > 0 AND v_valor BETWEEN x.ref * 0.85 AND x.ref * 1.15))
     ORDER BY (x.nl = x.nr) DESC, abs(v_valor - x.ref), abs(r.dia_vencimento - EXTRACT(day FROM v_data)::int), r.id
     LIMIT 1;
  END IF;
  IF rc.id IS NOT NULL THEN
    -- sem método dito, vale o da fixa; a descrição e a categoria ficam as da fixa
    IF v_metodo IS NULL AND v_cartao IS NULL THEN
      v_metodo := rc.metodo;
      IF rc.metodo = 'credito' THEN v_cartao := rc.cartao_id; END IF;
    END IF;
    IF v_metodo <> 'credito' AND v_conta IS NULL THEN v_conta := rc.conta_id; END IF;
    IF v_cat IS NULL OR financ.fn_norm(v_cat) = 'outros' THEN v_cat := rc.categoria; END IF;
    v_desc := rc.descricao;
  END IF;

  IF v_desc IS NULL THEN v_desc := CASE WHEN v_tipo = 'entrada' THEN 'Entrada' ELSE 'Gasto' END; END IF;
  -- sem categoria (ou "Outros"): a que essa mesma descrição já teve
  IF v_cat IS NULL OR financ.fn_norm(v_cat) = 'outros' THEN
    v_hist := financ.fn_categoria_historica(v_desc, v_tipo);
    IF v_hist IS NOT NULL THEN v_cat := v_hist; v_cat_hist := true; END IF;
  END IF;
  v_cat := COALESCE(v_cat, 'Outros');

  -- conta de benefício informada sem método: é vale
  IF v_metodo IS NULL AND v_conta IS NOT NULL AND NOT financ.fn_conta_caixa(v_conta) THEN v_metodo := 'vale'; END IF;
  IF v_metodo IS NULL THEN
    IF v_tipo = 'entrada' THEN v_metodo := 'pix';
    ELSIF v_cartao IS NOT NULL THEN v_metodo := 'credito';
    ELSE v_metodo := COALESCE(financ.fn_metodo(financ.fn_config('metodo_padrao')), 'credito'); v_assumido := 'metodo'; END IF;
  END IF;
  IF v_metodo = 'credito' AND v_cartao IS NULL THEN
    v_cartao := financ.fn_cartao_padrao();
    v_assumido := trim(both ',' from v_assumido || ',cartao');
  END IF;
  IF v_metodo <> 'credito' THEN v_cartao := NULL; END IF;
  -- vale sempre sai/entra na conta de benefício
  IF v_metodo = 'vale' AND (v_conta IS NULL OR financ.fn_conta_caixa(v_conta)) THEN
    v_conta := financ.fn_conta_beneficio(financ.fn_txt(p,'conta'));
    IF v_conta IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'Nenhum cartão de benefício (vale) cadastrado. Cadastre no app ou peça: cria a conta VA do tipo benefício.'); END IF;
  END IF;
  IF v_metodo = 'credito' THEN v_conta := NULL;
  ELSIF v_conta IS NULL THEN v_conta := financ.fn_conta_padrao(); v_assumido := trim(both ',' from v_assumido || ',conta'); END IF;
  v_comp := financ.fn_competencia(v_data, v_metodo, v_cartao);

  IF rc.id IS NOT NULL THEN
    BEGIN
      INSERT INTO financ.lancamentos (data, competencia, descricao, categoria, valor, tipo, metodo, cartao_id, conta_id, origem, recorrente_id, observacao, mensagem_original)
      VALUES (v_data, v_comp, v_desc, v_cat, v_valor, v_tipo, v_metodo, v_cartao, v_conta, 'recorrente', rc.id,
              COALESCE(financ.fn_txt(p,'observacao'), 'lançado manualmente'), financ.fn_txt(p,'mensagem_original'))
      RETURNING id INTO v_id;
    EXCEPTION WHEN unique_violation THEN
      v_id := NULL;  -- outro mês da mesma fixa já caiu nessa fatura: segue como avulso
    END;
    IF v_id IS NOT NULL THEN
      UPDATE financ.pendencias SET status = 'confirmada', valor_confirmado = v_valor, resolvido_em = now()
       WHERE recorrente_id = rc.id AND competencia = v_mes AND status IN ('aberta','cancelada');
      DELETE FROM financ.recorrente_ajustes WHERE recorrente_id = rc.id AND competencia = v_mes AND pular;
      v_fixa := jsonb_build_object('recorrente_id', rc.id, 'descricao', rc.descricao, 'mes', to_char(v_mes, 'YYYY-MM'),
                                   'valor_padrao', rc.valor, 'valor_diferente', v_valor <> rc.valor);
    END IF;
  END IF;
  IF v_id IS NULL THEN
    INSERT INTO financ.lancamentos (data, competencia, descricao, categoria, valor, tipo, metodo, cartao_id, conta_id, origem, observacao, mensagem_original)
    VALUES (v_data, v_comp, v_desc, v_cat, v_valor, v_tipo, v_metodo, v_cartao, v_conta, 'avulso', financ.fn_txt(p,'observacao'), financ.fn_txt(p,'mensagem_original'))
    RETURNING id INTO v_id;
  END IF;
  IF v_cartao IS NOT NULL THEN
    INSERT INTO financ.faturas (cartao_id, competencia) VALUES (v_cartao, v_comp) ON CONFLICT DO NOTHING;
    v_fatura := financ.fn_fatura_info(v_cartao, v_comp);
  END IF;
  -- lançado na mão enquanto havia uma proposta igual em aberto: fecha a proposta (quando não é a própria proposta sendo confirmada)
  IF financ.fn_txt(p,'_proposta_id') IS NULL THEN
    UPDATE financ.propostas SET status = 'ja_lancada', resolvido_em = now(),
           resultado = jsonb_build_object('motivo', 'lancado_manual', 'lancamento_id', v_id)
     WHERE id = (SELECT o.id FROM financ.propostas o
                  WHERE o.status = 'aberta' AND o.tipo = 'lancamento' AND COALESCE(financ.fn_norm(o.dados->>'tipo'), 'saida') = v_tipo
                    AND financ.fn_num(o.dados,'valor') = v_valor
                    AND financ.fn_parse_data(o.dados->>'data', o.criado_em::date) = v_data
                  ORDER BY o.id LIMIT 1)
    RETURNING id INTO v_prop;
  END IF;
  -- orçamento conta pela data do gasto (não pelo mês da fatura)
  IF v_tipo = 'saida' AND financ.fn_conta_caixa(v_conta) THEN v_orc := financ.fn_status_orcamento(v_cat, financ.fn_mes(v_data)); END IF;
  RETURN jsonb_build_object('ok', true, 'lancamento', financ.fn_lancamento_json(v_id), 'assumido', NULLIF(v_assumido,''),
    'padrao_aplicado', v_assumido <> '',
    'fixa_vinculada', v_fixa, 'categoria_do_historico', v_cat_hist, 'proposta_fechada', v_prop,
    'fatura', v_fatura, 'orcamento', v_orc,
    'saldo_conta', CASE WHEN v_conta IS NOT NULL THEN jsonb_build_object('conta', (SELECT nome FROM financ.contas WHERE id = v_conta), 'saldo', financ.fn_saldo_conta(v_conta)) END);
END $function$;

-- ============================================================== 3) confirmar recebimento sem sobrescrever
CREATE OR REPLACE FUNCTION financ.fn_confirmar_recebimento(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE v_acao text := COALESCE(financ.fn_norm(p->>'acao'), 'confirmar'); v_pd financ.pendencias%ROWTYPE; rc financ.recorrentes%ROWTYPE;
  v_desc text := financ.fn_norm(p->>'descricao'); v_valor numeric := financ.fn_num(p,'valor'); v_data date := financ.fn_parse_data(financ.fn_txt(p,'data'), financ.fn_hoje());
  v_conta int := financ.fn_resolver_conta(financ.fn_txt(p,'conta')); v_id int; v_comp date; v_ja financ.lancamentos%ROWTYPE; v_val numeric;
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

  -- com pergunta em aberto: resolve a pergunta
  IF v_pd.id IS NOT NULL THEN
    SELECT * INTO rc FROM financ.recorrentes WHERE id = v_pd.recorrente_id;
    v_comp := v_pd.competencia;
    v_val := COALESCE(v_valor, v_pd.valor_esperado);
    SELECT l.* INTO v_ja FROM financ.lancamentos l WHERE l.recorrente_id = v_pd.recorrente_id AND l.competencia = v_comp ORDER BY l.id DESC LIMIT 1;
    IF v_ja.id IS NOT NULL THEN
      -- já tinha entrado por outro caminho: só acerta o valor se ele informou um, e fecha a pergunta
      v_id := v_ja.id;
      IF v_valor IS NOT NULL AND v_valor <> v_ja.valor THEN UPDATE financ.lancamentos SET valor = v_valor, atualizado_em = now() WHERE id = v_id; END IF;
      v_val := COALESCE(v_valor, v_ja.valor);
    ELSE
      INSERT INTO financ.lancamentos (data, competencia, descricao, categoria, valor, tipo, metodo, conta_id, origem, recorrente_id, observacao)
      VALUES (v_data, v_comp, COALESCE(rc.descricao, v_pd.descricao), COALESCE(rc.categoria,'Renda'), v_val, 'entrada', COALESCE(rc.metodo,'pix'),
              COALESCE(v_conta, rc.conta_id, financ.fn_conta_padrao()), 'recorrente', v_pd.recorrente_id, 'confirmado via WhatsApp')
      RETURNING id INTO v_id;
    END IF;
    UPDATE financ.pendencias SET status = 'confirmada', valor_confirmado = v_val, resolvido_em = now() WHERE id = v_pd.id;
    RETURN jsonb_build_object('ok', true, 'acao', 'confirmar', 'lancamento', financ.fn_lancamento_json(v_id), 'pendencia_resolvida', true,
      'diferenca_esperado', CASE WHEN v_valor IS NOT NULL THEN v_valor - v_pd.valor_esperado END,
      'saldo_conta', (SELECT jsonb_build_object('conta', ct.nome, 'saldo', financ.fn_saldo_conta(ct.id)) FROM financ.lancamentos l JOIN financ.contas ct ON ct.id = l.conta_id WHERE l.id = v_id));
  END IF;

  -- sem pergunta em aberto: a receita fixa do mês que ainda não entrou, a de vencimento mais perto da data (e de valor mais perto)
  v_comp := financ.fn_mes(v_data);
  SELECT r.* INTO rc FROM financ.recorrentes r
   WHERE r.tipo = 'entrada' AND r.ativo AND financ.fn_mes(r.inicio) <= v_comp AND (r.fim IS NULL OR r.fim >= v_comp)
     AND (v_desc IS NULL OR v_desc = '' OR financ.fn_norm(r.descricao) LIKE '%' || v_desc || '%')
   ORDER BY EXISTS (SELECT 1 FROM financ.lancamentos l WHERE l.recorrente_id = r.id AND l.competencia = v_comp),
            abs(r.dia_vencimento - EXTRACT(day FROM v_data)::int),
            CASE WHEN v_valor IS NOT NULL THEN abs(r.valor - v_valor) ELSE 0 END, r.id
   LIMIT 1;
  IF rc.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Nenhuma pendência aberta nem receita recorrente correspondente. Use registrar_lancamento com tipo=entrada.');
  END IF;
  SELECT l.* INTO v_ja FROM financ.lancamentos l WHERE l.recorrente_id = rc.id AND l.competencia = v_comp ORDER BY l.id DESC LIMIT 1;
  IF v_ja.id IS NOT NULL THEN
    -- nunca sobrescreve o que já entrou neste mês
    RETURN jsonb_build_object('ok', false, 'ja_lancada', true,
      'erro', format('%s de %s já está lançada (%s, R$ %s). Se for outra receita, registre com registrar_lancamento (tipo=entrada); para corrigir o valor ou a data, use editar_lancamento no id %s.',
        rc.descricao, to_char(v_comp,'MM/YYYY'), to_char(v_ja.data,'DD/MM'), replace(to_char(v_ja.valor, 'FM999999990.00'), '.', ','), v_ja.id),
      'lancamento', financ.fn_lancamento_json(v_ja.id));
  END IF;
  v_val := COALESCE(v_valor, financ.fn_recorrente_valor_mes(rc.id, v_comp), rc.valor);
  INSERT INTO financ.lancamentos (data, competencia, descricao, categoria, valor, tipo, metodo, conta_id, origem, recorrente_id, observacao)
  VALUES (v_data, v_comp, rc.descricao, rc.categoria, v_val, 'entrada', rc.metodo, COALESCE(v_conta, rc.conta_id, financ.fn_conta_padrao()), 'recorrente', rc.id, 'confirmado via WhatsApp')
  RETURNING id INTO v_id;
  UPDATE financ.pendencias SET status = 'confirmada', valor_confirmado = v_val, resolvido_em = now()
   WHERE recorrente_id = rc.id AND competencia = v_comp AND status IN ('aberta','cancelada');
  DELETE FROM financ.recorrente_ajustes WHERE recorrente_id = rc.id AND competencia = v_comp AND pular;
  RETURN jsonb_build_object('ok', true, 'acao', 'confirmar', 'lancamento', financ.fn_lancamento_json(v_id), 'pendencia_resolvida', false,
    'saldo_conta', (SELECT jsonb_build_object('conta', ct.nome, 'saldo', financ.fn_saldo_conta(ct.id)) FROM financ.lancamentos l JOIN financ.contas ct ON ct.id = l.conta_id WHERE l.id = v_id));
END $function$;

-- ============================================================== 4) propostas: não perguntar o que já está lançado
ALTER TABLE financ.propostas DROP CONSTRAINT IF EXISTS propostas_status_check;
ALTER TABLE financ.propostas ADD CONSTRAINT propostas_status_check
  CHECK (status = ANY (ARRAY['aberta','confirmada','rejeitada','ja_lancada','duplicada']));

CREATE OR REPLACE FUNCTION financ.fn_criar_proposta(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE v_id int; pr financ.propostas%ROWTYPE; d jsonb; v_valor numeric; v_data date; v_tipo text; v_credito boolean;
  v_motivo text; v_res jsonb; v_x int; v_cartao int; v_mes date;
BEGIN
  INSERT INTO financ.propostas (origem, ref, tipo, dados, resumo)
  VALUES (COALESCE(financ.fn_txt(p,'origem'),'email'), financ.fn_txt(p,'ref'), COALESCE(financ.fn_norm(p->>'tipo'),'lancamento'), COALESCE(p->'dados','{}'::jsonb), financ.fn_txt(p,'resumo'))
  ON CONFLICT (ref) DO NOTHING RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'duplicada', true); END IF;
  SELECT * INTO pr FROM financ.propostas WHERE id = v_id;
  d := pr.dados; v_valor := financ.fn_num(d,'valor'); v_tipo := COALESCE(financ.fn_norm(d->>'tipo'), 'saida');
  v_data := financ.fn_parse_data(d->>'data', financ.fn_hoje());
  v_credito := COALESCE(financ.fn_metodo(d->>'metodo') = 'credito', false);

  IF v_valor IS NOT NULL AND pr.tipo = 'lancamento' AND v_tipo IN ('saida','entrada') THEN
    -- a) lançamento igual, do mesmo dia, que nenhuma outra proposta já "usou"
    SELECT l.id INTO v_x FROM financ.lancamentos l
     WHERE l.tipo = v_tipo AND l.valor = v_valor AND l.data = v_data AND (l.metodo = 'credito') = v_credito
       AND NOT EXISTS (SELECT 1 FROM financ.propostas o WHERE o.id <> v_id
                        AND (o.resultado->>'lancamento_id' = l.id::text OR o.resultado->'lancamento'->>'id' = l.id::text))
     ORDER BY l.id DESC LIMIT 1;
    IF v_x IS NOT NULL THEN v_motivo := 'ja_lancada'; v_res := jsonb_build_object('motivo', 'lancamento_existente', 'lancamento_id', v_x); END IF;
    -- b) pagamento de fatura já registrado
    IF v_motivo IS NULL AND v_tipo = 'saida' AND NOT v_credito THEN
      SELECT m.id INTO v_x FROM financ.movimentos_conta m
       WHERE m.tipo = 'pagamento_fatura' AND m.valor = -v_valor AND abs(m.data - v_data) <= 3
         AND NOT EXISTS (SELECT 1 FROM financ.propostas o WHERE o.id <> v_id AND o.resultado->>'movimento_id' = m.id::text)
       ORDER BY m.id DESC LIMIT 1;
      IF v_x IS NOT NULL THEN v_motivo := 'ja_lancada'; v_res := jsonb_build_object('motivo', 'pagamento_fatura_existente', 'movimento_id', v_x); END IF;
    END IF;
  ELSIF v_valor IS NOT NULL AND pr.tipo = 'lancamento' AND v_tipo = 'transferencia' THEN
    SELECT m.id INTO v_x FROM financ.movimentos_conta m
     WHERE m.tipo = 'transferencia' AND m.valor = -v_valor AND abs(m.data - v_data) <= 1
       AND NOT EXISTS (SELECT 1 FROM financ.propostas o WHERE o.id <> v_id AND o.resultado->>'movimento_id' = m.id::text)
     ORDER BY m.id DESC LIMIT 1;
    IF v_x IS NOT NULL THEN v_motivo := 'ja_lancada'; v_res := jsonb_build_object('motivo', 'transferencia_existente', 'movimento_id', v_x); END IF;
  ELSIF v_valor IS NOT NULL AND pr.tipo = 'fatura' THEN
    v_cartao := financ.fn_resolver_cartao(financ.fn_txt(d,'cartao')); v_mes := financ.fn_parse_mes(financ.fn_txt(d,'mes'));
    SELECT f.id INTO v_x FROM financ.faturas f
     WHERE f.cartao_id = v_cartao AND f.valor_ajustado = v_valor
       AND (v_mes IS NULL OR f.competencia BETWEEN (v_mes - interval '1 month')::date AND (v_mes + interval '1 month')::date)
     ORDER BY f.competencia DESC LIMIT 1;
    IF v_x IS NOT NULL THEN v_motivo := 'ja_lancada'; v_res := jsonb_build_object('motivo', 'fatura_ja_ajustada', 'fatura_id', v_x); END IF;
  END IF;

  -- c) a mesma coisa já proposta por outra origem (e-mail x notificação) nos últimos dias
  IF v_motivo IS NULL AND v_valor IS NOT NULL THEN
    SELECT o.id INTO v_x FROM financ.propostas o
     WHERE o.id <> v_id AND o.origem <> pr.origem AND o.tipo = pr.tipo AND o.status IN ('aberta','confirmada')
       AND o.criado_em > now() - interval '5 days'
       AND financ.fn_num(o.dados,'valor') = v_valor
       AND COALESCE(financ.fn_norm(o.dados->>'tipo'), 'saida') = v_tipo
       AND CASE WHEN pr.tipo = 'fatura' THEN o.dados->>'mes' IS NOT DISTINCT FROM d->>'mes'
                ELSE abs(financ.fn_parse_data(o.dados->>'data', o.criado_em::date) - v_data) <= 1 END
       AND NOT EXISTS (SELECT 1 FROM financ.propostas z WHERE z.id <> v_id AND z.resultado->>'proposta_id' = o.id::text)
     ORDER BY o.id DESC LIMIT 1;
    IF v_x IS NOT NULL THEN v_motivo := 'duplicada'; v_res := jsonb_build_object('motivo', 'outra_origem', 'proposta_id', v_x); END IF;
  END IF;

  IF v_motivo IS NOT NULL THEN
    UPDATE financ.propostas SET status = v_motivo, resolvido_em = now(), resultado = v_res WHERE id = v_id;
    RETURN jsonb_build_object('ok', false, 'duplicada', true, 'id', v_id, 'status', v_motivo) || v_res;
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'proposta', financ.fn_proposta_json(v_id));
END $function$;

CREATE OR REPLACE FUNCTION financ.fn_propostas(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE v_acao text := COALESCE(financ.fn_norm(p->>'acao'), 'listar'); v_id int; pr financ.propostas%ROWTYPE; v_dados jsonb; v_res jsonb; k text;
BEGIN
  IF v_acao IN ('listar','abertas') THEN
    RETURN jsonb_build_object('ok', true, 'propostas', COALESCE((SELECT jsonb_agg(financ.fn_proposta_json(id) ORDER BY id) FROM financ.propostas WHERE status = 'aberta'), '[]'::jsonb));
  END IF;
  IF financ.fn_num(p,'id') IS NOT NULL THEN v_id := financ.fn_num(p,'id')::int;
  ELSE SELECT id INTO v_id FROM financ.propostas WHERE status = 'aberta' ORDER BY id DESC LIMIT 1; END IF;
  SELECT * INTO pr FROM financ.propostas WHERE id = v_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erro', 'Proposta não encontrada'); END IF;
  IF pr.status <> 'aberta' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Proposta #' || pr.id || ' já está ' ||
      CASE pr.status WHEN 'ja_lancada' THEN 'lançada (o lançamento já existia)' WHEN 'duplicada' THEN 'resolvida (era repetida)' ELSE pr.status END);
  END IF;
  IF v_acao IN ('rejeitar','ignorar','nao','não','recusar') THEN
    UPDATE financ.propostas SET status = 'rejeitada', resolvido_em = now() WHERE id = v_id;
    RETURN jsonb_build_object('ok', true, 'acao', 'rejeitar', 'proposta', financ.fn_proposta_json(v_id));
  END IF;
  IF v_acao IN ('confirmar','lancar','lançar','sim','aceitar') THEN
    v_dados := pr.dados;
    FOREACH k IN ARRAY ARRAY['descricao','valor','categoria','metodo','cartao','conta','data','tipo','observacao','mes','de','para'] LOOP
      IF financ.fn_txt(p,k) IS NOT NULL THEN v_dados := v_dados || jsonb_build_object(k, p->>k); END IF;
    END LOOP;
    IF pr.tipo = 'fatura' THEN
      v_res := financ.fn_gerenciar_fatura(jsonb_build_object('acao','ajustar') || v_dados);
    ELSIF v_dados->>'tipo' = 'transferencia' THEN
      v_res := financ.fn_movimento_conta(jsonb_build_object('acao','transferir') || v_dados);
    ELSE
      v_res := financ.fn_registrar_lancamento(v_dados || jsonb_build_object('_proposta_id', pr.id,
        'observacao', COALESCE(v_dados->>'observacao', 'via ' || CASE pr.origem WHEN 'notificacao' THEN 'notificação' ELSE 'e-mail' END || ' (proposta #' || pr.id || ')')));
    END IF;
    IF COALESCE((v_res->>'ok')::boolean, false) THEN
      UPDATE financ.propostas SET status = 'confirmada', resolvido_em = now(), resultado = v_res, dados = v_dados WHERE id = v_id;
    END IF;
    RETURN jsonb_build_object('ok', (v_res->>'ok')::boolean, 'acao', 'confirmar', 'proposta_id', v_id, 'resultado', v_res);
  END IF;
  RETURN jsonb_build_object('ok', false, 'erro', 'Ação inválida: ' || v_acao);
END $function$;

-- ============================================================== 5) usuário só de leitura para a consulta SQL do agente
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'financ_leitura') THEN
    CREATE ROLE financ_leitura NOLOGIN;
  END IF;
  GRANT USAGE ON SCHEMA financ TO financ_leitura;
  GRANT SELECT ON ALL TABLES IN SCHEMA financ TO financ_leitura;
  ALTER DEFAULT PRIVILEGES IN SCHEMA financ GRANT SELECT ON TABLES TO financ_leitura;
  -- as chaves secretas da config ficam invisíveis para esse usuário (o dono do banco continua vendo tudo)
  ALTER TABLE financ.config ENABLE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS leitura_sem_segredos ON financ.config;
  CREATE POLICY leitura_sem_segredos ON financ.config FOR SELECT TO financ_leitura
    USING (chave !~* '(token|key|senha|secret)');
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'financ_leitura: sem permissão para criar o usuário de leitura; fn_sql_leitura recusa consultas até ele existir';
END $$;

CREATE OR REPLACE FUNCTION financ.fn_sql_leitura(p_sql text)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE v_sql text := regexp_replace(trim(COALESCE(p_sql,'')), ';\s*$', ''); r jsonb;
BEGIN
  IF v_sql !~* '^\s*(select|with)\y' THEN RETURN jsonb_build_object('ok', false, 'erro', 'Apenas SELECT/WITH é permitido'); END IF;
  IF v_sql ~* '\m(insert|update|delete|drop|alter|truncate|create|grant|revoke|copy|vacuum|set_config|set\s+role|reset\s+role|session_authorization|dblink\w*|lo_\w+|pg_read\w*|pg_ls\w*|pg_stat_file|pg_sleep|pg_terminate\w*|pg_cancel\w*|pg_reload\w*)\M' THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Comando não permitido em consulta de leitura');
  END IF;
  IF v_sql ~ ';' THEN RETURN jsonb_build_object('ok', false, 'erro', 'Apenas uma instrução por consulta'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'financ_leitura') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'Consulta livre indisponível: o usuário de leitura não existe neste banco');
  END IF;
  PERFORM set_config('transaction_read_only', 'on', true);
  PERFORM set_config('statement_timeout', '8000', true);
  -- a consulta roda como financ_leitura: só SELECT no schema financ, sem as chaves da config e sem nada fora dele
  SET LOCAL ROLE financ_leitura;
  -- a consulta vai como subconsulta: pode ter o próprio ORDER BY/LIMIT, e o teto de 300 linhas vale por fora
  EXECUTE 'SELECT COALESCE(jsonb_agg(t), ''[]''::jsonb) FROM (SELECT * FROM (' || v_sql || E'\n) q LIMIT 300) t' INTO r;
  RESET ROLE;
  RETURN jsonb_build_object('ok', true, 'linhas', jsonb_array_length(r), 'dados', r);
EXCEPTION WHEN others THEN
  RESET ROLE;
  RETURN jsonb_build_object('ok', false, 'erro', SQLERRM);
END $function$;
