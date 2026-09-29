import { decryptBytes, encryptBytes, importAesKey, randomBytes, toBase64, fromBase64 } from '../crypto/encryption'
import type { VaultMeta } from '../types/vault'
import { asBufferSource } from '../utils/binary'

/**
 * WebAuthn unlock in this app is PRF-only. The PRF ("pseudo-random
 * function") extension lets an authenticator return a deterministic,
 * secret-derived byte string during an assertion — that byte string is
 * used as key material for wrapping the Vault Master Key.
 *
 * Without PRF, WebAuthn can only tell you "user verification succeeded",
 * which is a device gate, not key material — it would not actually protect
 * the encrypted data, only gate a UI screen. We deliberately do not
 * implement that weaker mode and pretend it's equivalent encryption, since
 * that would overstate the app's security. If the authenticator/browser
 * doesn't support PRF, the WebAuthn unlock option is simply unavailable.
 */

const RP_NAME = 'sAuth Authenticator'
const PRF_SALT_BYTES = 32
const PRF_INFO = new TextEncoder().encode('sAuth-vault-unlock-v1')

export function isWebAuthnSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!window.PublicKeyCredential &&
    typeof navigator.credentials?.create === 'function'
  )
}

/**
 * Best-effort probe for whether this browser/authenticator advertises PRF
 * support, so the UI can tell the user *before* they enter their passphrase
 * and go through a ceremony that will fail at the very end.
 *
 * `getClientCapabilities()` is relatively new and not universally shipped, so
 * an unknown result is reported as "supported" — the real PRF check still
 * happens authoritatively during enrollment, against the actual credential.
 * Guessing "unsupported" here would wrongly block working devices.
 */
export async function isPrfSupported(): Promise<boolean> {
  const staticClass = (typeof PublicKeyCredential !== 'undefined'
    ? PublicKeyCredential
    : undefined) as unknown as {
    getClientCapabilities?: () => Promise<Record<string, unknown>>
  } | undefined

  if (typeof staticClass?.getClientCapabilities !== 'function') return true
  try {
    const capabilities = await staticClass.getClientCapabilities()
    if (typeof capabilities?.prf === 'boolean') return capabilities.prf
  } catch {
    // Capability reporting can fail in cross-origin iframes; treat unknown
    // as supported and let the enrollment ceremony decide for real.
  }
  return true
}

function bufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlToBuffer(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/')
  const padding = (4 - (b64.length % 4)) % 4
  return fromBase64(b64 + '='.repeat(padding))
}

interface PrfExtensionResults {
  prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } }
}

interface ClientExtensionCapable {
  getClientExtensionResults(): AuthenticationExtensionsClientOutputs
}

function getPrfOutput(credential: PublicKeyCredential): ArrayBuffer | null {
  const results = (credential as unknown as ClientExtensionCapable).getClientExtensionResults() as
    | PrfExtensionResults
    | undefined
  return results?.prf?.results?.first ?? null
}

/**
 * Registers a new WebAuthn credential and wraps the provided VMK bytes under
 * a key derived from the authenticator's PRF output.
 *
 * Registration is a two-step ceremony, which is the part that is easy to get
 * wrong: the WebAuthn PRF extension is only *enabled* during registration.
 * `prf.eval` has no defined meaning in a creation request, so authenticators
 * that follow the spec (Chrome/Google Password Manager on Android, for
 * example) ignore it and return no `results`. The deterministic output can
 * only be obtained from a subsequent **assertion**. Asking for `eval` during
 * creation and treating the missing result as "PRF unsupported" is what makes
 * device unlock fail on hardware that supports it perfectly well.
 *
 * Returns null (rather than throwing) if PRF isn't available, so the caller
 * can show "not supported on this device" instead of a hard error.
 */
export async function registerWebAuthnUnlock(
  vmkBytes: Uint8Array,
  accountLabel: string,
): Promise<VaultMeta['webAuthn'] | null> {
  if (!isWebAuthnSupported()) return null

  const userId = randomBytes(16)
  const prfSalt = randomBytes(PRF_SALT_BYTES)

  const credential = (await navigator.credentials.create({
    publicKey: {
      rp: { name: RP_NAME },
      user: { id: asBufferSource(userId), name: accountLabel, displayName: accountLabel },
      challenge: asBufferSource(randomBytes(32)),
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 }, // ES256
        { type: 'public-key', alg: -257 }, // RS256 fallback
      ],
      authenticatorSelection: { userVerification: 'required' },
      // Registration only *enables* PRF on the new credential. The output is
      // fetched by the assertion below.
      extensions: { prf: {} } as AuthenticationExtensionsClientInputs,
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null

  if (!credential) return null

  // Second step: now that the credential exists, ask for an assertion that
  // evaluates the PRF with our salt. This is the only request type where the
  // authenticator returns secret-derived key material.
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: asBufferSource(randomBytes(32)),
      allowCredentials: [{ id: credential.rawId, type: 'public-key' }],
      userVerification: 'required',
      extensions: { prf: { eval: { first: asBufferSource(prfSalt) } } } as AuthenticationExtensionsClientInputs,
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null

  if (!assertion) return null

  const prfOutput = getPrfOutput(assertion)
  if (!prfOutput) {
    // The credential was created but the authenticator produced no key
    // material: it genuinely doesn't implement PRF, so there is nothing to
    // wrap. Report unsupported rather than storing an entry that could never
    // unlock anything.
    return null
  }

  const kek = await derivePrfKek(prfOutput)
  const wrappedVmk = await encryptBytes(kek, vmkBytes)

  return {
    credentialId: bufferToBase64Url(credential.rawId),
    prfSaltB64: toBase64(prfSalt),
    wrappedVmk,
  }
}

/**
 * Prompts for a WebAuthn assertion and, on success, unwraps and returns
 * the VMK bytes as a usable CryptoKey. Throws if the assertion fails or
 * PRF output can't be obtained.
 */
export async function unlockWithWebAuthn(meta: VaultMeta): Promise<CryptoKey> {
  if (!meta.webAuthn) {
    throw new Error('WebAuthn unlock is not set up for this vault.')
  }
  if (!isWebAuthnSupported()) {
    throw new Error('WebAuthn is not available in this browser.')
  }

  const prfSalt = fromBase64(meta.webAuthn.prfSaltB64)
  const credentialId = base64UrlToBuffer(meta.webAuthn.credentialId)

  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: asBufferSource(randomBytes(32)),
      allowCredentials: [{ id: asBufferSource(credentialId), type: 'public-key' }],
      userVerification: 'required',
      extensions: { prf: { eval: { first: asBufferSource(prfSalt) } } } as AuthenticationExtensionsClientInputs,
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null

  if (!assertion) {
    throw new Error('WebAuthn unlock was cancelled.')
  }

  const prfOutput = getPrfOutput(assertion)
  if (!prfOutput) {
    throw new Error('This authenticator did not return the expected key material.')
  }

  const kek = await derivePrfKek(prfOutput)
  const vmkBytes = await decryptBytes(kek, meta.webAuthn.wrappedVmk)
  return importAesKey(vmkBytes)
}

/** Derives a non-extractable AES-GCM KEK from raw PRF output bytes via HKDF. */
async function derivePrfKek(prfOutput: ArrayBuffer): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey('raw', prfOutput, 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: asBufferSource(new Uint8Array(0)), info: asBufferSource(PRF_INFO) },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}
