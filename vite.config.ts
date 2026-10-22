import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import path from 'path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const buildId = process.env.INTERVIEWDOG_BUILD_ID || new Date().toISOString().replace(/[:.]/g,'-') + '-' + crypto.randomBytes(3).toString('hex');
const buildDefines = {__INTERVIEW_BUILD_ID__: JSON.stringify(buildId)};
export default defineConfig({
  define: buildDefines,
  plugins: [{name:'build-identity',closeBundle(){fs.mkdirSync(path.join(__dirname,'dist'),{recursive:true});fs.writeFileSync(path.join(__dirname,'dist/build-info.json'),JSON.stringify({buildId,ipcVersion:2}));}},
    react(),
    electron([
      {
        entry: path.resolve(__dirname, 'src/main/index.ts'),
        // root is src/renderer; launch Electron from the project root.
        onstart({startup}) { startup(['.', '--no-sandbox'], {cwd: __dirname}); },
        vite: {
          define: buildDefines,
          build: {
            outDir: path.resolve(__dirname, 'dist/main'),
            rollupOptions: {
              external: ['better-sqlite3', 'electron', 'pdf-parse', 'mammoth']
            }
          }
        }
      },
      {
        entry: path.resolve(__dirname, 'src/preload/index.ts'),
        // root is src/renderer; launch Electron from the project root.
        onstart({startup}) { startup(['.', '--no-sandbox'], {cwd: __dirname}); },
        vite: {
          define: buildDefines,
          build: {
            outDir: path.resolve(__dirname, 'dist/preload'),
            rollupOptions: {
              external: ['electron']
            }
          }
        }
      }
    ]),
    renderer()
  ],
  root: 'src/renderer',
  build: {
    outDir: path.resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  }
});
