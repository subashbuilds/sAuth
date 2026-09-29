import { Lock, Plus, Search, Settings as SettingsIcon, ShieldAlert } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { AuthenticatorAccount } from '../../types/account'
import { useVault } from '../../app/vaultHooks'
import { AccountRow } from './AccountRow'
import { Modal } from '../../components/Modal'
import { AddAccountFlow } from './AddAccountFlow'
import { EditAccountForm } from './EditAccountForm'
import { ShowQrModal } from './ShowQrModal'

interface AccountListScreenProps {
  onOpenSettings: () => void
}

function sortAccounts(accounts: AuthenticatorAccount[]): AuthenticatorAccount[] {
  return [...accounts].sort((a, b) => {
    if (a.favorite !== b.favorite) return a.favorite ? -1 : 1
    return a.order - b.order
  })
}

export function AccountListScreen({ onOpenSettings }: AccountListScreenProps) {
  const { accounts, toggleFavorite, removeAccount, lock } = useVault()
  const [query, setQuery] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [editing, setEditing] = useState<AuthenticatorAccount | null>(null)
  const [deleting, setDeleting] = useState<AuthenticatorAccount | null>(null)
  const [showingQr, setShowingQr] = useState<AuthenticatorAccount | null>(null)

  const filtered = useMemo(() => {
    const sorted = sortAccounts(accounts)
    if (!query.trim()) return sorted
    const q = query.trim().toLowerCase()
    return sorted.filter(
      (a) => a.issuer.toLowerCase().includes(q) || a.accountName.toLowerCase().includes(q),
    )
  }, [accounts, query])

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <header
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto 1fr',
          alignItems: 'center',
          padding: 'var(--space-4) var(--space-5)',
          borderBottom: '1px solid var(--color-border)',
        }}
      >
        <button
          type="button"
          onClick={lock}
          aria-label="Lock vault"
          className="btn-ghost"
          style={{ ...iconBtn, justifySelf: 'start' }}
        >
          <Lock size={19} />
        </button>
        <h1
          style={{
            fontSize: 19,
            fontFamily: 'var(--font-wordmark)',
            textTransform: 'uppercase',
            letterSpacing: '0.02em',
            justifySelf: 'center',
          }}
        >
          Authenticator
        </h1>
        <button
          type="button"
          onClick={onOpenSettings}
          aria-label="Settings"
          className="btn-ghost"
          style={{ ...iconBtn, justifySelf: 'end' }}
        >
          <SettingsIcon size={19} />
        </button>
      </header>

      {accounts.length > 0 ? (
        <div style={{ padding: 'var(--space-4) var(--space-5) 0' }}>
          <div style={{ position: 'relative' }}>
            <Search
              size={16}
              color="var(--color-text-muted)"
              style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }}
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search accounts"
              className="text-field"
              style={{ paddingLeft: 36 }}
              aria-label="Search accounts"
            />
          </div>
        </div>
      ) : null}

      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          // Keep the last row clear of the floating add button.
          paddingBottom: accounts.length > 0 ? 'calc(80px + var(--safe-bottom))' : undefined,
        }}
      >
        {accounts.length === 0 ? (
          <EmptyState onAdd={() => setAddOpen(true)} />
        ) : filtered.length === 0 ? (
          <p style={{ textAlign: 'center', color: 'var(--color-text-muted)', padding: 'var(--space-6)' }}>
            No accounts match "{query}".
          </p>
        ) : (
          filtered.map((account) => (
            <AccountRow
              key={account.id}
              account={account}
              onToggleFavorite={() => toggleFavorite(account.id)}
              onEdit={() => setEditing(account)}
              onDelete={() => setDeleting(account)}
              onShowQr={() => setShowingQr(account)}
            />
          ))
        )}
      </div>

      {accounts.length > 0 ? (
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          aria-label="Add account"
          style={{
            position: 'absolute',
            right: 'var(--space-5)',
            bottom: 'calc(var(--space-5) + var(--safe-bottom))',
            width: 56,
            height: 56,
            borderRadius: 'var(--radius-full)',
            background: 'var(--color-accent)',
            color: '#06201d',
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            boxShadow: '0 12px 24px -8px rgba(79, 209, 197, 0.5)',
          }}
        >
          <Plus size={26} />
        </button>
      ) : null}

      {addOpen ? <AddAccountFlow onClose={() => setAddOpen(false)} /> : null}
      {editing ? <EditAccountForm account={editing} onClose={() => setEditing(null)} /> : null}
      {showingQr ? <ShowQrModal account={showingQr} onClose={() => setShowingQr(null)} /> : null}
      {deleting ? (
        <Modal title="Delete account?" onClose={() => setDeleting(null)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <p style={{ color: 'var(--color-text-secondary)', fontSize: 14, lineHeight: 1.5 }}>
              This removes <strong style={{ color: 'var(--color-text-primary)' }}>{deleting.issuer}</strong> (
              {deleting.accountName}) from this device. Make sure you can still generate codes for
              it another way (e.g. re-scan its QR code, or a saved backup) before deleting.
            </p>
            <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
              <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => setDeleting(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                style={{ flex: 1 }}
                onClick={async () => {
                  await removeAccount(deleting.id)
                  setDeleting(null)
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  )
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 'var(--space-4)',
        padding: 'var(--space-8) var(--space-5)',
        textAlign: 'center',
      }}
    >
      <ShieldAlert size={40} color="var(--color-text-muted)" />
      <div>
        <h2 style={{ fontSize: 17, marginBottom: 4 }}>No accounts yet</h2>
        <p style={{ color: 'var(--color-text-secondary)', fontSize: 14 }}>
          Add an account by scanning a QR code, pasting a setup link, or entering a key manually.
        </p>
      </div>
      <button type="button" className="btn btn-primary" onClick={onAdd}>
        <Plus size={18} />
        Add account
      </button>
    </div>
  )
}

const iconBtn = { padding: 8, borderRadius: 'var(--radius-md)', border: 'none' } as const
