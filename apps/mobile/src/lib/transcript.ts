export interface TranscriptInsertion {
  value: string
  caret: number
}

/**
 * Inserts a transcript at the caret (or selection) without losing the existing draft.
 * A single space is added only when it would separate two non-space runs.
 */
export function insertTranscript(
  draft: string,
  transcript: string,
  selectionStart?: number,
  selectionEnd?: number,
): TranscriptInsertion {
  const cleaned = transcript.trim()
  const rawStart = selectionStart ?? draft.length
  const rawEnd = selectionEnd ?? rawStart
  const start = Math.max(0, Math.min(draft.length, Math.min(rawStart, rawEnd)))
  const end = Math.max(0, Math.min(draft.length, Math.max(rawStart, rawEnd)))

  if (cleaned.length === 0) return { value: draft, caret: start }

  const before = draft.slice(0, start)
  const after = draft.slice(end)
  const leadingSpace = before.length > 0 && !/\s$/.test(before) ? ' ' : ''
  const trailingSpace = after.length > 0 && !/^\s/.test(after) ? ' ' : ''
  const value = `${before}${leadingSpace}${cleaned}${trailingSpace}${after}`

  return { value, caret: before.length + leadingSpace.length + cleaned.length }
}
