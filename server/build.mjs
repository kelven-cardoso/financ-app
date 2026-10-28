import { build } from 'esbuild';

await build({
  entryPoints: ['server/src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile: 'dist/server.mjs',
  sourcemap: 'linked',
  legalComments: 'none',
  // alguns pacotes (fastify/pino) ainda usam require() dinâmico em CJS
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: 'info',
});
