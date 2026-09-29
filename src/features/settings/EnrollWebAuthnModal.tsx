import { useEffect, useState, type FormEvent } from 'react'
import { Modal } from '../../components/Modal'
import { PasswordField } from '../../components/PasswordField'
import { useVault, enrollWebAuthnWithPassphrase } from '../../app/vaultHooks'
import { isPrfSupported } from '../../webauthn/webauthn'

export function EnrollWebAuthnModal({ onClose }: { onClose: () => void }) {
  const { meta, applyMetaUpdate } = useVault()
  const [passphrase, setPassphrase] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [prfSupported, setPrfSupported] = useState<boolean | null>(null)

  // Check up front so we never ask for a passphrase and then run a ceremony
  // that is going to fail. `null` means "still checking / browser can't tell
  // us", in which case we optimistically show the form and let the real
  // enrollment attempt be the source of truth.
  useEffect(() => {
    let cancelled = false
    void isPrfSupported().then((supported) => {
      if (!cancelled) setPrfSupported(supported)
    })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!meta) return
    setError(null)
    setBusy(true)
    try {
      const label = 'Web Authenticator vault'
      const updated = await enrollWebAuthnWithPassphrase(meta, passphrase, label)
      applyMetaUpdate(updated)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not set up WebAuthn unlock.')
    } finally {
      setBusy(false)
    }
  }

  if (prfSupported === false) {
    return (
      <Modal title="Set up device unlock" onClose={onClose}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
            This browser reports that it does not support the WebAuthn PRF extension, which
            device unlock needs in order to produce real key material. Nothing has been changed,
            and your passphrase continues to work as normal.
          </p>
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
            Updating to the latest version of your browser, and making sure your phone or laptop
            has a screen lock (PIN, pattern, password, fingerprint or face) set up, usually
            enables this.
          </p>
          <button type="button" className="btn btn-primary btn-full" onClick={onClose}>
            Close
          </button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title="Set up device unlock" onClose={onClose}>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
          This lets you unlock with your device's fingerprint, face, or security key instead of
          typing your passphrase. Your passphrase still works as a backup. You'll be asked to
          confirm your passphrase, then to verify with your device.
        </p>
        <PasswordField
          label="Confirm your passphrase"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          autoFocus
        />
        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" className="btn btn-primary btn-full" disabled={busy || !passphrase}>
          {busy ? 'Setting up…' : 'Continue'}
        </button>
      </form>
    </Modal>
  )
}
