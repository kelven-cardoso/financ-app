import { build } from 'esbuild';

await build({
  entryPoints: ['server/src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: 'dist/server.mjs',
  sourcemap: false,
  legalComments: 'none',
  // migrações SQL do schema financ entram no bundle como texto
  loader: { '.sql': 'text' },
  // alguns pacotes (fastify/pino) ainda usam require() dinâmico em CJS
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: 'info',
});
