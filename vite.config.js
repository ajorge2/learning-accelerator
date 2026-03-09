import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: 'frontend',
  envDir: '..',
  publicDir: '../assets',
  plugins: [tailwindcss()],
  resolve: {
    alias: {
      'algoliasearch': 'algoliasearch/dist/algoliasearch.esm.browser.js',
    },
  },
  server: {
    port: 3000,
    headers: {
    'Cache-Control': 'no-store'
    }
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
});
