import { defineConfig } from 'vite';
import solidPlugin from 'vite-plugin-solid';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    solidPlugin(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      devOptions: {
        enabled: true,
        type: 'module',
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,json,svg,png}'],
        navigateFallback: '/live/index.html',
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/(?:[^/]+\.)?tile\.openstreetmap\.org\//,
            handler: 'CacheFirst',
            options: { cacheName: 'skyforge-map-street', expiration: { maxEntries: 800, maxAgeSeconds: 2592000 } },
          },
          {
            urlPattern: /^https:\/\/server\.arcgisonline\.com\/ArcGIS\/rest\/services\//,
            handler: 'CacheFirst',
            options: { cacheName: 'skyforge-map-satellite', expiration: { maxEntries: 800, maxAgeSeconds: 2592000 } },
          },
          {
            urlPattern: /^https:\/\/(?:[^/]+\.)?basemaps\.cartocdn\.com\//,
            handler: 'CacheFirst',
            options: { cacheName: 'skyforge-map-labels', expiration: { maxEntries: 400, maxAgeSeconds: 2592000 } },
          },
        ],
      },
      manifest: {
        name: 'SkyForge Live Viewer',
        short_name: 'SkyForge Live',
        description: 'Real-time MAVLink telemetry visualization',
        theme_color: '#111217',
        background_color: '#111217',
        display: 'standalone',
        icons: [
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
          },
        ],
      },
    }),
  ],
  base: process.env.GITHUB_ACTIONS ? '/MavDeck/' : '/live/',
  test: {
    environment: 'happy-dom',
    exclude: ['e2e/**', 'node_modules/**'],
  },
});
