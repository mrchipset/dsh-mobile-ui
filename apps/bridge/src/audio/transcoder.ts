import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { errorSummary, type Logger } from '../logger.js'

export interface AudioTranscodeInput {
  data: Buffer
  mimeType: string
}

export interface AudioTranscodeResult {
  data: Buffer
  mimeType: string
  transcoded: boolean
}

/** Normalizes an accepted browser recording to an M4A/AAC playback copy. */
export interface AudioTranscoder {
  transcode(input: AudioTranscodeInput): Promise<AudioTranscodeResult>
}

export interface FfmpegTranscoderOptions {
  ffmpegPath: string
  timeoutMs?: number
  logger?: Logger
}

const DEFAULT_TIMEOUT_MS = 30_000
const PLAYBACK_MIME_TYPE = 'audio/mp4'

function extensionForMime(mimeType: string): string {
  switch (mimeType) {
    case 'audio/webm':
      return 'webm'
    case 'audio/mp4':
      return 'mp4'
    case 'audio/wav':
      return 'wav'
    case 'audio/ogg':
      return 'ogg'
    case 'audio/x-m4a':
      return 'm4a'
    case 'audio/aac':
      return 'aac'
    default:
      return 'bin'
  }
}

/**
 * Transcodes with the host ffmpeg binary and falls back to the original bytes
 * when ffmpeg is unavailable, times out, or produces no output.
 */
export class FfmpegTranscoder implements AudioTranscoder {
  private readonly timeoutMs: number

  constructor(private readonly options: FfmpegTranscoderOptions) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  async transcode(input: AudioTranscodeInput): Promise<AudioTranscodeResult> {
    const fallback: AudioTranscodeResult = {
      data: input.data,
      mimeType: input.mimeType,
      transcoded: false,
    }

    let directory: string | undefined
    try {
      directory = await mkdtemp(join(tmpdir(), 'dsh-bridge-audio-'))
      const inputPath = join(directory, `input.${extensionForMime(input.mimeType)}`)
      const outputPath = join(directory, 'playback.m4a')
      await writeFile(inputPath, input.data)

      const exitCode = await this.runFfmpeg(inputPath, outputPath)
      if (exitCode !== 0) {
        this.options.logger?.warn({ errorCode: 'ffmpeg_failed' }, 'audio transcode failed')
        return fallback
      }

      const playback = await readFile(outputPath)
      if (playback.byteLength === 0) {
        this.options.logger?.warn({ errorCode: 'ffmpeg_empty_output' }, 'audio transcode failed')
        return fallback
      }

      return { data: playback, mimeType: PLAYBACK_MIME_TYPE, transcoded: true }
    } catch (error) {
      this.options.logger?.warn(
        { error: errorSummary(error) },
        'audio transcode unavailable; using original bytes',
      )
      return fallback
    } finally {
      if (directory !== undefined) {
        await rm(directory, { recursive: true, force: true }).catch(() => {})
      }
    }
  }

  private runFfmpeg(inputPath: string, outputPath: string): Promise<number> {
    return new Promise((resolve) => {
      let settled = false
      let timer: NodeJS.Timeout | undefined
      const finish = (code: number): void => {
        if (settled) return
        settled = true
        if (timer !== undefined) clearTimeout(timer)
        resolve(code)
      }

      const child = spawn(
        this.options.ffmpegPath,
        [
          '-y',
          '-i',
          inputPath,
          '-vn',
          '-c:a',
          'aac',
          '-b:a',
          '64k',
          '-movflags',
          '+faststart',
          outputPath,
        ],
        { stdio: ['ignore', 'ignore', 'ignore'] },
      )

      timer = setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          // Already exited.
        }
        finish(1)
      }, this.timeoutMs)
      timer.unref?.()

      child.once('error', () => finish(1))
      child.once('close', (code) => finish(code ?? 1))
    })
  }
}
