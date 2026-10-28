import { config as loadDotenv } from 'dotenv'

/**
 * Load the repository `.env` whether the process starts at the workspace root
 * or inside `apps/bridge` via `pnpm --filter`.
 */
export function loadEnvironment(): void {
  loadDotenv({ path: ['.env', '../../.env'], quiet: true })
}
