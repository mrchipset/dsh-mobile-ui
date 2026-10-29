import type { VoiceClip } from './voice-recorder'

export interface VoiceAttachmentPair {
  clip: VoiceClip
  text: string
}

/**
 * Commits a clip and transcript together. A failed, empty, or cancelled attempt keeps the
 * previously committed pair so the UI never shows "new audio + old transcript".
 */
export function settleVoiceAttachment(input: {
  previous: VoiceAttachmentPair | null
  candidate: VoiceClip | null
  transcript: string | null
  cancelled?: boolean
}): VoiceAttachmentPair | null {
  if (input.cancelled === true) return input.previous
  if (input.candidate === null) return input.previous
  const text = input.transcript?.trim() ?? ''
  if (text.length === 0) return input.previous
  return { clip: input.candidate, text }
}
