/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // 'prompt' rather than 'autoUpdate': the app's service worker module
      // deliberately asks before reloading (see src/app/serviceWorker.ts), but
      // 'autoUpdate' bypasses that and swaps the page out on its own — which
      // can yank a half-typed passphrase or a decrypted form away mid-entry.
      registerType: 'prompt',
      includeAssets: ['logo.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'sAuth Authenticator',
        short_name: 'sAuth',
        description: 'Offline-first TOTP authenticator that keeps everything encrypted on your device.',
        theme_color: '#10131a',
        background_color: '#10131a',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache the app shell and fonts for full offline use — this app
        // must keep generating codes with no network at all.
        globPatterns: ['**/*.{js,css,html,woff,woff2,png,svg}'],
        navigateFallbackDenylist: [],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./src/tests/setup.ts'],
  },
})
