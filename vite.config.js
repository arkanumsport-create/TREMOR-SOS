import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['radar-icon.svg', 'app-icon-original.jpg'],
      manifest: {
        name: 'TREMOR SOS — Seismic Monitor',
        short_name: 'TREMOR SOS',
        description: 'Cross-platform mobile seismic & tsunami monitor with real-time geolocation alerts (PWA & Telegram Mini App)',
        theme_color: '#0c1719',
        background_color: '#0c1719',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          {
            src: 'radar-icon.svg',
            sizes: '192x192 512x512',
            type: 'image/svg+xml',
            purpose: 'any maskable'
          },
          {
            src: 'app-icon-original.jpg',
            sizes: '512x512',
            type: 'image/jpeg',
            purpose: 'any'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,jpg,png,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/earthquake\.usgs\.gov\/earthquakes\/feed\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'usgs-earthquake-data',
              expiration: {
                maxEntries: 30,
                maxAgeSeconds: 60 * 60 * 24
              }
            }
          }
        ]
      }
    })
  ],
  server: {
    port: 5173,
    host: true
  }
});
