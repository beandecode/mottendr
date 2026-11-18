import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createOfflineWorker } from './offline-worker.mjs';
const root = new URL('../', import.meta.url);
// The output directory is `dist` (the full build) or `dist-demo/app` (pnpm build:demo).
const out = process.argv[2] ?? 'dist';
const path = (name) => new URL(name.replace(/^dist\//, out + '/'), root);
const html = await readFile(path('dist/index.html'), 'utf8');
let installedHTML = html;
for (const match of [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g)]) {
  const js = await readFile(
    path('dist/' + match[1].replace(/^\.\//, '').replace(/^\//, '')),
    'utf8',
  );
  installedHTML = installedHTML.replace(
    match[0],
    () => '<script type="module">' + js.replaceAll('</script', '<\\/script') + '</script>',
  );
}
for (const match of [
  ...html.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"[^>]*>/g),
]) {
  const css = await readFile(
    path('dist/' + match[1].replace(/^\.\//, '').replace(/^\//, '')),
    'utf8',
  );
  installedHTML = installedHTML.replace(match[0], () => '<style>' + css + '</style>');
}
// Keep PWA metadata, but bundle startup code/styles in the cached document too.
// This avoids a blank offline startup when a WebKit surface restores the document
// without satisfying its separate module/style requests from the worker cache.
installedHTML = installedHTML.replace(/<link\b[^>]*\brel="modulepreload"[^>]*>/g, '');
await writeFile(path('dist/index.html'), installedHTML);
// The content files (word pack, dictionary, legacy-upgrade data) are fetched at runtime;
// precache them so the installed app works offline.
const content = (await readdir(path('dist/content/'))).filter((name) => name.endsWith('.json'));
const files = [
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
  ...content.map((name) => './content/' + name),
];
const cache =
  'francais-' +
  createHash('sha256').update(installedHTML).update(files.join('\n')).digest('hex').slice(0, 12);
await writeFile(path('dist/sw.js'), createOfflineWorker(cache, files));
console.log(`Packaged ${out}/index.html and ${out}/sw.js (${files.length} precached files)`);
