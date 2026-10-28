import { describe, expect, it } from 'vitest'
import { decideVoiceStop, isVoiceCancellable, stateAfterVoiceCancel } from './voice-state'

describe('voice state decisions', () => {
  it('discards recordings under 300 ms', () => {
    expect(decideVoiceStop({ state: 'recording', durationMs: 299, cancelled: false })).toEqual({
      kind: 'discard',
      error: '录音太短，已丢弃',
    })
  })

  it('transcribes at the 300 ms boundary', () => {
    expect(decideVoiceStop({ state: 'recording', durationMs: 300, cancelled: false })).toEqual({
      kind: 'transcribe',
    })
  })

  it('cancels during requesting without scheduling a transcription', () => {
    expect(isVoiceCancellable('requesting')).toBe(true)
    expect(stateAfterVoiceCancel('requesting')).toBe('idle')
    expect(decideVoiceStop({ state: 'requesting', durationMs: 800, cancelled: false })).toEqual({
      kind: 'ignore',
    })
  })

  it('never transcribes a cancelled recording', () => {
    expect(decideVoiceStop({ state: 'recording', durationMs: 800, cancelled: true })).toEqual({
      kind: 'ignore',
    })
    expect(stateAfterVoiceCancel('recording')).toBe('idle')
  })

  it('allows cancelling the transcribing phase', () => {
    expect(isVoiceCancellable('transcribing')).toBe(true)
    expect(stateAfterVoiceCancel('transcribing')).toBe('idle')
  })

  it('leaves idle and error states untouched', () => {
    expect(isVoiceCancellable('idle')).toBe(false)
    expect(isVoiceCancellable('error')).toBe(false)
    expect(stateAfterVoiceCancel('error')).toBe('error')
  })
})
