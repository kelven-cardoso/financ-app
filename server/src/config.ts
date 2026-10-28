import path from 'node:path';
import { fileURLToPath } from 'node:url';

function obrigatoria(nome: string): string {
  const v = process.env[nome];
  if (!v) throw new Error(`Variável de ambiente ${nome} não definida`);
  return v;
}

const origem = obrigatoria('APP_ORIGIN').replace(/\/+$/, '');
const aqui = path.dirname(fileURLToPath(import.meta.url));
const https = origem.startsWith('https://');

export const cfg = {
  porta: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
  databaseUrl: obrigatoria('DATABASE_URL'),
  origem,
  hostCanonico: new URL(origem).host,
  rpId: process.env.RP_ID ?? new URL(origem).hostname,
  rpNome: 'Financ',
  setupToken: process.env.SETUP_TOKEN ?? '',
  https,
  cookie: https ? '__Host-financ' : 'financ_dev',
  // hosts alternativos (ex.: domínio padrão do Easypanel) redirecionam para a origem
  hostsRedirecionar: (process.env.REDIRECT_HOSTS ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean),
  pastaEstatica: process.env.STATIC_DIR ?? path.join(aqui, 'public'),
  sessaoDias: 30,
  bloqueioPadraoMin: 5,
  versao: process.env.APP_VERSION ?? 'dev',
};
