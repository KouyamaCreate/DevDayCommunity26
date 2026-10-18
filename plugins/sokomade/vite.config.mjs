import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  root: 'ui',
  plugins: [react()],
  build: { outDir: '../dist/web', emptyOutDir: true, assetsInlineLimit: 10000000, cssCodeSplit: false, rollupOptions: { output: { inlineDynamicImports: true } } },
});
