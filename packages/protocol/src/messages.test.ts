import { describe, expect, it } from 'vitest'
import { audioAttachmentSchema } from './entities'
import { clientMessageSchema, serverMessageSchema } from './messages'

describe('client protocol', () => {
  it('parses auth and prompt messages', () => {
    expect(clientMessageSchema.parse({ type: 'auth', token: 'secret', deviceId: 'phone' })).toEqual(
      { type: 'auth', token: 'secret', deviceId: 'phone' },
    )

    const prompt = clientMessageSchema.parse({
      type: 'session.prompt',
      sessionId: 's1',
      clientMsgId: 'c1',
      text: 'hello',
      images: [{ mimeType: 'image/png', data: 'AAAA' }],
    })
    expect(prompt.type).toBe('session.prompt')

    const withAudio = clientMessageSchema.parse({
      type: 'session.prompt',
      sessionId: 's1',
      clientMsgId: 'c2',
      text: 'voice',
      audioId: 'a1',
    })
    expect(withAudio).toMatchObject({ type: 'session.prompt', audioId: 'a1' })
  })

  it('rejects an oversized audioId', () => {
    expect(
      clientMessageSchema.safeParse({
        type: 'session.prompt',
        sessionId: 's1',
        clientMsgId: 'c1',
        text: 'x',
        audioId: 'x'.repeat(65),
      }).success,
    ).toBe(false)
  })

  it('rejects oversized tokens and unknown message types', () => {
    expect(
      clientMessageSchema.safeParse({ type: 'auth', token: 'x'.repeat(257), deviceId: 'phone' })
        .success,
    ).toBe(false)
    expect(clientMessageSchema.safeParse({ type: 'not.a.message', sessionId: 's1' }).success).toBe(
      false,
    )
  })
})

describe('audio attachment protocol', () => {
  it('validates attachment metadata', () => {
    const parsed = audioAttachmentSchema.safeParse({
      id: 'a1',
      mimeType: 'audio/webm',
      playbackMimeType: 'audio/mp4',
      durationMs: 1200,
      sizeBytes: 4096,
    })
    expect(parsed.success).toBe(true)
    expect(
      audioAttachmentSchema.safeParse({
        id: 'a1',
        mimeType: 'audio/webm',
        playbackMimeType: 'audio/mp4',
        durationMs: -1,
        sizeBytes: 4096,
      }).success,
    ).toBe(false)
    expect(
      audioAttachmentSchema.safeParse({
        id: 'a1',
        mimeType: 'x'.repeat(65),
        playbackMimeType: 'audio/mp4',
        durationMs: 1200,
        sizeBytes: 4096,
      }).success,
    ).toBe(false)
  })
})

describe('server protocol', () => {
  it('passes unknown session updates through verbatim', () => {
    const message = serverMessageSchema.parse({
      type: 'session.update',
      sessionId: 's1',
      seq: 3,
      update: { sessionUpdate: 'future_variant', extra: { nested: true } },
    })

    expect(message.type).toBe('session.update')
    if (message.type === 'session.update') {
      expect(message.update).toEqual({ sessionUpdate: 'future_variant', extra: { nested: true } })
    }
  })

  it('parses a snapshot with render blocks and a pending permission', () => {
    const message = serverMessageSchema.parse({
      type: 'session.snapshot',
      session: {
        id: 's1',
        title: null,
        cwd: 'C:/work',
        createdAt: 1,
        lastActivityAt: 2,
        lastSeq: 3,
        lease: { state: 'read', holder: null },
        running: false,
      },
      seq: 3,
      blocks: [
        {
          kind: 'message',
          id: 'msg:1',
          role: 'assistant',
          text: 'hi',
        },
      ],
      pendingPermission: {
        requestId: 'r1',
        sessionId: 's1',
        toolCall: { toolCallId: 't1' },
        options: [{ optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' }],
      },
    })

    expect(message.type).toBe('session.snapshot')
  })
})
