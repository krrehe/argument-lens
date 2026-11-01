import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': r('./src/shared'),
      },
    },
    build: {
      rollupOptions: {
        input: { index: r('./src/main/index.ts') },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': r('./src/shared'),
      },
    },
    build: {
      rollupOptions: {
        input: { index: r('./src/preload/index.ts') },
      },
    },
  },
  renderer: {
    root: r('./src/renderer'),
    resolve: {
      alias: {
        '@shared': r('./src/shared'),
        '@': r('./src/renderer/src'),
      },
    },
    build: {
      rollupOptions: {
        input: { index: r('./src/renderer/index.html') },
      },
    },
    plugins: [react()],
  },
});
