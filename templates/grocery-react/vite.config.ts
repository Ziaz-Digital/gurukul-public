import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `npm run dev` serves index.html (the dev page, never bundled).
// `npm run build` builds ONLY src/gk-project.tsx, the bundle's entry, into dist/bundle.
export default defineConfig({
  plugins: [react()],
  // Only SHOP_* variables reach the dev page (from .env.local); the bundle reads none.
  envPrefix: 'SHOP_',
  // Asset URLs relative to the bundle's own folder (/b/<project>/<version>/ on the host).
  base: './',
  server: { port: 5173, strictPort: false },
  build: {
    outDir: 'dist/bundle',
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    // CSS is imported with ?inline into the shadow root, never as a global stylesheet.
    cssCodeSplit: false,
    rollupOptions: {
      input: 'src/gk-project.tsx',
      preserveEntrySignatures: 'exports-only',
      output: {
        format: 'es',
        entryFileNames: 'gk-project-[hash].js',
        chunkFileNames: 'chunk-[hash].js',
        assetFileNames: 'asset-[hash][extname]',
      },
    },
  },
});
