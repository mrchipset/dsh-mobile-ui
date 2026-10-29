import { describe, expect, it } from 'vitest'
import type { MessageBlock, PlanBlock, ToolCallBlock, UnknownBlock } from './blocks'
import type { StoredUpdate } from './entities'
import { fold } from './fold'

function update(seq: number, kind: string, payload: unknown): StoredUpdate {
  return { seq, kind, payload }
}

describe('fold', () => {
  it('merges streamed agent chunks that share a messageId', () => {
    const blocks = fold([
      update(1, 'agent_message_chunk', {
        sessionUpdate: 'agent_message_chunk',
        messageId: 'm1',
        content: { type: 'text', text: 'Hello' },
      }),
      update(2, 'agent_message_chunk', {
        sessionUpdate: 'agent_message_chunk',
        messageId: 'm1',
        content: { type: 'text', text: ', world' },
      }),
    ])

    expect(blocks).toHaveLength(1)
    const message = blocks[0] as MessageBlock
    expect(message.kind).toBe('message')
    expect(message.role).toBe('assistant')
    expect(message.text).toBe('Hello, world')
    expect(message.seq).toBe(2)
  })

  it('merges anonymous chunks into the current message', () => {
    const blocks = fold([
      update(1, 'agent_message_chunk', {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'a' },
      }),
      update(2, 'agent_message_chunk', {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'b' },
      }),
    ])

    expect((blocks[0] as MessageBlock).text).toBe('ab')
  })

  it('creates a tool call and merges later updates by toolCallId', () => {
    const blocks = fold([
      update(1, 'tool_call', {
        sessionUpdate: 'tool_call',
        toolCallId: 't1',
        title: 'Read file',
        kind: 'read',
        status: 'pending',
      }),
      update(2, 'tool_call_update', {
        sessionUpdate: 'tool_call_update',
        toolCallId: 't1',
        status: 'completed',
        rawOutput: 'ok',
      }),
    ])

    expect(blocks).toHaveLength(1)
    const tool = blocks[0] as ToolCallBlock
    expect(tool.title).toBe('Read file')
    expect(tool.status).toBe('completed')
    expect(tool.rawOutput).toBe('ok')
  })

  it('keeps unknown sessionUpdate variants instead of throwing', () => {
    const blocks = fold([
      update(1, 'mystery_update', {
        sessionUpdate: 'mystery_update',
        answer: 42,
      }),
    ])

    expect(blocks).toHaveLength(1)
    const unknown = blocks[0] as UnknownBlock
    expect(unknown.kind).toBe('unknown')
    expect(unknown.sessionUpdate).toBe('mystery_update')
    expect(unknown.raw).toEqual({ sessionUpdate: 'mystery_update', answer: 42 })
  })

  it('replaces a plan from a plan_update items payload', () => {
    const blocks = fold([
      update(1, 'plan', {
        sessionUpdate: 'plan',
        entries: [{ content: 'one', status: 'pending', priority: 'high' }],
      }),
      update(2, 'plan_update', {
        sessionUpdate: 'plan_update',
        plan: {
          type: 'items',
          planId: 'p1',
          entries: [
            { content: 'one', status: 'completed', priority: 'high' },
            { content: 'two', status: 'in_progress', priority: 'medium' },
          ],
        },
      }),
    ])

    const plans = blocks.filter((block): block is PlanBlock => block.kind === 'plan')
    const latest = plans.at(-1)
    expect(latest?.entries).toHaveLength(2)
    expect(latest?.entries[0]?.status).toBe('completed')
  })

  it('keeps audio metadata on a user message across chunk merges', () => {
    const audio = {
      id: 'a1',
      mimeType: 'audio/webm',
      playbackMimeType: 'audio/mp4',
      durationMs: 3200,
      sizeBytes: 1234,
    }
    const blocks = fold([
      update(1, 'user_message_chunk', {
        sessionUpdate: 'user_message_chunk',
        messageId: 'c1',
        content: { type: 'text', text: 'voice text' },
        audio,
      }),
      update(2, 'user_message_chunk', {
        sessionUpdate: 'user_message_chunk',
        messageId: 'c1',
        content: { type: 'text', text: ' continued' },
      }),
    ])

    expect(blocks).toHaveLength(1)
    const message = blocks[0] as MessageBlock
    expect(message.text).toBe('voice text continued')
    expect(message.audio).toEqual(audio)
  })

  it('creates an audio-only user message when text is empty', () => {
    const blocks = fold([
      update(1, 'user_message_chunk', {
        sessionUpdate: 'user_message_chunk',
        messageId: 'c1',
        content: { type: 'text', text: '' },
        audio: {
          id: 'a1',
          mimeType: 'audio/webm',
          playbackMimeType: 'audio/mp4',
          durationMs: 1200,
          sizeBytes: 99,
        },
      }),
    ])

    expect((blocks[0] as MessageBlock).text).toBe('')
    expect((blocks[0] as MessageBlock).audio?.id).toBe('a1')
  })

  it('prepends history boundary notices', () => {
    const blocks = fold([], { historyTruncated: true, historyStartsAt: 1_700_000_000_000 })

    expect(blocks.map((block) => block.kind)).toEqual(['notice', 'notice'])
    expect(blocks[0]).toMatchObject({ code: 'history_truncated' })
    expect(blocks[1]).toMatchObject({ code: 'history_starts_at' })
  })
})
