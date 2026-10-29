import { describe, expect, it } from 'vitest'
import { settleVoiceAttachment } from './voice-attachment'
import type { VoiceClip } from './voice-recorder'

function clip(id: string): VoiceClip {
  return {
    blob: new Blob([id], { type: 'audio/webm;codecs=opus' }),
    mimeType: 'audio/webm;codecs=opus',
    durationMs: 900,
    source: 'microphone',
  }
}

describe('settleVoiceAttachment', () => {
  const previous = { clip: clip('previous'), text: 'previous transcript' }

  it('keeps the previous pair when transcription fails', () => {
    expect(
      settleVoiceAttachment({
        previous,
        candidate: clip('new'),
        transcript: null,
      }),
    ).toBe(previous)
  })

  it('keeps the previous pair for an empty transcript', () => {
    expect(
      settleVoiceAttachment({
        previous,
        candidate: clip('new'),
        transcript: '   ',
      }),
    ).toBe(previous)
  })

  it('keeps the previous pair when the attempt is cancelled', () => {
    expect(
      settleVoiceAttachment({
        previous,
        candidate: clip('new'),
        transcript: 'should not commit',
        cancelled: true,
      }),
    ).toBe(previous)
  })

  it('commits clip and transcript together on success', () => {
    const nextClip = clip('new')
    const result = settleVoiceAttachment({
      previous,
      candidate: nextClip,
      transcript: ' new transcript ',
    })
    expect(result).toEqual({ clip: nextClip, text: 'new transcript' })
  })

  it('returns null when there is no previous pair and no valid candidate', () => {
    expect(
      settleVoiceAttachment({ previous: null, candidate: null, transcript: 'text' }),
    ).toBeNull()
    expect(
      settleVoiceAttachment({ previous: null, candidate: clip('new'), transcript: '' }),
    ).toBeNull()
  })
})
