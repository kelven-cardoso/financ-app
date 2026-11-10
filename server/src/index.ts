import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { cfg } from './config.js';
import { sql } from './db.js';
import { ErroApi } from './http.js';
import { limpar, migrar } from './migrate.js';
import { rotasAuth } from './routes/auth.js';
import { rotasConciliacao } from './routes/conciliacao.js';
import { rotasDados } from './routes/dados.js';
import { rotasSeguranca } from './routes/seguranca.js';

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
    // sem query string nos logs (o link de configuração leva o token na URL)
    serializers: {
      req: (req: { method: string; url: string; ip?: string }) => ({ method: req.method, url: req.url.split('?')[0], ip: req.ip }),
    },
  },
  // só o proxy do Easypanel (Traefik) fica na frente: confiar em 1 salto evita IP forjado no X-Forwarded-For
  trustProxy: (_endereco: string, salto: number) => salto < Number(process.env.TRUST_PROXY_HOPS ?? 1),
  bodyLimit: 256 * 1024,
});

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join('; ');

await app.register(cookie);
await app.register(rateLimit, {
  global: true,
  max: 400,
  timeWindow: '1 minute',
  errorResponseBuilder: () => ({ ok: false, statusCode: 429, erro: 'Muitas requisições. Espere um pouco e tente de novo.', codigo: 'limite' }),
});

app.addHook('onRequest', async (req, reply) => {
  const host = String(req.headers.host ?? '').toLowerCase();
  if (cfg.hostsRedirecionar.includes(host)) {
    return reply.redirect(cfg.origem + req.url, 301);
  }
  // proteção contra CSRF: alterações só com o cabeçalho do app e vindas da própria origem
  if (req.url.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    if (req.headers['x-financ'] !== '1') throw new ErroApi(403, 'Requisição recusada', 'csrf');
    const origin = req.headers.origin;
    if (origin && origin !== cfg.origem) throw new ErroApi(403, 'Origem não permitida', 'origem');
    const site = req.headers['sec-fetch-site'];
    if (site && site !== 'same-origin' && site !== 'none') throw new ErroApi(403, 'Origem não permitida', 'origem');
  }
});

app.addHook('onSend', async (req, reply, payload) => {
  reply.header('Content-Security-Policy', CSP);
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('Referrer-Policy', 'no-referrer');
  reply.header('X-Frame-Options', 'DENY');
  reply.header('Cross-Origin-Opener-Policy', 'same-origin');
  reply.header('Cross-Origin-Resource-Policy', 'same-origin');
  reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), publickey-credentials-get=(self), publickey-credentials-create=(self)');
  if (cfg.https) reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  if (req.url.startsWith('/api/') && !reply.hasHeader('Cache-Control')) reply.header('Cache-Control', 'no-store');
  return payload;
});

app.setErrorHandler((err: Error & { statusCode?: number; validation?: unknown }, req, reply) => {
  if (err instanceof ErroApi) {
    return reply.code(err.status).send({ ok: false, erro: err.message, codigo: err.codigo });
  }
  if (err.statusCode === 429) return reply.code(429).send({ ok: false, erro: 'Muitas requisições. Espere um pouco e tente de novo.', codigo: 'limite' });
  if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
    return reply.code(err.statusCode).send({ ok: false, erro: 'Requisição inválida', codigo: 'invalido' });
  }
  req.log.error(err);
  // violação de regra do banco (check/unique): mensagem genérica, detalhe só no log
  const pg = err as { code?: string };
  if (pg.code === '23505') return reply.code(409).send({ ok: false, erro: 'Já existe um registro com esse nome.', codigo: 'duplicado' });
  if (pg.code?.startsWith('23')) return reply.code(422).send({ ok: false, erro: 'Os dados não passaram nas regras do banco. Confira os campos.', codigo: 'regra' });
  return reply.code(500).send({ ok: false, erro: 'Erro inesperado no servidor. Tente de novo.', codigo: 'erro' });
});

app.get('/healthz', async () => {
  await sql`SELECT 1`;
  return { ok: true, versao: cfg.versao };
});

await app.register(rotasAuth);
await app.register(rotasSeguranca);
await app.register(rotasDados);
await app.register(rotasConciliacao);

await app.register(fastifyStatic, {
  root: cfg.pastaEstatica,
  prefix: '/',
  index: ['index.html'],
  setHeaders(res, caminho) {
    if (/[\\/]assets[\\/]/.test(caminho)) res.header('Cache-Control', 'public, max-age=31536000, immutable');
    else if (/(index\.html|sw\.js|registerSW\.js|manifest\.webmanifest|workbox-[^/\\]+\.js)$/.test(caminho)) res.header('Cache-Control', 'no-cache');
    else res.header('Cache-Control', 'public, max-age=86400');
  },
});

app.setNotFoundHandler((req, reply) => {
  if (req.url.startsWith('/api/') || req.method !== 'GET') {
    return reply.code(404).send({ ok: false, erro: 'Não encontrado', codigo: 'nao_encontrado' });
  }
  // rotas do app (SPA)
  reply.header('Cache-Control', 'no-cache');
  return reply.sendFile('index.html');
});

await migrar();
await limpar().catch((e) => app.log.error(e, 'limpeza'));
setInterval(() => limpar().catch((e) => app.log.error(e, 'limpeza')), 6 * 3600 * 1000).unref();

const encerrar = async () => {
  await app.close();
  await sql.end({ timeout: 5 });
  process.exit(0);
};
process.on('SIGTERM', encerrar);
process.on('SIGINT', encerrar);

await app.listen({ port: cfg.porta, host: cfg.host });
app.log.info(`Financ app em ${cfg.origem} (porta ${cfg.porta})`);
