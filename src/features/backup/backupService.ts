import {
  createKdfParams,
  decryptJson,
  derivePassphraseKey,
  encryptJson,
} from '../../crypto/encryption'
import { isValidBase32, normalizeBase32 } from '../../otp/base32'
import type { AuthenticatorAccount, OtpAlgorithm, OtpDigits } from '../../types/account'
import type { BackupFile, BackupPayload, KdfParams } from '../../types/vault'
import { BACKUP_FORMAT_VERSION } from '../../types/vault'

const BACKUP_FORMAT_TAG = 'sAuth-backup'
export const MIN_BACKUP_PASSWORD_LENGTH = 8

export class BackupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BackupError'
  }
}

/**
 * Encrypts the given accounts into a self-contained, portable backup file
 * (a plain JSON object — the caller decides how to persist/download it).
 * The backup uses its own password, independent of the vault passphrase,
 * so a backup can be shared or stored somewhere else without exposing the
 * live vault's unlock credential.
 */
export async function createBackup(
  accounts: AuthenticatorAccount[],
  backupPassword: string,
): Promise<BackupFile> {
  if (backupPassword.length < MIN_BACKUP_PASSWORD_LENGTH) {
    throw new BackupError(`Backup password must be at least ${MIN_BACKUP_PASSWORD_LENGTH} characters.`)
  }

  const kdf = createKdfParams()
  const key = await derivePassphraseKey(backupPassword, kdf)

  const payload: BackupPayload = {
    version: BACKUP_FORMAT_VERSION,
    accounts: accounts.map((a) => ({
      issuer: a.issuer,
      accountName: a.accountName,
      secret: a.secret,
      algorithm: a.algorithm,
      digits: a.digits,
      period: a.period,
      type: 'totp',
      favorite: a.favorite,
      order: a.order,
    })),
  }

  const encryptedPayload = await encryptJson(key, payload)

  return {
    format: BACKUP_FORMAT_TAG,
    version: BACKUP_FORMAT_VERSION,
    createdAt: Date.now(),
    kdf,
    payload: encryptedPayload,
  }
}

const VALID_ALGORITHMS: OtpAlgorithm[] = ['SHA-1', 'SHA-256', 'SHA-512']

/**
 * Bounds on the KDF parameters we will honour when importing a backup.
 *
 * The file is untrusted input, and `iterations` directly controls how much
 * work we do. Without a ceiling, a crafted file could ask for billions of
 * PBKDF2 rounds and hang the tab; without a floor, a file could weaken the
 * key derivation for whatever it decrypts. The range is deliberately wide
 * enough to cover every legitimate sAuth backup, including ones written
 * before the iteration default changed.
 */
const MIN_IMPORT_ITERATIONS = 1_000
const MAX_IMPORT_ITERATIONS = 2_000_000

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertShape(value: unknown): value is BackupFile {
  if (!isPlainObject(value)) return false
  return (
    value.format === BACKUP_FORMAT_TAG &&
    typeof value.version === 'number' &&
    typeof value.createdAt === 'number' &&
    isPlainObject(value.kdf) &&
    isPlainObject(value.payload) &&
    typeof (value.payload as Record<string, unknown>).ivB64 === 'string' &&
    typeof (value.payload as Record<string, unknown>).ciphertextB64 === 'string'
  )
}

/** Validates the KDF block before it is handed to PBKDF2. */
function assertUsableKdf(kdf: unknown): asserts kdf is KdfParams {
  if (!isPlainObject(kdf)) {
    throw new BackupError('This backup is missing its key-derivation settings.')
  }
  const { algorithm, hash, iterations, saltB64 } = kdf
  if (algorithm !== 'PBKDF2' || hash !== 'SHA-256') {
    throw new BackupError('This backup uses an unsupported key-derivation method.')
  }
  if (
    typeof iterations !== 'number' ||
    !Number.isInteger(iterations) ||
    iterations < MIN_IMPORT_ITERATIONS ||
    iterations > MAX_IMPORT_ITERATIONS
  ) {
    throw new BackupError('This backup requests an unsupported amount of key-derivation work.')
  }
  if (typeof saltB64 !== 'string' || saltB64.length === 0) {
    throw new BackupError('This backup is missing its key-derivation salt.')
  }
}

/**
 * Parses, version-checks, decrypts, and validates a backup file. Treats
 * every field as untrusted input — this is the import boundary, and a
 * corrupt or malicious file must never crash the app or silently produce
 * broken accounts.
 */
export async function readBackup(
  rawJson: string,
  backupPassword: string,
): Promise<AuthenticatorAccount[]> {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawJson)
  } catch {
    throw new BackupError('This file is not a valid backup (not valid JSON).')
  }

  if (!assertShape(parsed)) {
    throw new BackupError('This file is not a recognized Web Authenticator backup.')
  }

  if (parsed.version !== BACKUP_FORMAT_VERSION) {
    throw new BackupError('Unsupported backup version. Please update the authenticator application.')
  }

  assertUsableKdf(parsed.kdf)

  let key: CryptoKey
  let payload: BackupPayload
  try {
    key = await derivePassphraseKey(backupPassword, parsed.kdf)
    payload = await decryptJson<BackupPayload>(key, parsed.payload)
  } catch {
    // Also covers malformed base64/ciphertext, which surfaces here as a
    // Web Crypto error rather than a password problem.
    throw new BackupError('Incorrect backup password, or the file is corrupted.')
  }

  if (payload.version !== BACKUP_FORMAT_VERSION || !Array.isArray(payload.accounts)) {
    throw new BackupError('This backup is malformed and cannot be restored.')
  }

  const now = Date.now()
  const accounts: AuthenticatorAccount[] = []

  payload.accounts.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object') return
    const secret = normalizeBase32(String(raw.secret ?? ''))
    if (!isValidBase32(secret)) return // skip silently-corrupt entries rather than aborting the whole restore

    const algorithm = VALID_ALGORITHMS.includes(raw.algorithm as OtpAlgorithm)
      ? (raw.algorithm as OtpAlgorithm)
      : 'SHA-1'
    const digits: OtpDigits = raw.digits === 8 ? 8 : 6
    const period = Number.isInteger(raw.period) && raw.period! > 0 ? raw.period! : 30

    accounts.push({
      id: crypto.randomUUID(),
      issuer: String(raw.issuer ?? 'Unknown issuer'),
      accountName: String(raw.accountName ?? ''),
      secret,
      algorithm,
      digits,
      period,
      type: 'totp',
      favorite: Boolean(raw.favorite),
      order: Number.isInteger(raw.order) ? raw.order! : index,
      createdAt: now,
      updatedAt: now,
    })
  })

  if (accounts.length === 0 && payload.accounts.length > 0) {
    throw new BackupError('None of the accounts in this backup could be read.')
  }

  return accounts
}
