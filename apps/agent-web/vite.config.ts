import { defineConfig } from 'vite';

export default defineConfig({
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    process: JSON.stringify({ env: { NODE_ENV: 'production' } }),
  },
  build: {
    lib: {
      entry: 'src/index.ts',
      formats: ['es'],
      fileName: () => 'agent-tab.js',
    },
    outDir: 'dist',
    emptyOutDir: true,
    cssCodeSplit: true,
    sourcemap: true,
  },
});
