import { defineConfig } from 'vite';

export default defineConfig({
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
