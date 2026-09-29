import { useContext } from 'react'
import { VaultContext, type VaultContextValue } from './VaultContext'
import type { VaultMeta } from '../types/vault'
import { derivePassphraseKey, tryDecryptBytes } from '../crypto/encryption'
import { IncorrectPassphraseError } from '../services/vaultService'
import { registerWebAuthnUnlock } from '../webauthn/webauthn'
import { saveVaultMeta } from '../storage/vaultRepo'

export function useVault(): VaultContextValue {
  const ctx = useContext(VaultContext)
  if (!ctx) throw new Error('useVault must be used within a VaultProvider')
  return ctx
}

/**
 * Enrolls WebAuthn by re-deriving the VMK from a freshly entered
 * passphrase (rather than trying to extract it from the live session
 * key, which is intentionally non-extractable). Exposed as a standalone
 * function rather than a context method because it needs the current
 * meta + passphrase together, which the settings screen already has at
 * the point it calls this.
 */
export async function enrollWebAuthnWithPassphrase(
  meta: VaultMeta,
  passphrase: string,
  accountLabel: string,
): Promise<VaultMeta> {
  const kek = await derivePassphraseKey(passphrase, meta.kdf)
  const vmkBytes = await tryDecryptBytes(kek, meta.wrappedVmk)
  if (!vmkBytes) {
    throw new IncorrectPassphraseError()
  }
  const webAuthn = await registerWebAuthnUnlock(vmkBytes, accountLabel)
  if (!webAuthn) {
    throw new Error(
      'Device unlock could not be set up. This authenticator did not return the key material ' +
        'required for it — it either does not support the WebAuthn PRF extension, or the ' +
        'ceremony was cancelled. Your passphrase still works as normal.',
    )
  }
  const updated: VaultMeta = { ...meta, webAuthn }
  await saveVaultMeta(updated)
  return updated
}
