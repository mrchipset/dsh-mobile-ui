import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const certPath = join(repoRoot, '.certs', 'dev-cert.pem')
const keyPath = join(repoRoot, '.certs', 'dev-key.pem')
const missing = [
  ...(existsSync(certPath) ? [] : ['.certs/dev-cert.pem']),
  ...(existsSync(keyPath) ? [] : ['.certs/dev-key.pem']),
]

if (missing.length > 0) {
  console.error('HTTPS dev certificates are missing:')
  for (const file of missing) console.error(`  - ${file}`)
  console.error('')
  console.error('Generate them from the repository root (replace 192.168.71.5 if your LAN IP changes):')
  console.error('')
  console.error('  bash:')
  console.error('    mkdir -p .certs')
  console.error('    mkcert -install')
  console.error(
    '    mkcert -cert-file .certs/dev-cert.pem -key-file .certs/dev-key.pem 192.168.71.5 localhost 127.0.0.1',
  )
  console.error('')
  console.error('  PowerShell:')
  console.error('    New-Item -ItemType Directory -Force .certs')
  console.error('    mkcert -install')
  console.error(
    '    mkcert -cert-file .certs/dev-cert.pem -key-file .certs/dev-key.pem 192.168.71.5 localhost 127.0.0.1',
  )
  console.error('')
  console.error('Stop the existing HTTP 5174 instance before starting HTTPS on 5174.')
  process.exit(1)
}

console.log('Found .certs/dev-cert.pem and .certs/dev-key.pem')
