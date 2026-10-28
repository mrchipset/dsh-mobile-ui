/**
 * Bridge STT smoke test: upload one local audio file to POST /api/transcribe
 * and print the transcription result.
 *
 *   BRIDGE_SECRET=... pnpm exec tsx scripts/smoke-stt.ts --file sample.wav
 *
 * No audio fixture is committed. Record a short WAV or webm/m4a clip locally.
 * The script never prints the audio bytes or the bearer token.
 */
import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'

const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:8787'
const MAX_ERROR_PREVIEW = 500

const AUDIO_CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.wav': 'audio/wav',
  '.webm': 'audio/webm',
  '.mp4': 'audio/mp4',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.aac': 'audio/aac',
}

const HELP = `Usage: pnpm exec tsx scripts/smoke-stt.ts --file <path> [options]

Uploads one audio file to the Bridge transcription endpoint.

Required:
  --file <path>          Audio file. Supported extensions: ${Object.keys(AUDIO_CONTENT_TYPES).join(', ')}
  BRIDGE_SECRET          Bridge bearer token (environment variable)

Options:
  --duration-ms <n>      Client-measured clip duration; sent as X-Audio-Duration-Ms
  --language <code>      Language hint; sent as X-Audio-Language (e.g. zh, en)
  --help, -h             Show this help

Environment:
  BRIDGE_URL             Bridge base URL (default: ${DEFAULT_BRIDGE_URL})

Examples:
  BRIDGE_SECRET=secret pnpm exec tsx scripts/smoke-stt.ts --file sample.wav
  BRIDGE_SECRET=secret pnpm exec tsx scripts/smoke-stt.ts --file clip.webm --duration-ms 4200 --language zh

The audio file is not committed. Any mono WAV or a browser recording works;
keep it short (the Bridge caps uploads at 8 MB / 60 s).`

interface CliOptions {
  help: boolean
  file: string
  durationMs?: number
  language?: string
}

type ParseResult = { ok: true; options: CliOptions } | { ok: false; error: string }

function readOptionValue(argv: readonly string[], index: number): string | undefined {
  const value = argv[index + 1]
  if (value === undefined || value.startsWith('--')) {
    return undefined
  }
  return value
}

function parseDuration(raw: string): number | undefined {
  if (raw.trim().length === 0) {
    return undefined
  }
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 0) {
    return undefined
  }
  return value
}

