import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createAccount,
  deleteAccount,
  loadAllAccounts,
  reorderAccounts,
  replaceAllAccounts,
  updateAccount,
} from './accountsRepo'
import { closeDb } from './db'
import { generateVmkBytes, importAesKey } from '../crypto/encryption'
import { asBufferSource } from '../utils/binary'
import type { NewAccountInput } from '../types/account'

/**
 * These tests guard a real data-loss bug.
 *
 * IndexedDB transactions auto-commit as soon as the microtask queue drains
 * with no pending request. Awaiting Web Crypto *inside* a readwrite
 * transaction therefore closes the transaction before the `put`s are issued,
 * so reordering and backup-restore silently wrote nothing. The repo now
 * encrypts first and opens the transaction only for the writes.
 */

let key: CryptoKey
let counter = 0

function makeInput(overrides: Partial<NewAccountInput> = {}): NewAccountInput {
  counter += 1
  return {
    issuer: 'Example',
    accountName: `user${counter}@example.com`,
    secret: 'JBSWY3DPEHPK3PXP',
    algorithm: 'SHA-1',
    digits: 6,
    period: 30,
    type: 'totp',
    ...overrides,
  }
}

beforeEach(async () => {
  counter = 0
  await closeDb()
  // A fresh vault per test: wipe whatever the previous one left behind.
  const { wipeDatabase } = await import('./db')
  await wipeDatabase()
  key = await importAesKey(generateVmkBytes())
})

afterEach(async () => {
  await closeDb()
})

describe('accountsRepo', () => {
  it('round-trips accounts and returns them in stored order', async () => {
    await createAccount(key, makeInput({ accountName: 'a' }))
    await createAccount(key, makeInput({ accountName: 'b' }))
    const loaded = await loadAllAccounts(key)
    expect(loaded).toHaveLength(2)
    expect(loaded.map((a) => a.accountName)).toEqual(['a', 'b'])
  })

  it('does not reuse the order of a deleted account when appending', async () => {
    const first = await createAccount(key, makeInput({ accountName: 'a' }))
    await createAccount(key, makeInput({ accountName: 'b' }))
    await deleteAccount(first.id)

    const third = await createAccount(key, makeInput({ accountName: 'c' }))
    const loaded = await loadAllAccounts(key)
    const orders = loaded.map((a) => a.order)
    // Orders must stay unique, otherwise the list sorts unpredictably.
    expect(new Set(orders).size).toBe(orders.length)
    expect(loaded.map((a) => a.accountName)).toEqual(['b', 'c'])
    expect(third.order).toBeGreaterThan(loaded[0].order)
  })

  it('persists every record when reordering (transaction does not auto-close)', async () => {
    const a = await createAccount(key, makeInput({ accountName: 'a' }))
    const b = await createAccount(key, makeInput({ accountName: 'b' }))
    const c = await createAccount(key, makeInput({ accountName: 'c' }))

    const reordered = await reorderAccounts(key, [a, b, c], [c.id, a.id, b.id])
    expect(reordered.map((x) => x.accountName)).toEqual(['c', 'a', 'b'])

    // Re-read from the database: the writes must actually be durable, not
    // just reflected in the returned array.
    const loaded = await loadAllAccounts(key)
    expect(loaded).toHaveLength(3)
    expect(loaded.map((x) => x.accountName)).toEqual(['c', 'a', 'b'])
    expect(loaded.map((x) => x.order)).toEqual([0, 1, 2])
  })

  it('persists every record on replace-all (restore from backup)', async () => {
    await createAccount(key, makeInput({ accountName: 'old-1' }))
    await createAccount(key, makeInput({ accountName: 'old-2' }))

    const incoming = [1, 2, 3, 4, 5].map((n) => makeInput({ accountName: `restored-${n}` }))
    await replaceAllAccounts(key, incoming)

    const loaded = await loadAllAccounts(key)
    expect(loaded).toHaveLength(5)
    expect(loaded.map((a) => a.accountName)).toEqual([
      'restored-1',
      'restored-2',
      'restored-3',
      'restored-4',
      'restored-5',
    ])
  })

  it('leaves the existing accounts intact if replacement fails mid-way', async () => {
    await createAccount(key, makeInput({ accountName: 'keep-me' }))

    // A decrypt-only key is a valid CryptoKey but throws on encrypt, which
    // simulates encryption failing part-way through a restore. Because we now
    // encrypt everything before touching the store, the original accounts are
    // still intact when that happens.
    const decryptOnlyKey = await crypto.subtle.importKey(
      'raw',
      asBufferSource(generateVmkBytes()),
      { name: 'AES-GCM' },
      false,
      ['decrypt'],
    )

    await expect(
      replaceAllAccounts(decryptOnlyKey, [makeInput({ accountName: 'a' }), makeInput({ accountName: 'b' })]),
    ).rejects.toThrow()

    const loaded = await loadAllAccounts(key)
    expect(loaded.map((a) => a.accountName)).toEqual(['keep-me'])
  })

  it('persists edits', async () => {
    const account = await createAccount(key, makeInput({ accountName: 'before' }))
    const updated = await updateAccount(key, { ...account, accountName: 'after' })
    expect(updated.accountName).toBe('after')
    const loaded = await loadAllAccounts(key)
    expect(loaded[0].accountName).toBe('after')
  })
})
