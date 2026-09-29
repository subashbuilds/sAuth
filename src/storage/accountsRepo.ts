import { getDb } from './db'
import { decryptJson, encryptJson } from '../crypto/encryption'
import type { AuthenticatorAccount, NewAccountInput } from '../types/account'

function generateId(): string {
  // crypto.randomUUID is available in all modern browsers in secure contexts.
  return crypto.randomUUID()
}

/** Loads and decrypts every account, sorted by their stored order. */
export async function loadAllAccounts(key: CryptoKey): Promise<AuthenticatorAccount[]> {
  const db = await getDb()
  const records = await db.getAllFromIndex('accounts', 'by-order')
  const accounts = await Promise.all(
    records.map((record) => decryptJson<AuthenticatorAccount>(key, record.blob)),
  )
  return accounts
}

export async function createAccount(
  key: CryptoKey,
  input: NewAccountInput,
): Promise<AuthenticatorAccount> {
  const db = await getDb()
  const now = Date.now()
  // Append after the highest existing order rather than using the row count:
  // deleting an account lowers the count, which would hand a new account an
  // order that collides with a surviving one and make the list sort
  // unpredictably.
  const ordered = await db.getAllFromIndex('accounts', 'by-order')
  const highest = ordered.reduce(
    (max, record) => (Number.isInteger(record.order) && record.order > max ? record.order : max),
    -1,
  )
  const nextOrder = highest + 1

  const account: AuthenticatorAccount = {
    ...input,
    id: generateId(),
    favorite: input.favorite ?? false,
    createdAt: now,
    updatedAt: now,
    order: nextOrder,
  }

  const blob = await encryptJson(key, account)
  await db.put('accounts', {
    id: account.id,
    blob,
    order: account.order,
    updatedAt: account.updatedAt,
  })

  return account
}

export async function updateAccount(
  key: CryptoKey,
  account: AuthenticatorAccount,
): Promise<AuthenticatorAccount> {
  const db = await getDb()
  const updated: AuthenticatorAccount = { ...account, updatedAt: Date.now() }
  const blob = await encryptJson(key, updated)
  await db.put('accounts', {
    id: updated.id,
    blob,
    order: updated.order,
    updatedAt: updated.updatedAt,
  })
  return updated
}

export async function deleteAccount(id: string): Promise<void> {
  const db = await getDb()
  await db.delete('accounts', id)
}

/** Persists a full reordering. `orderedIds` must contain every account id exactly once. */
export async function reorderAccounts(
  key: CryptoKey,
  accounts: AuthenticatorAccount[],
  orderedIds: string[],
): Promise<AuthenticatorAccount[]> {
  const byId = new Map(accounts.map((a) => [a.id, a]))
  const now = Date.now()

  const updatedAccounts = orderedIds
    .map((id, index) => {
      const account = byId.get(id)
      if (!account) return null
      return { ...account, order: index, updatedAt: now }
    })
    .filter((a): a is AuthenticatorAccount => a !== null)

  // Encrypt everything *before* opening the transaction. An IndexedDB
  // transaction auto-commits as soon as the microtask queue drains with no
  // pending request, so awaiting Web Crypto inside it would close the
  // transaction out from under us and the writes would be lost.
  const records = await Promise.all(
    updatedAccounts.map(async (updated) => ({
      id: updated.id,
      blob: await encryptJson(key, updated),
      order: updated.order,
      updatedAt: updated.updatedAt,
    })),
  )

  const db = await getDb()
  const tx = db.transaction('accounts', 'readwrite')
  await Promise.all(records.map((record) => tx.store.put(record)))
  await tx.done

  return updatedAccounts.sort((a, b) => a.order - b.order)
}

export async function replaceAllAccounts(
  key: CryptoKey,
  accounts: NewAccountInput[],
): Promise<void> {
  const now = Date.now()

  // Build and encrypt the replacement set first. Clearing the store before
  // the new rows exist would leave the vault empty if encryption failed
  // part-way through, which is unrecoverable data loss for an authenticator.
  const newAccounts: AuthenticatorAccount[] = accounts.map((input, index) => ({
    ...input,
    id: generateId(),
    favorite: input.favorite ?? false,
    createdAt: now,
    updatedAt: now,
    order: index,
  }))

  const records = await Promise.all(
    newAccounts.map(async (account) => ({
      id: account.id,
      blob: await encryptJson(key, account),
      order: account.order,
      updatedAt: account.updatedAt,
    })),
  )

  const db = await getDb()
  const tx = db.transaction('accounts', 'readwrite')
  // Clear and re-insert inside a single transaction so the swap is atomic:
  // readers never observe a half-populated vault, and a failure can't leave
  // the old accounts wiped.
  await tx.store.clear()
  await Promise.all(records.map((record) => tx.store.put(record)))
  await tx.done
}
