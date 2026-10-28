import { describe, expect, it } from 'vitest'
import { BridgeError, mapAcpError } from '../src/acp/errors.js'

describe('mapAcpError', () => {
  it.each([
    ['session is already active: abc', 'session_busy'],
    ['session is not resumable: abc', 'session_gone'],
    ['session cwd does not match: /tmp', 'session_cwd_mismatch'],
    ['Connection closed', 'agent_disconnected'],
    ['something unexpected', 'agent_error'],
  ])('maps %s to %s', (message, code) => {
    const mapped = mapAcpError(new Error(message))
    expect(mapped).toBeInstanceOf(BridgeError)
    expect(mapped.code).toBe(code)
  })

  it('is retryable only for disconnects', () => {
    expect(mapAcpError(new Error('Connection closed')).retryable).toBe(true)
    expect(mapAcpError(new Error('session is not resumable')).retryable).toBe(false)
  })

  it('returns BridgeError instances unchanged', () => {
    const original = new BridgeError('lease_held', 'held', false)
    expect(mapAcpError(original)).toBe(original)
  })
})
