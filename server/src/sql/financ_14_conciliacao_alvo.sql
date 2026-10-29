-- Financ v2 · Migração 14 · sem cartão e sem mês, a conferência usa a última fatura lida
-- ("lança tudo da fatura" logo depois da mensagem do WhatsApp vale para a fatura que acabou de chegar)
CREATE OR REPLACE FUNCTION financ.fn_fatura_importacao_alvo(p jsonb) RETURNS int LANGUAGE plpgsql STABLE AS $$
DECLARE v_id int; v_cartao int; v_mes date;
BEGIN
  IF financ.fn_num(p, 'importacao_id') IS NOT NULL THEN
    SELECT id INTO v_id FROM financ.fatura_importacoes WHERE id = financ.fn_num(p, 'importacao_id')::int;
    RETURN v_id;
  END IF;
  v_cartao := financ.fn_resolver_cartao(financ.fn_txt(p, 'cartao'));
  v_mes := financ.fn_parse_mes(financ.fn_txt(p, 'mes'));
  IF v_cartao IS NULL AND v_mes IS NULL THEN
    SELECT id INTO v_id FROM financ.fatura_importacoes ORDER BY atualizado_em DESC, id DESC LIMIT 1;
    RETURN v_id;
  END IF;
  v_cartao := COALESCE(v_cartao, financ.fn_cartao_padrao());
  IF v_mes IS NULL THEN
    SELECT id INTO v_id FROM financ.fatura_importacoes WHERE cartao_id = v_cartao ORDER BY competencia DESC LIMIT 1;
  ELSE
    SELECT id INTO v_id FROM financ.fatura_importacoes WHERE cartao_id = v_cartao AND competencia = v_mes;
  END IF;
  RETURN v_id;
END $$;
