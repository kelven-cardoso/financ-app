import { randomBytes } from 'node:crypto';
import financ13 from './sql/financ_13_conciliacao.sql';
import financ14 from './sql/financ_14_conciliacao_alvo.sql';
import { sql } from './db.js';

/**
 * Schema próprio do app (login, digitais, sessões, auditoria e idempotência).
 * As regras de finanças continuam no schema financ, migrado pelo fluxo de setup do n8n.
 */
const MIGRACOES: { versao: number; sql: string }[] = [
  {
    versao: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS financ_app.usuario (
        id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        senha_hash text,
        senha_alterada_em timestamptz,
        setup_token_hash text,
        falhas int NOT NULL DEFAULT 0,
        bloqueado_ate timestamptz,
        webauthn_user_id text NOT NULL,
        criado_em timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS financ_app.passkeys (
        id text PRIMARY KEY,
        chave_publica bytea NOT NULL,
        contador bigint NOT NULL DEFAULT 0,
        transports text[] NOT NULL DEFAULT '{}',
        tipo_dispositivo text,
        sincronizada boolean,
        nome text NOT NULL DEFAULT 'Aparelho',
        criado_em timestamptz NOT NULL DEFAULT now(),
        ultimo_uso timestamptz
      );
      CREATE TABLE IF NOT EXISTS financ_app.sessoes (
        id text PRIMARY KEY,
        criado_em timestamptz NOT NULL DEFAULT now(),
        ultimo_uso timestamptz NOT NULL DEFAULT now(),
        expira_em timestamptz NOT NULL,
        metodo text NOT NULL,
        passkey_id text REFERENCES financ_app.passkeys(id) ON DELETE SET NULL,
        bloqueio_min int CHECK (bloqueio_min IS NULL OR bloqueio_min BETWEEN 1 AND 1440),
        desbloqueado_ate timestamptz,
        user_agent text,
        ip text,
        revogada_em timestamptz
      );
      CREATE INDEX IF NOT EXISTS ix_sessoes_ativas ON financ_app.sessoes (expira_em) WHERE revogada_em IS NULL;
      CREATE TABLE IF NOT EXISTS financ_app.eventos (
        id bigserial PRIMARY KEY,
        criado_em timestamptz NOT NULL DEFAULT now(),
        tipo text NOT NULL,
        ok boolean NOT NULL DEFAULT true,
        ip text,
        user_agent text,
        detalhe jsonb
      );
      CREATE INDEX IF NOT EXISTS ix_eventos_data ON financ_app.eventos (criado_em DESC);
      CREATE TABLE IF NOT EXISTS financ_app.idempotencia (
        chave text PRIMARY KEY,
        criado_em timestamptz NOT NULL DEFAULT now(),
        resultado jsonb
      );
    `,
  },
  {
    // passkeys não descobríveis (alguns gerenciadores do Android) precisam ir na lista ao entrar
    versao: 2,
    sql: `ALTER TABLE financ_app.passkeys ADD COLUMN IF NOT EXISTS descobrivel boolean;`,
  },
];

/** versões 1000+ = schema financ; para atualizar as funções, crie um arquivo novo e uma versão nova */
const MIGRACOES_FINANC: { versao: number; sql: string }[] = [
  { versao: 1013, sql: financ13 },
  { versao: 1014, sql: financ14 },
];

export async function migrar(): Promise<void> {
  // em produção o schema já existe e pertence ao papel do app (sem privilégio de criar schemas)
  const [existe] = await sql`SELECT 1 FROM pg_namespace WHERE nspname = 'financ_app'`;
  if (!existe) await sql`CREATE SCHEMA financ_app`;
  await sql`CREATE TABLE IF NOT EXISTS financ_app.migracoes (versao int PRIMARY KEY, aplicada_em timestamptz NOT NULL DEFAULT now())`;
  const feitas = new Set((await sql<{ versao: number }[]>`SELECT versao FROM financ_app.migracoes`).map((r) => r.versao));
  for (const m of MIGRACOES) {
    if (feitas.has(m.versao)) continue;
    await sql.begin(async (tx) => {
      await tx.unsafe(m.sql);
      await tx`INSERT INTO financ_app.migracoes (versao) VALUES (${m.versao})`;
    });
  }
  await sql`
    INSERT INTO financ_app.usuario (id, webauthn_user_id)
    VALUES (1, ${randomBytes(16).toString('base64url')})
    ON CONFLICT (id) DO NOTHING`;
  // migrações do schema financ que vêm com o app (as anteriores ficam no fluxo de setup do n8n)
  for (const m of MIGRACOES_FINANC) {
    if (feitas.has(m.versao)) continue;
    await sql.begin(async (tx) => {
      await tx.unsafe(m.sql);
      await tx`INSERT INTO financ_app.migracoes (versao) VALUES (${m.versao})`;
    });
  }
  await verificarSchemaFinanc();
  // chave que o n8n usa para mandar o PDF da fatura (fica só no banco; os dois lados leem de lá)
  await sql`
    INSERT INTO financ.config (chave, valor) VALUES ('app_token_interno', ${randomBytes(32).toString('hex')})
    ON CONFLICT (chave) DO NOTHING`;
}

/** O app depende das Migrações 12 (aparência, benefício) e 13 (conciliação da fatura) do schema financ. */
async function verificarSchemaFinanc(): Promise<void> {
  const [r] = await sql<{ ok: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'financ' AND table_name = 'cartoes' AND column_name = 'cor'
    ) AND EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'financ' AND p.proname = 'fn_conta_beneficio'
    ) AND to_regclass('financ.fatura_itens') IS NOT NULL AS ok`;
  if (!r?.ok) {
    throw new Error('O schema financ ainda não tem as Migrações 12 e 13 (rode o fluxo de setup do Financ no n8n).');
  }
}

/** Limpeza periódica de dados de controle. */
export async function limpar(): Promise<void> {
  await sql`DELETE FROM financ_app.idempotencia WHERE criado_em < now() - interval '30 days'`;
  await sql`DELETE FROM financ_app.eventos WHERE criado_em < now() - interval '180 days'`;
  await sql`DELETE FROM financ_app.sessoes WHERE (revogada_em IS NOT NULL OR expira_em < now()) AND ultimo_uso < now() - interval '30 days'`;
}
