import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
// BASE_PATH is set by the GitHub Pages workflow (e.g. /raven-rx/); defaults to / locally.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  define: {
    // Shown in Settings so you can tell which version is running on the phone.
    __APP_VERSION__: JSON.stringify(
      `${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC · ${process.env.GITHUB_SHA?.slice(0, 7) ?? 'local'}`,
    ),
  },
  test: {
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
  },
  plugins: [
    react(),
    VitePWA({
      // 'prompt': a new version waits until you tap Update, so nothing reloads mid-edit.
      registerType: 'prompt',
      includeAssets: ['seed/medications.csv'],
      manifest: {
        name: 'Raven Rx — Pharmacy Registration & Reference',
        short_name: 'Raven Rx',
        description:
          'Personal medication reference and request tracker for pharmacy registration.',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        background_color: '#0b0b0d',
        theme_color: '#0b0b0d',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,csv}'],
      },
    }),
  ],
})
