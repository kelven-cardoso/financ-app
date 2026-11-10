-- Financ · Migração 18: notificações capturadas pelo app Android
-- O app envia o aviso do banco para o servidor do Financ, que guarda o texto original (para conferência e ajuste
-- da leitura) e repassa ao fluxo "Notificação → lançamento" do n8n. A mesma notificação (evento_id) entra uma vez só.
CREATE TABLE IF NOT EXISTS financ.notif_capturas (
  id             bigserial PRIMARY KEY,
  evento_id      text NOT NULL UNIQUE,
  recebido_em    timestamptz NOT NULL DEFAULT now(),
  quando         timestamptz,
  app            text,
  pacote         text,
  titulo         text,
  texto          text,
  encaminhado    boolean NOT NULL DEFAULT false,
  tentativas     int NOT NULL DEFAULT 0,
  encaminhado_em timestamptz
);
CREATE INDEX IF NOT EXISTS ix_notif_capturas_pendentes ON financ.notif_capturas (id) WHERE NOT encaminhado;
