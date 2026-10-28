export type VoiceState = 'idle' | 'requesting' | 'recording' | 'transcribing' | 'error'

export const VOICE_MIN_DURATION_MS = 300

export function isVoiceCancellable(state: VoiceState): boolean {
  return state === 'requesting' || state === 'recording' || state === 'transcribing'
}

export function stateAfterVoiceCancel(state: VoiceState): VoiceState {
  return isVoiceCancellable(state) ? 'idle' : state
}

export type VoiceStopDecision =
  | { kind: 'ignore' }
  | { kind: 'discard'; error: string }
  | { kind: 'transcribe' }

export function decideVoiceStop(input: {
  state: VoiceState
  durationMs: number
  cancelled: boolean
  minDurationMs?: number
}): VoiceStopDecision {
  if (input.state !== 'recording' || input.cancelled) return { kind: 'ignore' }
  const minimum = input.minDurationMs ?? VOICE_MIN_DURATION_MS
  if (input.durationMs < minimum) {
    return { kind: 'discard', error: '录音太短，已丢弃' }
  }
  return { kind: 'transcribe' }
}
