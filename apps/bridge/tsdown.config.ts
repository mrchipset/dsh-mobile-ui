import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/main.ts', 'scripts/smoke-acp.ts'],
  outDir: 'dist',
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  dts: false,
  clean: true,
  copy: [{ from: 'src/db/migrations/*.sql', to: 'dist/src/migrations', flatten: true }],
  deps: {
    alwaysBundle: ['@dsh-mobile/protocol'],
    neverBundle: [
      'better-sqlite3',
      'fastify',
      '@fastify/cookie',
      '@fastify/websocket',
      'pino',
      'ws',
      'dotenv',
    ],
  },
})
