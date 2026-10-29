import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { FfmpegTranscoder } from '../src/audio/transcoder.js'
import type { Logger } from '../src/logger.js'

const ffmpegPath = process.env.FFMPEG_PATH ?? 'ffmpeg'
const ffmpegAvailable = spawnSync(ffmpegPath, ['-version'], { stdio: 'ignore' }).status === 0

function makeWav(sampleRate = 8000, seconds = 0.1): Buffer {
  const samples = Math.max(1, Math.floor(sampleRate * seconds))
  const dataSize = samples * 2
  const wav = Buffer.alloc(44 + dataSize)
  wav.write('RIFF', 0)
  wav.writeUInt32LE(36 + dataSize, 4)
  wav.write('WAVE', 8)
  wav.write('fmt ', 12)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(sampleRate, 24)
  wav.writeUInt32LE(sampleRate * 2, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36)
  wav.writeUInt32LE(dataSize, 40)
  return wav
}

describe('FfmpegTranscoder', () => {
  it('falls back to the original bytes when ffmpeg is unavailable', async () => {
    const logs: string[] = []
    const logger = {
      info: (...args: unknown[]) => logs.push(JSON.stringify(args[0])),
      warn: (...args: unknown[]) => logs.push(JSON.stringify(args[0])),
      debug: () => {},
      error: () => {},
    } as unknown as Logger

    const data = Buffer.from('AUDIO-MARKER')
    const transcoder = new FfmpegTranscoder({
      ffmpegPath: 'dsh-bridge-ffmpeg-missing',
      timeoutMs: 2000,
      logger,
    })

    const result = await transcoder.transcode({ data, mimeType: 'audio/webm' })

    expect(result.transcoded).toBe(false)
    expect(result.mimeType).toBe('audio/webm')
    expect(result.data.equals(data)).toBe(true)

    const joined = logs.join('\n')
    expect(joined).not.toContain('AUDIO-MARKER')
    expect(joined).not.toContain('dsh-bridge-ffmpeg-missing')
  })

  it.skipIf(!ffmpegAvailable)('transcodes a tiny WAV to M4A with real ffmpeg', async () => {
    const transcoder = new FfmpegTranscoder({ ffmpegPath, timeoutMs: 10_000 })

    expect(await transcoder.isAvailable()).toBe(true)
    const result = await transcoder.transcode({
      data: makeWav(),
      mimeType: 'audio/wav',
    })

    expect(result.transcoded).toBe(true)
    expect(result.mimeType).toBe('audio/mp4')
    expect(result.data.byteLength).toBeGreaterThan(0)
  })

  it.skipIf(!ffmpegAvailable)('falls back for corrupt input with real ffmpeg', async () => {
    const data = Buffer.from('this is not audio')
    const transcoder = new FfmpegTranscoder({ ffmpegPath, timeoutMs: 10_000 })

    const result = await transcoder.transcode({ data, mimeType: 'audio/webm' })

    expect(result.transcoded).toBe(false)
    expect(result.mimeType).toBe('audio/webm')
    expect(result.data.equals(data)).toBe(true)
  })
})
