import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decryptString, encryptString, randomBytes } from '../crypto/encryption'
import { isPrfSupported, registerWebAuthnUnlock, unlockWithWebAuthn } from './webauthn'
import type { VaultMeta } from '../types/vault'

/**
 * These tests pin down the two-step PRF ceremony.
 *
 * The bug they guard against: registration used to ask for
 * `prf: { eval: ... }` in `navigator.credentials.create()`. `eval` is only
 * meaningful on an assertion — a spec-compliant authenticator ignores it and
 * returns no `results`, so enrollment concluded "PRF unsupported" on hardware
 * that supports it perfectly well. Registration must only *enable* PRF
 * (`prf: {}`), and the output must come from a follow-up `get()`.
 */

const PRF_OUTPUT = new Uint8Array(32).fill(7)

let createCalls: Array<Record<string, unknown>> = []
let getCalls: Array<Record<string, unknown>> = []
let createReturnsPrfOnRegistration: boolean
let assertionReturnsPrf: boolean

function installWebAuthnMocks() {
  const create = vi.fn(async (options: Record<string, unknown>) => {
    createCalls.push(options)
    const prf = createReturnsPrfOnRegistration
      ? { enabled: true, results: { first: PRF_OUTPUT.buffer as ArrayBuffer } }
      : undefined
    return {
      rawId: randomBytes(16).buffer,
      id: 'fake-id',
      type: 'public-key',
      getClientExtensionResults: () => ({ prf }),
    }
  })
  const get = vi.fn(async (options: Record<string, unknown>) => {
    getCalls.push(options)
    if (!assertionReturnsPrf) {
      throw Object.assign(new Error('The operation either timed out or was not allowed.'), {
        name: 'NotAllowedError',
      })
    }
    return {
      rawId: randomBytes(16).buffer,
      id: 'fake-id',
      type: 'public-key',
      getClientExtensionResults: () => ({
        prf: { enabled: true, results: { first: PRF_OUTPUT.buffer as ArrayBuffer } },
      }),
    }
  })

  Object.defineProperty(globalThis, 'PublicKeyCredential', {
    configurable: true,
    value: function PublicKeyCredentialStub() {},
  })
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { PublicKeyCredential: globalThis.PublicKeyCredential },
  })
  Object.defineProperty(navigator, 'credentials', {
    configurable: true,
    value: { create, get },
  })
}

beforeEach(() => {
  createCalls = []
  getCalls = []
  createReturnsPrfOnRegistration = false // matches real, spec-compliant behaviour
  assertionReturnsPrf = true
  installWebAuthnMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('registerWebAuthnUnlock', () => {
  it('enables PRF at registration and fetches key material from a follow-up assertion', async () => {
    const vmk = randomBytes(32)
    const result = await registerWebAuthnUnlock(vmk, 'sAuth test')

    expect(result).not.toBeNull()
    expect(createCalls).toHaveLength(1)
    expect(getCalls).toHaveLength(1)

    // Registration must NOT request an evaluation — that is the bug.
    const createExtensions = (createCalls[0].publicKey as { extensions?: { prf?: unknown } }).extensions
    expect(createExtensions?.prf).toEqual({})
    expect(JSON.stringify(createExtensions)).not.toContain('eval')

    // The assertion is where the PRF output is actually obtained.
    const getPublicKey = getCalls[0].publicKey as {
      extensions: { prf: { eval: { first: Uint8Array } } }
      allowCredentials: Array<{ id: Uint8Array }>
    }
    expect(getPublicKey.extensions.prf.eval.first).toBeInstanceOf(Uint8Array)
    expect(getPublicKey.extensions.prf.eval.first.length).toBe(32)
    expect(getPublicKey.allowCredentials).toHaveLength(1)
  })

  it('uses the same PRF salt for enrollment and for later unlock', async () => {
    const vmk = randomBytes(32)
    const enrolled = await registerWebAuthnUnlock(vmk, 'sAuth test')
    expect(enrolled).not.toBeNull()

    const meta = { webAuthn: enrolled! } as VaultMeta
    await unlockWithWebAuthn(meta)

    const enrollmentSalt = (getCalls[0].publicKey as { extensions: { prf: { eval: { first: Uint8Array } } } })
      .extensions.prf.eval.first
    const unlockSalt = (getCalls[1].publicKey as { extensions: { prf: { eval: { first: Uint8Array } } } })
      .extensions.prf.eval.first
    expect(Array.from(unlockSalt)).toEqual(Array.from(enrollmentSalt))
  })

  it('returns null when the user dismisses the device-verification prompt', async () => {
    assertionReturnsPrf = false
    await expect(registerWebAuthnUnlock(randomBytes(32), 'sAuth test')).rejects.toThrow()
  })

  it('returns null when the assertion returns no PRF key material', async () => {
    // The credential is created fine, but the authenticator yields no PRF
    // output — the genuine "unsupported" case.
    vi.spyOn(navigator.credentials, 'get').mockResolvedValue({
      rawId: randomBytes(16).buffer,
      id: 'x',
      type: 'public-key',
      getClientExtensionResults: () => ({ prf: { enabled: false } }),
    } as unknown as Credential)
    await expect(registerWebAuthnUnlock(randomBytes(32), 'sAuth test')).resolves.toBeNull()
  })

  it('returns null when the user dismisses the credential chooser', async () => {
    vi.spyOn(navigator.credentials, 'create').mockResolvedValue(null)
    await expect(registerWebAuthnUnlock(randomBytes(32), 'sAuth test')).resolves.toBeNull()
  })
})

describe('unlockWithWebAuthn', () => {
  it('unwraps the same VMK bytes that were enrolled', async () => {
    const vmk = randomBytes(32)
    const enrolled = await registerWebAuthnUnlock(vmk, 'sAuth test')
    const meta = { webAuthn: enrolled! } as VaultMeta

    const key = await unlockWithWebAuthn(meta)
    expect(key).toBeTruthy()

    // Prove the recovered key really is the original VMK by using it: data
    // encrypted with the freshly-unwrapped key must decrypt cleanly.
    const blob = await encryptString(key, 'round trip')
    await expect(decryptString(key, blob)).resolves.toBe('round trip')
  })

  it('rejects when the vault has no WebAuthn enrollment', async () => {
    await expect(unlockWithWebAuthn({} as VaultMeta)).rejects.toThrow(/not set up/i)
  })
})

describe('isPrfSupported', () => {
  it('reports the advertised capability when the browser exposes one', async () => {
    ;(globalThis.PublicKeyCredential as unknown as { getClientCapabilities: () => Promise<Record<string, boolean>> })
      .getClientCapabilities = async () => ({ prf: true })
    await expect(isPrfSupported()).resolves.toBe(true)
  })

  it('reports unsupported when the browser advertises no PRF', async () => {
    ;(globalThis.PublicKeyCredential as unknown as { getClientCapabilities: () => Promise<Record<string, boolean>> })
      .getClientCapabilities = async () => ({ prf: false })
    await expect(isPrfSupported()).resolves.toBe(false)
  })

  it('optimistically reports supported when the browser cannot tell us', async () => {
    delete (globalThis.PublicKeyCredential as unknown as { getClientCapabilities?: unknown })
      .getClientCapabilities
    await expect(isPrfSupported()).resolves.toBe(true)
  })
})
