import { BookOpen, Star } from 'lucide-react'
import type { ReactNode } from 'react'
import { Logo } from '../../components/Logo'
import { GITHUB_REPO_URL } from '../../app/links'

interface GateLayoutProps {
  tagline: string
  children: ReactNode
  onOpenDocs: () => void
}

/**
 * Common shell for the two screens shown before the account list: the
 * first-run "create a vault" screen and the "enter your passphrase to
 * unlock" screen. Both share the same brand header and footer links so
 * the app's single logo and wordmark appear consistently, rather than
 * each screen inventing its own icon.
 */
export function GateLayout({ tagline, children, onOpenDocs }: GateLayoutProps) {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        padding: 'var(--space-6) var(--space-5) calc(var(--space-5) + var(--safe-bottom))',
        gap: 'var(--space-6)',
        overflowY: 'auto',
      }}
    >
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: 'var(--space-6)',
        }}
      >
        <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', alignItems: 'center' }}>
          <Logo size={72} />
          <h1
            style={{
              fontFamily: 'var(--font-wordmark)',
              fontSize: 28,
              letterSpacing: '0.02em',
              textTransform: 'uppercase',
            }}
          >
            sAuth Authenticator
          </h1>
          <p style={{ color: 'var(--color-text-secondary)', fontSize: 15, lineHeight: 1.5, maxWidth: 320 }}>
            {tagline}
          </p>
        </div>

        {children}
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          gap: 'var(--space-5)',
          paddingTop: 'var(--space-4)',
          borderTop: '1px solid var(--color-border)',
        }}
      >
        <a
          href={GITHUB_REPO_URL}
          target="_blank"
          rel="noreferrer"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 13,
            color: 'var(--color-text-secondary)',
            textDecoration: 'none',
          }}
        >
          <Star size={16} />
          Star on GitHub
        </a>
        <button
          type="button"
          onClick={onOpenDocs}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 13,
            color: 'var(--color-text-secondary)',
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
          }}
        >
          <BookOpen size={16} />
          Documentation
        </button>
      </div>
    </div>
  )
}
