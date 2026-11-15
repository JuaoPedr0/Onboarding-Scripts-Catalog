import { createRequire } from 'node:module'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const require = createRequire(import.meta.url)

// Em `npm run dev`, preenche o bloco #config com o catalog.json local.
// No build de producao quem faz isso e scripts/build-site.js, com a tag
// da release e a URL do webhook.
function configDeDesenvolvimento(): Plugin {
  return {
    name: 'onboarding-config-dev',
    apply: 'serve',
    transformIndexHtml(html) {
      const { montarConfig, injetar } = require('../scripts/site-config.js')
      return injetar(html, montarConfig({ ...process.env, SITE_TAG: 'dev' }, { strict: false }))
    },
  }
}

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), configDeDesenvolvimento()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  // Um unico arquivo JS (React, Radix e Motion somam ~190 kB com gzip).
  build: { outDir: '../dist/site', emptyOutDir: true, chunkSizeWarningLimit: 800 },
})
