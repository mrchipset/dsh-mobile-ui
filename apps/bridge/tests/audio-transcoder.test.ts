import { describe, expect, it } from 'vitest'
import { FfmpegTranscoder } from '../src/audio/transcoder.js'
import type { Logger } from '../src/logger.js'

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
})
