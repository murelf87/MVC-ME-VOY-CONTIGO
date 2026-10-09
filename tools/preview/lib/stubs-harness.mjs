// Arnés de los sustitutos web: un HTML mínimo con el shell REAL (tools/preview/shell/inner.js) y todos los módulos de
// mobile/web-stubs/* empaquetados con esbuild, sin la app. Lo usa el flujo «stubs» para ejecutar de verdad la API de cada
// sustituto (permisos, GPS, avisos, cámara, galería, almacenamiento seguro, red…) y comprobar que contestan con la forma
// de los módulos de Expo. Escribe dist-preview/stubs-harness.html (ignorado por git con el resto de dist-preview).
//
// esbuild viene con tsx (node_modules de la raíz). Si no está, la función lo dice y el flujo se salta con el motivo.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { DIST, ROOT, TOOLS_PREVIEW } from './pw.mjs';
import { readWebStubMap } from './web-stubs.mjs';

const MOBILE = path.join(ROOT, 'mobile');
export const HARNESS_FILE = path.join(DIST, 'stubs-harness.html');

function loadEsbuild() {
  for (const base of [ROOT, MOBILE, TOOLS_PREVIEW]) {
    try {
      return createRequire(path.join(base, 'package.json'))('esbuild');
    } catch {
      // siguiente candidato
    }
  }
  return null;
}

const inlineSafe = (js) => js.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');

// Lo que decide el visor en la app real, aquí por la URL: ?perm=ask|granted|denied|blocked  ?gps=good|weak|off  ?network=wifi|cellular|none
const BOOT = `(function () {
  var q = new URLSearchParams(location.search);
  var g = function (k, d) { var v = q.get(k); return v === null || v === '' ? d : v; };
  window.__MVC_PREVIEW_BOOT__ = {
    standalone: true, profile: 'passenger', seed: null, clock: null, perm: g('perm', 'ask'), auto: true,
    device: { id: 'iphone15', label: 'iPhone 15', platform: g('platform', 'ios'), width: 393, height: 852, safeTop: 59, safeBottom: 34, safeLeft: 0, safeRight: 0, cornerRadius: 55, chrome: false },
    sim: { network: g('network', 'wifi'), gps: g('gps', 'good'), place: { id: 'plazanueva', label: 'Plaza Nueva (Sevilla)', latitude: 37.3886, longitude: -5.9953 }, clock: null, statusTime: '09:41', screenReader: false },
    permissions: {}, chrome: false
  };
})();`;

/** Empaqueta el arnés. Devuelve { file, bytes, modules } o { skipped: motivo } si no se puede (sin esbuild). */
export async function buildStubsHarness() {
  const esbuild = loadEsbuild();
  if (!esbuild) return { skipped: 'esbuild no está instalado (viene con tsx en node_modules de la raíz del repositorio)' };
  const stubs = readWebStubMap(MOBILE);
  const result = await esbuild.build({
    entryPoints: [path.join(TOOLS_PREVIEW, 'lib', 'stubs-entry.js')],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    logLevel: 'silent',
    nodePaths: [path.join(MOBILE, 'node_modules')], // react, react-dom para la entrada (los sustitutos los resuelven desde mobile/)
    alias: { 'react-native': 'react-native-web' }, // igual que Expo en web
    define: { 'process.env.NODE_ENV': '"production"', __DEV__: 'false' },
    plugins: [
      {
        name: 'web-stubs',
        setup(build) {
          build.onResolve({ filter: /^[^./]/ }, (args) => (Object.prototype.hasOwnProperty.call(stubs, args.path) ? { path: path.join(MOBILE, 'web-stubs', stubs[args.path]) } : undefined));
        },
      },
    ],
  });
  const bundle = result.outputFiles[0].text;
  const inner = fs.readFileSync(path.join(TOOLS_PREVIEW, 'shell', 'inner.js'), 'utf8');
  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Arnés de los sustitutos web</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src data: blob:">
</head><body><div id="root"></div>
<script>${inlineSafe(BOOT)}</script>
<script id="mvc-inner">${inlineSafe(inner)}</script>
<script>${inlineSafe(bundle)}</script>
</body></html>
`;
  fs.mkdirSync(DIST, { recursive: true });
  fs.writeFileSync(HARNESS_FILE, html);
  return { file: HARNESS_FILE, bytes: Buffer.byteLength(html), modules: Object.keys(stubs).length };
}
