#!/usr/bin/env node
// Compila la página de pruebas del mapa (esbuild + react-native-web; mismo alias de react-native-maps que Metro en web).
//   node tools/preview/map/fidelity/build.mjs   → <OUT>/harness.js + harness.html   (OUT = design/out/map/harness por defecto)
// También se importa desde run.mjs (`buildHarness`).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../..');
const MOBILE = path.join(ROOT, 'mobile');
export const OUT = process.env.MVC_MAP_OUT ?? path.join(ROOT, 'design', 'out', 'map', 'harness');
export const HARNESS_HTML = path.join(OUT, 'harness.html');

const FONTS = [
  ['RobotoCondensed_400Regular', '400Regular/RobotoCondensed_400Regular.ttf'],
  ['RobotoCondensed_500Medium', '500Medium/RobotoCondensed_500Medium.ttf'],
  ['RobotoCondensed_700Bold', '700Bold/RobotoCondensed_700Bold.ttf'],
];

export async function buildHarness() {
  const requireFrom = createRequire(path.join(ROOT, 'package.json'));
  const esbuildPath = [path.join(ROOT, 'node_modules', 'esbuild'), path.join(MOBILE, 'node_modules', 'esbuild')].find((p) => fs.existsSync(p));
  if (!esbuildPath) throw new Error('No se encuentra esbuild (npm install en la raíz).');
  const esbuild = requireFrom(esbuildPath);

  fs.mkdirSync(OUT, { recursive: true });
  const fontDir = path.join(MOBILE, 'node_modules', '@expo-google-fonts', 'roboto-condensed');
  for (const [, rel] of FONTS) fs.copyFileSync(path.join(fontDir, rel), path.join(OUT, path.basename(rel)));

  await esbuild.build({
    entryPoints: [path.join(HERE, 'entry.tsx')],
    outfile: path.join(OUT, 'harness.js'),
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'es2020',
    jsx: 'automatic',
    sourcemap: false,
    logLevel: 'warning',
    absWorkingDir: MOBILE,
    nodePaths: [path.join(MOBILE, 'node_modules')],
    alias: {
      'react-native': 'react-native-web',
      'react-native-maps': path.join(MOBILE, 'web-stubs', 'react-native-maps.js'),
    },
    resolveExtensions: ['.web.tsx', '.web.ts', '.web.js', '.tsx', '.ts', '.js', '.mjs', '.json'],
    mainFields: ['browser', 'module', 'main'],
    conditions: ['browser'],
    define: { 'process.env.NODE_ENV': '"development"', __DEV__: 'true', global: 'window' },
    loader: { '.js': 'jsx' },
  });

  const faces = FONTS.map(([family, rel]) => `@font-face{font-family:'${family}';src:url('${path.basename(rel)}') format('truetype');font-display:block}`).join('');
  fs.writeFileSync(
    HARNESS_HTML,
    `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mapa MVC · banco de pruebas</title><style>${faces}html,body{margin:0;padding:0;background:#fff}#root{display:block}</style></head><body><div id="root"></div><script src="harness.js"></script></body></html>`,
  );
  return HARNESS_HTML;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const html = await buildHarness();
  console.log(`harness → ${pathToFileURL(html).href}`);
}
