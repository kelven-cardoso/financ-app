import postgres from 'postgres';
import { cfg } from './config.js';

export const sql = postgres(cfg.databaseUrl, {
  max: 6,
  idle_timeout: 30,
  connect_timeout: 10,
  connection: { application_name: 'financ-app' },
  types: {
    // numeric -> number (valores de dinheiro cabem com folga em double)
    numeric: {
      to: 1700,
      from: [1700],
      serialize: (x: unknown) => String(x),
      parse: (x: string) => Number(x),
    },
  },
});

export type Sql = typeof sql;
export type Tx = postgres.TransactionSql<Record<string, unknown>>;
