import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { copyFileSync } from 'fs';

function copyExtensionFiles() {
  return {
    name: 'copy-extension-files',
    closeBundle() {
      copyFileSync(
        resolve(__dirname, 'manifest.json'),
        resolve(__dirname, 'dist/manifest.json'),
      );
      const htmlFiles: Array<[string, string]> = [
        ['dist/src/popup/popup.html', 'dist/popup.html'],
        ['dist/src/sidepanel/sidepanel.html', 'dist/sidepanel.html'],
      ];

      for (const [from, to] of htmlFiles) {
        try {
          copyFileSync(resolve(__dirname, from), resolve(__dirname, to));
        } catch {
          // Vite may already emit the file at the root.
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), copyExtensionFiles()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'src/popup/popup.html'),
        sidepanel: resolve(__dirname, 'src/sidepanel/sidepanel.html'),
        background: resolve(__dirname, 'src/background/background.ts'),
        content: resolve(__dirname, 'src/content/content.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name].[ext]',
      },
    },
  },
  publicDir: 'public',
});
