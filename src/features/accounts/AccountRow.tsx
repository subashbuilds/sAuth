import { Check, Copy, MoreVertical, Star } from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { AuthenticatorAccount } from '../../types/account'
import { useTotp } from '../../hooks/useTotp'
import { CountdownRing } from '../../components/CountdownRing'

interface AccountRowProps {
  account: AuthenticatorAccount
  onToggleFavorite: () => void
  onEdit: () => void
  onDelete: () => void
  onShowQr: () => void
}

function formatCodeForDisplay(code: string): string {
  const mid = Math.ceil(code.length / 2)
  return `${code.slice(0, mid)} ${code.slice(mid)}`
}

export function AccountRow({ account, onToggleFavorite, onEdit, onDelete, onShowQr }: AccountRowProps) {
  const { code, secondsLeft, progress, error } = useTotp(account)
  const [copied, setCopied] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const copyClearTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [menuOpen])

  async function handleCopy() {
    if (!code) return
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard API can fail without a secure context/permission; the
      // code is still visible on screen for manual copying.
      return
    }

    // A TOTP code is a live credential. Leaving it on the clipboard for the
    // rest of the session means anything that reads the clipboard later — a
    // password manager, another app, a shared device — can still read it, so
    // clear it shortly after the user has had time to paste it. Failures
    // (denied permission) are ignored: the user may still want it there.
    clearTimeout(copyClearTimer.current ?? undefined)
    copyClearTimer.current = setTimeout(() => {
      void navigator.clipboard
        .readText()
        .then((text) => {
          if (text === code) return navigator.clipboard.writeText('')
        })
        .catch(() => {
          // Reading the clipboard needs an extra permission grant we do not
          // ask for; clearing is best-effort by design.
        })
    }, 30_000)
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-4)',
        padding: 'var(--space-4)',
        borderBottom: '1px solid var(--color-border)',
      }}
    >
      <button
        type="button"
        onClick={onToggleFavorite}
        aria-label={account.favorite ? 'Remove from favorites' : 'Add to favorites'}
        aria-pressed={account.favorite}
        style={{ background: 'none', border: 'none', padding: 4, cursor: 'pointer', flexShrink: 0 }}
      >
        <Star
          size={18}
          fill={account.favorite ? 'var(--color-warning)' : 'none'}
          color={account.favorite ? 'var(--color-warning)' : 'var(--color-text-muted)'}
        />
      </button>

      <div style={{ flex: 1, minWidth: 0 }}>
        <p
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--color-text-primary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {account.issuer}
        </p>
        <p
          style={{
            fontSize: 12,
            color: 'var(--color-text-muted)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {account.accountName}
        </p>
        {error ? (
          <p className="field-error" style={{ fontSize: 12 }}>
            {error} — edit to fix the secret.
          </p>
        ) : (
          <button
            type="button"
            onClick={handleCopy}
            aria-label="Copy code"
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              marginTop: 4,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              cursor: code ? 'pointer' : 'default',
            }}
          >
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 22,
                fontWeight: 500,
                letterSpacing: '0.04em',
                color: 'var(--color-text-primary)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {code ? formatCodeForDisplay(code) : '······'}
            </span>
            {copied ? (
              <Check size={16} color="var(--color-accent)" />
            ) : (
              <Copy size={14} color="var(--color-text-muted)" />
            )}
          </button>
        )}
      </div>

      <CountdownRing progress={progress} secondsLeft={secondsLeft} />

      <div style={{ position: 'relative', flexShrink: 0 }} ref={menuRef}>
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="More options"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          style={{ background: 'none', border: 'none', padding: 6, cursor: 'pointer', color: 'var(--color-text-muted)' }}
        >
          <MoreVertical size={18} />
        </button>
        {menuOpen ? (
          <div
            role="menu"
            style={{
              position: 'absolute',
              right: 0,
              top: '100%',
              marginTop: 4,
              background: 'var(--color-bg-elevated)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              overflow: 'hidden',
              zIndex: 10,
              minWidth: 140,
              boxShadow: '0 12px 24px rgba(0,0,0,0.4)',
            }}
          >
            <button
              role="menuitem"
              type="button"
              onClick={() => {
                setMenuOpen(false)
                onEdit()
              }}
              style={menuItemStyle}
            >
              Edit
            </button>
            <button
              role="menuitem"
              type="button"
              onClick={() => {
                setMenuOpen(false)
                onShowQr()
              }}
              style={menuItemStyle}
            >
              Show QR code
            </button>
            <button
              role="menuitem"
              type="button"
              onClick={() => {
                setMenuOpen(false)
                onDelete()
              }}
              style={{ ...menuItemStyle, color: 'var(--color-danger)' }}
            >
              Delete
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

const menuItemStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: '10px 14px',
  background: 'none',
  border: 'none',
  fontSize: 14,
  cursor: 'pointer',
  color: 'var(--color-text-primary)',
}
