import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LeaseManager } from '../src/lease/manager.js'

describe('LeaseManager', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('moves idle -> read on attach and read -> write on take', async () => {
    const lease = new LeaseManager({ graceMs: 1000 })

    expect(await lease.attach('s', 'device-a')).toEqual({ state: 'read', holder: null })
    expect(await lease.take('s', 'device-a')).toEqual({ state: 'write', holder: 'device-a' })
    await expect(lease.assertWriter('s', 'device-a')).resolves.toBeUndefined()
    await expect(lease.assertWriter('s', 'device-b')).rejects.toMatchObject({
      code: 'lease_held',
    })

    lease.dispose()
  })

  it('downgrades the previous writer when another device takes over', async () => {
    const lease = new LeaseManager({ graceMs: 1000 })
    await lease.take('s', 'device-a')
    const snapshot = await lease.take('s', 'device-b')

    expect(snapshot).toEqual({ state: 'write', holder: 'device-b' })
    await expect(lease.assertWriter('s', 'device-a')).rejects.toMatchObject({
      code: 'lease_held',
    })

    lease.dispose()
  })

  it('starts handoff on writer detach and falls back to read after the grace period', async () => {
    const lease = new LeaseManager({ graceMs: 1000 })
    await lease.take('s', 'device-a')

    const handoff = await lease.detach('s', 'device-a')
    expect(handoff.state).toBe('handoff')
    expect(handoff.holder).toBe('device-a')
    expect(typeof handoff.deadline).toBe('number')

    vi.advanceTimersByTime(1000)
    expect(await lease.snapshot('s')).toEqual({ state: 'read', holder: null })

    lease.dispose()
  })

  it('restores write when the same device reattaches during handoff', async () => {
    const lease = new LeaseManager({ graceMs: 1000 })
    await lease.take('s', 'device-a')
    await lease.detach('s', 'device-a')

    expect(await lease.attach('s', 'device-a')).toEqual({
      state: 'write',
      holder: 'device-a',
    })

    vi.advanceTimersByTime(1000)
    expect(await lease.snapshot('s')).toEqual({ state: 'write', holder: 'device-a' })

    lease.dispose()
  })

  it('notifies subscribers about lease changes', async () => {
    const lease = new LeaseManager({ graceMs: 1000 })
    const states: string[] = []
    const unsubscribe = lease.onChange((change) => {
      states.push(change.lease.state)
    })

    await lease.attach('s', 'device-a')
    await lease.take('s', 'device-a')
    await lease.release('s', 'device-a')

    expect(states).toEqual(['read', 'write', 'read'])

    unsubscribe()
    await lease.take('s', 'device-a')
    expect(states).toHaveLength(3)

    lease.dispose()
  })
})
