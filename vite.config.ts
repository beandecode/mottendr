import { createHash } from 'node:crypto';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { contentFiles } from './src/content/build';

// MOTTENDR_DEMO=1 (pnpm build:demo) builds the public demo: a cut of the first release (src/content/demo-content.ts)
// into dist-demo/app/ (the project page sits at dist-demo/, scripts/build-intro.mjs). The full build into dist/ (local checks) carries the first release, like the native app.
const demo = true;

// Emits the word pack, dictionary and legacy-upgrade data as content-hashed JSON files
// (content/<name>.<hash>.json) and tells the app their names via __CONTENT_FILES__.
function content(): Plugin {
  const files = Object.entries(contentFiles()).map(
    ([name, data]) => {
      const source = JSON.stringify(data);
      const hash = createHash('sha256').update(source).digest('hex').slice(0, 12);
      return { name, fileName: `content/${name}.${hash}.json`, source };
    },
  );
  return {
    name: 'francais-content',
    config: () => ({
      define: {
        __CONTENT_FILES__: JSON.stringify(
          Object.fromEntries(files.map((f) => [f.name, f.fileName])),
        ),
      },
    }),
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split('?')[0] ?? '';
        const file = files.find((f) => path.endsWith('/' + f.fileName));
        if (!file) return next();
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(file.source);
      });
    },
    generateBundle() {
      for (const f of files)
        this.emitFile({ type: 'asset', fileName: f.fileName, source: f.source });
    },
  };
}

export default defineConfig({
  base: './',
  define: { __DEMO__: JSON.stringify(demo) },
  plugins: [react(), content()],
  build: {
    outDir: 'dist',
    cssCodeSplit: false,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
  optimizeDeps: { entries: ['index.html'] },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
});