function parseArgs(argv: readonly string[]): ParseResult {
  let file: string | undefined
  let durationMs: number | undefined
  let language: string | undefined
  let help = false

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === undefined) {
      continue
    }

    if (arg === '--help' || arg === '-h') {
      help = true
      continue
    }

    if (arg === '--file' || arg === '--duration-ms' || arg === '--language') {
      const value = readOptionValue(argv, index)
      if (value === undefined) {
        return { ok: false, error: `${arg} requires a value` }
      }
      index += 1
      if (arg === '--file') {
        file = value
      } else if (arg === '--duration-ms') {
        const parsed = parseDuration(value)
        if (parsed === undefined) {
          return { ok: false, error: '--duration-ms must be a non-negative integer' }
        }
        durationMs = parsed
      } else {
        language = value
      }
      continue
    }

    if (arg.startsWith('--file=')) {
      file = arg.slice('--file='.length)
      continue
    }
    if (arg.startsWith('--duration-ms=')) {
      const parsed = parseDuration(arg.slice('--duration-ms='.length))
      if (parsed === undefined) {
        return { ok: false, error: '--duration-ms must be a non-negative integer' }
      }
      durationMs = parsed
      continue
    }
    if (arg.startsWith('--language=')) {
      language = arg.slice('--language='.length)
      continue
    }

    return { ok: false, error: `unknown argument: ${arg}` }
  }

  if (help) {
    return { ok: true, options: { help: true, file: file ?? '' } }
  }
  if (file === undefined || file.length === 0) {
    return { ok: false, error: '--file <path> is required' }
  }
  if (language !== undefined && language.trim().length === 0) {
    return { ok: false, error: '--language must not be empty' }
  }

  return {
    ok: true,
    options: {
      help: false,
      file,
      ...(durationMs === undefined ? {} : { durationMs }),
      ...(language === undefined ? {} : { language: language.trim() }),
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' ? value : undefined
}

function readNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function parseJson(text: string): unknown {
  if (text.trim().length === 0) {
    return undefined
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

function errorPreview(text: string): string {
  const trimmed = text.trim()
  if (trimmed.length <= MAX_ERROR_PREVIEW) {
    return trimmed
  }
  return `${trimmed.slice(0, MAX_ERROR_PREVIEW)}…`
}

function resolveBridgeUrl(raw: string): string {
  const parsed = new URL(raw)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('BRIDGE_URL must use http or https')
  }
  return parsed.toString().replace(/\/$/, '')
}

async function main(argv: readonly string[]): Promise<number> {
  const parsed = parseArgs(argv)
  if (!parsed.ok) {
    console.error(`error: ${parsed.error}`)
    console.error('run with --help for usage')
    return 2
  }
  if (parsed.options.help) {
    console.log(HELP)
    return 0
  }

  const secret = process.env.BRIDGE_SECRET?.trim()
  if (secret === undefined || secret.length === 0) {
    console.error('error: BRIDGE_SECRET is required')
    return 2
  }

  let bridgeUrl: string
  try {
    bridgeUrl = resolveBridgeUrl(process.env.BRIDGE_URL?.trim() || DEFAULT_BRIDGE_URL)
  } catch (error) {
    console.error(
      `error: invalid BRIDGE_URL: ${error instanceof Error ? error.message : 'invalid'}`,
    )
    return 2
  }

  const extension = extname(parsed.options.file).toLowerCase()
  const contentType = AUDIO_CONTENT_TYPES[extension]
  if (contentType === undefined) {
    console.error(`error: unsupported audio extension "${extension || '(none)'}"`)
    console.error(`supported: ${Object.keys(AUDIO_CONTENT_TYPES).join(', ')}`)
    return 2
  }

  let audio: Buffer
  try {
    audio = await readFile(parsed.options.file)
  } catch (error) {
    console.error(
      `error: cannot read audio file: ${error instanceof Error ? error.message : 'unknown'}`,
    )
    return 1
  }
  if (audio.byteLength === 0) {
    console.error('error: audio file is empty')
    return 1
  }

  const headers: Record<string, string> = {
    authorization: `Bearer ${secret}`,
    'content-type': contentType,
  }
  if (parsed.options.durationMs !== undefined) {
    headers['x-audio-duration-ms'] = String(parsed.options.durationMs)
  }
  if (parsed.options.language !== undefined) {
    headers['x-audio-language'] = parsed.options.language
  }

  console.log(
    `uploading ${basename(parsed.options.file)} (${audio.byteLength} bytes, ${contentType})`,
  )

  const startedAt = Date.now()
  let response: Response
  try {
    response = await fetch(`${bridgeUrl}/api/transcribe`, {
      method: 'POST',
      headers,
      body: new Uint8Array(audio),
    })
  } catch (error) {
    console.error(
      `error: request failed: ${error instanceof Error ? error.message : String(error)}`,
    )
    return 1
  }
  const roundTripMs = Date.now() - startedAt

  let responseText: string
  try {
    responseText = await response.text()
  } catch (error) {
    console.error(
      `error: cannot read response: ${error instanceof Error ? error.message : String(error)}`,
    )
    return 1
  }
  const payload = parseJson(responseText)

  if (!response.ok) {
    const errorCode = isRecord(payload) ? readString(payload, 'error') : undefined
    const suffix = errorCode === undefined ? '' : ` (${errorCode})`
    console.error(`error: HTTP ${response.status}${suffix}`)
    const preview = errorPreview(responseText)
    if (preview.length > 0) {
      console.error(`response: ${preview}`)
    }
    return 1
  }

  if (!isRecord(payload)) {
    console.error(`error: expected a JSON body, got: ${errorPreview(responseText)}`)
    return 1
  }

  const transcript = readString(payload, 'text')
  if (transcript === undefined) {
    console.error('error: response is missing "text"')
    return 1
  }
  if (transcript.trim().length === 0) {
    console.error('error: transcript is empty (silent clip or upstream failure)')
    return 1
  }

  const language = readString(payload, 'language') ?? parsed.options.language ?? 'unknown'
  const provider = readString(payload, 'provider') ?? 'unknown'
  const model = readString(payload, 'model') ?? 'unknown'
  const latencyMs = readNumber(payload, 'latencyMs')
  const durationMs = readNumber(payload, 'durationMs')

  console.log(`transcript: ${transcript}`)
  console.log(`language:   ${language}`)
  console.log(`provider:   ${provider}`)
  console.log(`model:      ${model}`)
  console.log(
    `latency:    ${latencyMs === undefined ? 'unknown' : `${Math.round(latencyMs)} ms (stt)`} / ${roundTripMs} ms (round trip)`,
  )
  if (durationMs !== undefined) {
    console.log(`audio:      ${Math.round(durationMs)} ms`)
  }

  return 0
}

const exitCode = await main(process.argv.slice(2))
process.exitCode = exitCode
