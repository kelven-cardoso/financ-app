-- Financ · Migração 19: o app Android de captura de notificações foi descontinuado.
-- Remove a tabela que guardava os avisos capturados e as chaves de configuração usadas só por ele.
DROP TABLE IF EXISTS financ.notif_capturas;
DELETE FROM financ.config WHERE chave IN ('notif_token', 'notif_webhook_url');
