import { X } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface ModalProps {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}

export function Modal({ title, onClose, children, footer }: ModalProps) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return createPortal(
    <div
      role="presentation"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(8, 10, 14, 0.6)',
        backdropFilter: 'blur(2px)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        zIndex: 100,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 'var(--app-max-width)',
          maxHeight: 'var(--modal-max-height)',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--color-bg-elevated)',
          borderTopLeftRadius: 'var(--radius-lg)',
          borderTopRightRadius: 'var(--radius-lg)',
          border: '1px solid var(--color-border)',
          borderBottom: 'none',
          animation: 'modal-slide-up 220ms cubic-bezier(0.2,0.8,0.2,1)',
        }}
      >
        <style>{`@keyframes modal-slide-up { from { transform: translateY(16px); opacity: 0.6; } to { transform: translateY(0); opacity: 1; } }`}</style>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: 'var(--space-4) var(--space-5)',
            borderBottom: '1px solid var(--color-border)',
          }}
        >
          <h2 style={{ fontSize: 18 }}>{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="btn-ghost"
            style={{ padding: 6, borderRadius: 'var(--radius-full)', border: 'none' }}
          >
            <X size={20} />
          </button>
        </div>
        <div
          style={{
            padding: 'var(--space-5)',
            // The sheet sits flush against the bottom of the screen, so it has
            // to pad itself clear of the home indicator / system bar.
            paddingBottom: 'calc(var(--space-5) + var(--safe-bottom))',
            overflowY: 'auto',
          }}
        >
          {children}
        </div>
        {footer ? (
          <div
            style={{
              padding: 'var(--space-4) var(--space-5)',
              borderTop: '1px solid var(--color-border)',
            }}
          >
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  )
}
