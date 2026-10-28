import { describe, expect, it } from 'vitest'
import { insertTranscript } from './transcript'

describe('insertTranscript', () => {
  it('inserts into an empty draft', () => {
    expect(insertTranscript('', '你好')).toEqual({ value: '你好', caret: 2 })
  })

  it('appends at the end with one separating space', () => {
    expect(insertTranscript('hello', 'world')).toEqual({ value: 'hello world', caret: 11 })
  })

  it('inserts at a mid-text caret without dropping the suffix', () => {
    expect(insertTranscript('hello world', 'TRANSCRIPT', 5, 5)).toEqual({
      value: 'hello TRANSCRIPT world',
      caret: 16,
    })
  })

  it('replaces a selection', () => {
    expect(insertTranscript('hello world', 'there', 6, 11)).toEqual({
      value: 'hello there',
      caret: 11,
    })
  })

  it('does not duplicate whitespace at either boundary', () => {
    expect(insertTranscript('hello ', ' world ')).toEqual({ value: 'hello world', caret: 11 })
    expect(insertTranscript('  ', 'world')).toEqual({ value: '  world', caret: 7 })
  })

  it('keeps the draft unchanged for an empty transcript', () => {
    expect(insertTranscript('keep this', '   ', 2, 4)).toEqual({ value: 'keep this', caret: 2 })
  })

  it('normalizes a reversed selection', () => {
    expect(insertTranscript('abcdef', 'X', 4, 1)).toEqual({ value: 'a X ef', caret: 3 })
  })
})
