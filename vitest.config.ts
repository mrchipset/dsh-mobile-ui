import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['packages/**/*.test.ts', 'apps/bridge/**/*.test.ts', 'apps/mobile/**/*.test.ts'],
    passWithNoTests: true,
    testTimeout: 15_000,
  },
})
