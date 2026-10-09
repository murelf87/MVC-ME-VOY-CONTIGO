#!/usr/bin/env node
// VISTA PREVIA DE MVC EN UN SOLO HTML (no es la distribución de la app: iOS/Android usan builds nativas).
//
//   npm --prefix mobile run preview:artifact          (= node tools/preview/build-artifact.mjs)
//
// 1. Exporta la app REAL para web con la nube apagada: EXPO_PUBLIC_PREVIEW=1 (el backend en memoria de src/preview atiende en
//    el navegador todas las peticiones a la API). Build hermética: se borran del entorno todas las EXPO_*, no se lee ningún .env,
//    Metro usa una caché privada (dist-preview/.tmp) y un solo bundle (sin fragmentos que un HTML suelto no podría servir).
// 2. Monta, con TODO dentro (bundle, imágenes, fuentes, iconos → data: URI; cero peticiones):
//      dist-preview/mvc-app.html      la app sola (modo «suelto»: se configura con ?profile=…&device=…&perm=…)
//      dist-preview/mvc-preview.html  el visor (marco del móvil + panel + capa del sistema) con la app comprimida dentro
//      dist-preview/build-report.json lo que se ha incluido, con tamaños
//    Y avisa si mobile/web-stubs/* no exporta algún nombre que mobile/src importa de un módulo de Expo sustituido.
//
// Opciones: --skip-export  reutiliza dist-preview/web (solo vuelve a montar los HTML)
//           --clean        borra también la caché de Metro (primera build lenta)
//           --no-lock      no pide /tmp/mvc-heavy.lock (solo si ya lo tienes)
//           --no-thumbs    no incluye las miniaturas de los diseños (necesita Python + Pillow)
//           --keep-web     no borra dist-preview/web antes de exportar
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { ensureHeavyLock } from './lib/heavy.mjs';
import { checkStubCoverage } from './lib/web-stubs.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const MOBILE = path.join(ROOT, 'mobile');
const DIST = path.join(ROOT, 'dist-preview');
const WEB_DIR = path.join(DIST, 'web');
const TMP_DIR = path.join(DIST, '.tmp');
const SHELL_DIR = path.join(HERE, 'shell');
const OUT_APP = path.join(DIST, 'mvc-app.html');
const OUT_VIEWER = path.join(DIST, 'mvc-preview.html');
const OUT_REPORT = path.join(DIST, 'build-report.json');
const LIMIT_BYTES = 16 * 1024 * 1024;
const WARN_BYTES = 12 * 1024 * 1024;
const MAX_INLINE_ASSET = 1.5 * 1024 * 1024; // Chrome rechaza URLs de más de 2 MB: un data: URI de 1,5 MB (2,0 MB en base64) es el máximo seguro

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const SKIP_EXPORT = has('--skip-export');
const CLEAN = has('--clean');
const NO_THUMBS = has('--no-thumbs');
const KEEP_WEB = has('--keep-web');

const rel = (p) => path.relative(ROOT, p) || '.';
const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;
const fail = (msg) => {
  console.error(`\n✖ ${msg}`);
  process.exit(1);
};
const warnings = [];
const warn = (msg) => {
  warnings.push(msg);
  console.warn(`  ⚠ ${msg}`);
};

ensureHeavyLock('exportación web y montaje de la vista previa');

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.json': 'application/json',
  '.txt': 'text/plain',
};
const FONT_EXT = new Set(['.ttf', '.otf', '.woff', '.woff2']);
const mimeOf = (file) => MIME[path.extname(file.split('?')[0]).toLowerCase()] ?? 'application/octet-stream';
const dataUri = (file) => `data:${mimeOf(file)};base64,${fs.readFileSync(file).toString('base64')}`;
const read = (file) => fs.readFileSync(file, 'utf8');

// ───────────────────────────── 1. Export web de la app con la nube apagada ─────────────────────────────

/** Extrae de la salida de Metro los ficheros/imports que impiden compilar (para informar sin tocarlos). */
function brokenSourceFiles(output) {
  const found = new Map(); // fichero → primer mensaje
  const add = (file, msg) => {
    const rel0 = path.relative(ROOT, path.resolve(MOBILE, file));
    if (!found.has(rel0)) found.set(rel0, msg);
  };
  const clean = output.replace(/\x1b\[[0-9;]*m/g, '');
  const unresolved = /Unable to resolve (?:module )?["']?([^\s"']+)["']? from ["']?([^\s"':]+)["']?/g;
  for (let m; (m = unresolved.exec(clean)); ) add(m[2], `no existe el módulo «${m[1]}»`);
  const syntax = /(?:SyntaxError|TransformError)[^\n]*?(\/[^\s:]+\.(?:t|j)sx?)[^\n]*/g;
  for (let m; (m = syntax.exec(clean)); ) add(m[1], m[0].replace(/\s+/g, ' ').slice(0, 200));
  const generic = /^(?:\s*)(?:Error|error)[^\n]*?(\/[^\s:]+\.(?:t|j)sx?)[^\n]*$/gm;
  for (let m; (m = generic.exec(clean)); ) add(m[1], m[0].trim().replace(/\s+/g, ' ').slice(0, 200));
  return [...found].map(([f, msg]) => `${f}: ${msg}`).slice(0, 30);
}

function exportWeb() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith('EXPO_')) continue; // hermética: ninguna variable ajena puede colar una URL, una clave o un modo
    env[k] = v;
  }
  Object.assign(env, {
    EXPO_PUBLIC_PREVIEW: '1',
    EXPO_NO_DOTENV: '1',
    EXPO_NO_TELEMETRY: '1',
    EXPO_NO_BUNDLE_SPLITTING: '1',
    EXPO_OFFLINE: '1',
    CI: '1',
    TMPDIR: TMP_DIR, // Metro guarda su caché en os.tmpdir()/metro-cache: privada para no mezclar builds con otros entornos
    NODE_OPTIONS: [env.NODE_OPTIONS, '--max-old-space-size=3072'].filter(Boolean).join(' '),
  });
  fs.mkdirSync(TMP_DIR, { recursive: true });
  if (CLEAN) fs.rmSync(path.join(TMP_DIR, 'metro-cache'), { recursive: true, force: true });
  if (!KEEP_WEB) fs.rmSync(WEB_DIR, { recursive: true, force: true });
  const bin = path.join(MOBILE, 'node_modules/.bin/expo');
  if (!fs.existsSync(bin)) fail('Falta mobile/node_modules/.bin/expo: ejecuta «pnpm install» en mobile/ (o pide al orquestador que lo haga).');
  console.log(`› Exportando la app para web (EXPO_PUBLIC_PREVIEW=1, un solo bundle, nube apagada)…`);
  const t0 = Date.now();
  const args = ['export', '--platform', 'web', '--output-dir', path.relative(MOBILE, WEB_DIR), '--max-workers', '2'];
  if (CLEAN) args.push('--clear');
  const r = spawnSync(bin, args, { cwd: MOBILE, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  process.stdout.write(r.stdout || '');
  process.stderr.write(r.stderr || '');
  if (r.status !== 0) {
    const broken = brokenSourceFiles(`${r.stdout || ''}\n${r.stderr || ''}`);
    console.error('\n✖ «expo export» ha fallado' + (r.status === null ? ` (señal ${r.signal})` : ` (código ${r.status})`) + '. Esto NO es un fallo de la vista previa: el árbol de la app no compila ahora mismo.');
    if (broken.length) {
      console.error('  Ficheros o imports rotos que Metro ha encontrado (se informa al responsable del slice; este script no los toca):');
      for (const b of broken) console.error(`   · ${b}`);
    } else {
      console.error('  No he podido extraer el fichero concreto del mensaje de Metro: léelo arriba.');
    }
    try {
      fs.mkdirSync(DIST, { recursive: true });
      fs.writeFileSync(OUT_REPORT, JSON.stringify({ at: new Date().toISOString(), exportFailed: true, exitCode: r.status, broken }, null, 2) + '\n');
    } catch {
      // sin informe
    }
    process.exit(3);
  }
  console.log(`  export completado en ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

// ───────────────────────────── 2. Utilidades de ficheros ─────────────────────────────
function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? listFiles(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

/** "/_expo/static/js/web/index-abc.js?x" → ruta absoluta dentro de dist-preview/web. */
function webFile(urlPath) {
  const clean = decodeURIComponent(urlPath.replace(/^[a-z]+:\/\/[^/]+/i, '').split(/[?#]/)[0]).replace(/^\/+/, '');
  const abs = path.resolve(WEB_DIR, clean);
  if (!abs.startsWith(WEB_DIR + path.sep)) fail(`Ruta fuera del export: ${urlPath}`);
  return abs;
}

// ───────────────────────────── 3. Qué fuentes usa realmente la app ─────────────────────────────
function sourceFiles() {
  return listFiles(path.join(MOBILE, 'src'))
    .concat([path.join(MOBILE, 'App.tsx'), path.join(MOBILE, 'index.ts')])
    .filter((f) => /\.(t|j)sx?$/.test(f) && !/\.test\.(t|j)sx?$/.test(f) && fs.existsSync(f));
}

/** Juegos de @expo/vector-icons que importa el código → ficheros de fuente (el resto de juegos NO se incluyen). */
function usedIconFontFiles() {
  const sets = new Set();
  for (const f of sourceFiles()) {
    const text = read(f);
    for (const m of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]@expo\/vector-icons['"]/g)) {
      m[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0]?.trim()).filter(Boolean).forEach((s) => sets.add(s));
    }
    for (const m of text.matchAll(/from\s*['"]@expo\/vector-icons\/(\w+)['"]/g)) sets.add(m[1]);
    for (const m of text.matchAll(/require\(\s*['"]@expo\/vector-icons\/(\w+)['"]\s*\)/g)) sets.add(m[1]);
  }
  ['createIconSet', 'createIconSetFromIcoMoon', 'createIconSetFromFontello', 'createMultiStyleIconSet'].forEach((n) => sets.delete(n));
  const buildDir = path.join(MOBILE, 'node_modules/@expo/vector-icons/build');
  const used = new Map(); // nombre de fichero base (sin extensión) → juego
  for (const set of [...sets].sort()) {
    const srcFile = path.join(buildDir, `${set}.js`);
    if (!fs.existsSync(srcFile)) continue;
    const fontRel = [...read(srcFile).matchAll(/import\s+\w+\s+from\s+'([^']+\.(?:ttf|otf))'/g)].map((m) => m[1]);
    for (const fr of fontRel) used.set(path.basename(fr, path.extname(fr)), set);
  }
  return { sets: [...sets].sort(), files: used };
}

const assetReport = new Map();
let usedIcons = { sets: [], files: new Map() };

/** ¿Esta fuente debe ir dentro del HTML? Las de @expo/vector-icons solo si el juego se importa; el resto, siempre. */
function fontIsUsed(urlPath) {
  if (!/\/@expo\/vector-icons\//.test(urlPath)) return true;
  const base = path.basename(urlPath).replace(/\.[0-9a-f]{16,}\.(ttf|otf)$/i, '').replace(/\.(ttf|otf)$/i, '');
  return usedIcons.files.has(base);
}

/** Sustituye cada referencia "/assets/…" del código por un data: URI. */
function inlineAssets(code) {
  return code.replace(/(["'`])(\/assets\/[^"'`\s\\${}]+?)\1/g, (match, quote, urlPath) => {
    const file = webFile(urlPath);
    const ext = path.extname(file.split('?')[0]).toLowerCase();
    if (!fs.existsSync(file)) {
      assetReport.set(urlPath, { status: 'NO ENCONTRADO', bytes: 0 });
      return match;
    }
    const bytes = fs.statSync(file).size;
    if (FONT_EXT.has(ext) && !fontIsUsed(urlPath)) {
      assetReport.set(urlPath, { status: 'fuente de iconos sin usar (no se incluye)', bytes });
      return match;
    }
    if (bytes > MAX_INLINE_ASSET) {
      assetReport.set(urlPath, { status: 'DEMASIADO GRANDE (no se incluye)', bytes });
      return match;
    }
    assetReport.set(urlPath, { status: FONT_EXT.has(ext) ? 'fuente en línea (data: URI)' : 'en línea (data: URI)', bytes });
    return `${quote}${dataUri(file)}${quote}`;
  });
}

// Librerías que descargarían código de un CDN al arrancar. En la vista previa no hay red: se neutralizan y se avisa del resto.
const CDN_DOWNLOADS = [
  {
    name: 'expo-camera · jsQR (cdn.jsdelivr.net)',
    re: /\[\s*(['"`])https:\/\/cdn\.jsdelivr\.net\/npm\/jsqr@[^'"`]+\1\s*\]/g,
    replacement: '[]',
  },
];
const cdnReport = new Map();
function neutralizeCdnDownloads(code) {
  let out = code;
  for (const c of CDN_DOWNLOADS) {
    out = out.replace(c.re, () => {
      cdnReport.set(c.name, (cdnReport.get(c.name) ?? 0) + 1);
      return c.replacement;
    });
  }
  return out;
}
const REMOTE_CODE_RE = /(['"`])(https?:\/\/(?:cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com|esm\.sh|cdn\.skypack\.dev|ga\.jspm\.io|fonts\.googleapis\.com|fonts\.gstatic\.com)\/[^'"`\s]*)\1/g;

/** El código va dentro de <script>: nada puede cerrar la etiqueta ni abrir comentarios HTML (\x3C = «<» en JS). */
function escapeInlineScript(code) {
  const out = code
    .replace(/<\/(script)/gi, '\\x3C/$1')
    .replace(/<!--/g, '\\x3C!--')
    .replace(/\u0000/g, '\\x00')
    .replace(/\n\/\/# sourceMappingURL=[^\n]*\s*$/, '\n');
  if (/<\/script/i.test(out) || out.includes('<!--')) fail('No se ha podido escapar el código para meterlo en <script>.');
  return out;
}

// Política de contenido del documento de la app y del visor: sin hosts externos, solo data:/blob: (hermeticidad comprobable).
const CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  'media-src data: blob:',
  'connect-src data: blob:',
  'worker-src blob:',
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');
const CSP_VIEWER = `${CSP}; frame-src about: data: blob:`;

// ───────────────────────────── 4. Documento de la app («inner») ─────────────────────────────
function buildInnerDoc() {
  const indexFile = path.join(WEB_DIR, 'index.html');
  if (!fs.existsSync(indexFile)) fail(`No existe ${rel(indexFile)}: ejecuta el export (sin --skip-export).`);
  const indexHtml = read(indexFile);

  const mainUrls = [...indexHtml.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>\s*<\/script>/gi)].map((m) => m[1]);
  if (!mainUrls.length) fail('El index.html exportado no carga ningún bundle.');
  const mainFiles = mainUrls.map(webFile);
  mainFiles.forEach((f) => fs.existsSync(f) || fail(`Falta el bundle ${rel(f)}`));
  const extraJs = listFiles(path.join(WEB_DIR, '_expo')).filter((f) => f.endsWith('.js') && !mainFiles.includes(f));
  if (extraJs.length) {
    fail(`Metro ha troceado el bundle (${extraJs.length} fragmentos: ${extraJs.map(rel).slice(0, 3).join(', ')}…). La vista previa necesita un bundle único: EXPO_NO_BUNDLE_SPLITTING=1 lo evita, así que algún import() dinámico de la app lo está forzando. Sustitúyelo por un import estático.`);
  }
  const cssFiles = [...indexHtml.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*>/gi)]
    .map((m) => /\bhref="([^"]+)"/.exec(m[0])?.[1])
    .filter(Boolean)
    .map(webFile);
  const expoReset = /<style id="expo-reset">([\s\S]*?)<\/style>/.exec(indexHtml)?.[1] ?? 'html,body{height:100%}body{overflow:hidden}#root{display:flex;height:100%;flex:1}';

  usedIcons = usedIconFontFiles();
  const mainTexts = mainFiles.map((f) => read(f));
  const prepare = (code) => escapeInlineScript(inlineAssets(neutralizeCdnDownloads(code)));
  const mainScripts = mainTexts.map((t, i) => `<script id="mvc-app-${i}">${prepare(t)}</script>`);

  const cssHtml = cssFiles
    .map((f) => {
      const css = read(f).replace(/url\((['"]?)(\/assets\/[^'")]+)\1\)/g, (m, q, u) => {
        const file = webFile(u);
        return fs.existsSync(file) && fs.statSync(file).size <= MAX_INLINE_ASSET ? `url(${dataUri(file)})` : m;
      });
      return `<style>${css.replace(/<\/(style)/gi, '<\\/$1')}</style>`;
    })
    .join('\n');

  const inner = escapeInlineScript(read(path.join(SHELL_DIR, 'inner.js')));
  const favicon = faviconTag();
  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<title>MVC · Me voy contigo</title>
<meta name="color-scheme" content="light only">
${favicon}<style id="expo-reset">${expoReset}</style>
<style id="mvc-inner-base">html{-webkit-text-size-adjust:100%;-webkit-tap-highlight-color:transparent}body{margin:0;background:#fff;overscroll-behavior:none}</style>
<!--MVC_BOOT-->
<script id="mvc-inner">${inner}</script>
${cssHtml}</head>
<body>
<noscript>MVC necesita JavaScript para funcionar.</noscript>
<div id="root"></div>
${mainScripts.join('\n')}
</body>
</html>
`;
  const missing = [...assetReport.entries()].filter(([, v]) => v.status === 'NO ENCONTRADO');
  if (missing.length) warn(`Recursos citados por el bundle que no están en el export: ${missing.map(([k]) => k).join(', ')}`);
  const remoteCode = [...new Set([...html.matchAll(REMOTE_CODE_RE)].map((m) => m[2]))];
  if (remoteCode.length) warn(`El bundle sigue citando código/fuentes en un CDN (la CSP lo bloquearía): ${remoteCode.slice(0, 5).join(', ')}`);
  const leftovers = [...new Set([...html.matchAll(/["'`(](\/_expo\/[^"'`)\s]+)/g)].map((m) => m[1]))];
  if (leftovers.length) warn(`Referencias a /_expo/ que siguen en el HTML: ${leftovers.slice(0, 5).join(', ')}`);
  return { html, mainFiles, mainBytes: mainFiles.reduce((n, f) => n + fs.statSync(f).size, 0) };
}

function faviconTag() {
  const png = path.join(MOBILE, 'assets/brand/favicon.png');
  if (fs.existsSync(png) && fs.statSync(png).size < 60 * 1024) return `<link rel="icon" type="image/png" href="${dataUri(png)}">\n`;
  const svg = path.join(ROOT, 'design/logo/mvc-icon.svg');
  if (fs.existsSync(svg)) return `<link rel="icon" type="image/svg+xml" href="${dataUri(svg)}">\n`;
  return '';
}

// ───────────────────────────── 5. Datos de diseño para el panel del visor ─────────────────────────────
const SCREEN_NAMES = {
  '01': ['Welcome', 'Bienvenida'], '02': ['ChooseRole', 'Elige cómo usar MVC'], '03': ['CreateAccount', 'Crear cuenta'], '04': ['VerifyPhone', 'Verificar teléfono'],
  '05': ['ProfilePhoto', 'Foto de perfil'], '06': ['PrivateCheckCapture', 'Comprobación privada · captura'], '07': ['PrivateCheckPrivacy', 'Comprobación privada · privacidad'], '08': ['PrivateCheckStatus', 'Comprobación privada · estado'],
  '09': ['MapHome', 'Mapa (inicio)'], '10': ['DefineRoute', 'Definir ruta'], '11': ['TripResults', 'Resultados de viajes'], '12': ['TripDetail', 'Detalle del viaje'],
  '13': ['PickupPoint', 'Punto de recogida'], '14': ['WeeklySeat', 'Plaza semanal'], '15': ['ReviewRequest', 'Revisar solicitud'], '16': ['RequestStatusPayment', 'Estado de la solicitud y pago'],
  '17': ['MyVehicle', 'Mi vehículo'], '18': ['PublishRoute', 'Publicar ruta'], '19': ['StopsRoute', 'Paradas de la ruta'], '20': ['DriverRequests', 'Solicitudes (conductor)'],
  '21': ['WaitingForCar', 'Esperando al coche'], '22': ['RouteChange', 'Cambio de ruta'], '23': ['InCar', 'En el coche'], '24': ['TripFinished', 'Viaje terminado'],
  '25': ['Inbox', 'Mensajes'], '26': ['BookingChat', 'Chat de la reserva'], '27': ['Notifications', 'Notificaciones'], '28': ['CancelBooking', 'Cancelar reserva'],
  '29': ['MyProfile', 'Mi perfil'], '30': ['MyTrips', 'Mis viajes'], '31': ['FavoritesRoutine', 'Favoritos y rutina'], '32': ['Plans', 'Planes'],
  '33': ['PaymentsEarnings', 'Pagos y ganancias'], '34': ['Settings', 'Ajustes'], '35': ['HelpCenter', 'Centro de ayuda'], '36': ['ServiceStatus', 'Estados de error'],
  '37': ['AdminSummary', 'Admin · Resumen'], '38': ['AdminUsersReview', 'Admin · Usuarios'], '39': ['AdminBookingsRefunds', 'Admin · Reservas y reembolsos'], '40': ['AdminTariffsOps', 'Admin · Tarifas y operaciones'],
};

function thumbnails(ids) {
  if (NO_THUMBS) return {};
  const script = `
import sys, io, base64, json
from PIL import Image
out = {}
for sid in sys.argv[2:]:
    p = sys.argv[1] + '/' + sid + '.jpg'
    try:
        im = Image.open(p).convert('RGB')
    except Exception:
        continue
    w = 200
    h = round(im.height * w / im.width)
    im = im.resize((w, h), Image.LANCZOS)
    b = io.BytesIO()
    im.save(b, 'JPEG', quality=62, optimize=True, progressive=True)
    out[sid] = [w, h, base64.b64encode(b.getvalue()).decode()]
print(json.dumps(out))
`;
  const r = spawnSync('python3', ['-I', '-c', script, path.join(ROOT, 'design/reference'), ...ids], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) {
    warn('No se han podido generar las miniaturas de los diseños (¿falta Pillow?). El panel funciona sin ellas.');
    return {};
  }
  const raw = JSON.parse(r.stdout);
  return Object.fromEntries(Object.entries(raw).map(([id, [w, h, b64]]) => [id, { w, h, uri: `data:image/jpeg;base64,${b64}` }]));
}

function buildViewerData(extra) {
  const manifestFile = path.join(ROOT, 'design/manifest.json');
  let designs = [];
  if (fs.existsSync(manifestFile)) {
    const manifest = JSON.parse(read(manifestFile));
    designs = manifest.screens.map((s) => {
      const num = String(s.screen).replace(/[a-z]+$/i, '');
      const [routeName, title] = SCREEN_NAMES[num] ?? [null, `Pantalla ${num}`];
      return { id: String(s.screen), number: s.number, variant: s.variant || '', board: s.board, route: routeName, title };
    });
  } else warn('No existe design/manifest.json: «Ir a pantalla» solo mostrará las rutas de la app.');
  const scenarios = {};
  const sdir = path.join(ROOT, 'design/scenarios');
  for (const f of fs.existsSync(sdir) ? fs.readdirSync(sdir).filter((n) => n.endsWith('.json')) : []) {
    try {
      const sc = JSON.parse(read(path.join(sdir, f)));
      if (sc && typeof sc.route === 'string') scenarios[path.basename(f, '.json')] = sc;
    } catch (e) {
      warn(`design/scenarios/${f} no es JSON válido: se ignora (${e.message}).`);
    }
  }
  const thumbs = thumbnails(designs.map((d) => d.id));
  return { designs, scenarios, thumbs, build: extra };
}

// ───────────────────────────── 6. Visor ─────────────────────────────
function appIconSvgUri() {
  const svg = path.join(ROOT, 'design/logo/mvc-icon.svg');
  return fs.existsSync(svg) ? dataUri(svg) : '';
}
function wordLogoSvgUri() {
  const svg = path.join(ROOT, 'design/logo/mvc-word.svg');
  return fs.existsSync(svg) ? dataUri(svg) : '';
}

function buildViewer(innerHtml, data) {
  const tpl = read(path.join(SHELL_DIR, 'viewer.html'));
  const css = ['viewer.css', 'system.css'].map((n) => read(path.join(SHELL_DIR, n))).join('\n');
  const js = `(function () {\n'use strict';\n${['viewer-core.js', 'viewer-system.js', 'viewer-panel.js', 'viewer-main.js'].map((n) => read(path.join(SHELL_DIR, n))).join('\n')}\n})();`;
  const gz = zlib.gzipSync(Buffer.from(innerHtml, 'utf8'), { level: 9 });
  const payload = gz.toString('base64');
  const viewerData = { ...data, assets: { appIcon: appIconSvgUri(), wordLogo: wordLogoSvgUri() } };
  const dataJson = JSON.stringify(viewerData).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const slots = { '/*MVC_CSS*/': css, '/*MVC_JS*/': escapeInlineScript(js), '/*MVC_DATA*/': dataJson, '<!--MVC_PAYLOAD-->': payload, '<!--MVC_FAVICON-->': faviconTag().trim(), '<!--MVC_CSP-->': CSP_VIEWER };
  let out = tpl;
  for (const [slot, value] of Object.entries(slots)) {
    if (!out.includes(slot)) fail(`tools/preview/shell/viewer.html no tiene el hueco ${slot}`);
    out = out.replace(slot, () => value); // función: «$&» y similares dentro del valor no se interpretan
  }
  return { html: out, gzBytes: gz.length, rawBytes: Buffer.byteLength(innerHtml) };
}

// ───────────────────────────── 7. Comprobación de hermeticidad del resultado ─────────────────────────────
function selfCheck(html, label) {
  const problems = [];
  // Estructura: se miran las etiquetas con el contenido de <script>/<style> quitado (el código de la app cita muchas cadenas).
  const bodies = [];
  const structural = html
    .replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (m, attrs) => `<script${attrs}></script>`)
    .replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi, (m, attrs, body) => {
      bodies.push(body);
      return `<style${attrs}></style>`;
    });
  if (/<script\b[^>]*\bsrc=/i.test(structural)) problems.push('contiene <script src=…>');
  if (/<link\b[^>]*\bhref=["']?(?:https?:)?\/\//i.test(structural)) problems.push('contiene <link href=http…>');
  if (/<(?:img|source|video|audio|embed|object)\b[^>]*\b(?:src|data)=["']?(?:https?:)?\/\//i.test(structural)) problems.push('contiene un recurso con URL remota');
  if (/<iframe\b[^>]*\bsrc=/i.test(structural)) problems.push('contiene <iframe src=…>');
  if (bodies.some((b) => /@import\s+(?:url\()?\s*["']?(?:https?:)?\/\//i.test(b))) problems.push('contiene @import remoto');
  if (bodies.some((b) => /url\(\s*["']?(?:https?:)?\/\//i.test(b))) problems.push('contiene url() remota en una hoja de estilo');
  if (problems.length) fail(`${label} no es hermético: ${problems.join('; ')}`);
}

// ───────────────────────────── 8. ¿Cubren los sustitutos web lo que la app importa? ─────────────────────────────
/** Aviso (no error): un nombre que la app importa de un módulo sustituido y que mobile/web-stubs/* no exporta falla al llamarlo. */
function reportStubCoverage() {
  let cov;
  try {
    cov = checkStubCoverage(MOBILE);
  } catch (e) {
    warn(`no he podido comprobar los sustitutos web: ${e.message}`);
    return { error: String(e.message) };
  }
  if (cov.skipped) {
    warn(`sustitutos web sin comprobar: ${cov.skipped}`);
    return cov;
  }
  console.log(`  sustitutos web: la app importa ${cov.names} nombres de ${cov.modules - cov.unused.length} de los ${cov.modules} módulos sustituidos · ${cov.missing.length ? `${cov.missing.length} SIN CUBRIR` : 'todos cubiertos'}`);
  for (const m of cov.missing) warn(`${m.module}: la app usa «${m.name}» (${m.files.join(', ')}) y mobile/${m.stub} no lo exporta; esa pantalla fallará en la vista previa. Hay que añadirlo al sustituto (agente preview-shell).`);
  return cov;
}

// ───────────────────────────── Ejecución ─────────────────────────────
const t0 = Date.now();
if (!SKIP_EXPORT) exportWeb();
const assembleStart = Date.now();
const stubCoverage = reportStubCoverage();
console.log('› Montando los HTML…');
const inner = buildInnerDoc();
selfCheck(inner.html, 'mvc-app.html');

const toolVersions = (() => {
  try {
    const p = JSON.parse(read(path.join(MOBILE, 'package.json')));
    return { expo: p.dependencies?.expo, reactNative: p.dependencies?.['react-native'], app: p.version };
  } catch {
    return {};
  }
})();
const builtAt = new Date().toISOString();
const data = buildViewerData({ at: builtAt, appBytes: inner.mainBytes, ...toolVersions, node: process.version });
const viewer = buildViewer(inner.html, data);
selfCheck(viewer.html, 'mvc-preview.html');

fs.mkdirSync(DIST, { recursive: true });
fs.writeFileSync(OUT_APP, inner.html);
fs.writeFileSync(OUT_VIEWER, viewer.html);
const sizeApp = fs.statSync(OUT_APP).size;
const sizeViewer = fs.statSync(OUT_VIEWER).size;

const assets = [...assetReport.entries()].map(([u, v]) => ({ asset: u.replace(/^\/assets\//, ''), ...v }));
const report = {
  builtAt,
  seconds: Math.round((Date.now() - t0) / 1000),
  files: { viewer: rel(OUT_VIEWER), app: rel(OUT_APP) },
  bytes: { viewer: sizeViewer, app: sizeApp, appBundleJs: inner.mainBytes, payloadGzip: viewer.gzBytes, innerHtml: viewer.rawBytes, limit: LIMIT_BYTES },
  iconSets: usedIcons.sets,
  assets,
  cdnNeutralized: Object.fromEntries(cdnReport),
  designs: data.designs.length,
  scenarios: Object.keys(data.scenarios).length,
  thumbnails: Object.keys(data.thumbs).length,
  stubCoverage,
  warnings,
};
fs.writeFileSync(OUT_REPORT, JSON.stringify(report, null, 2) + '\n');

console.log(`\n› Contenido de ${rel(OUT_VIEWER)}`);
inner.mainFiles.forEach((f) => console.log(`  bundle de la app: ${rel(f)} (${mb(fs.statSync(f).size)})`));
console.log(`  documento de la app sin comprimir: ${mb(viewer.rawBytes)} → dentro del visor, gzip+base64: ${mb(Math.ceil((viewer.gzBytes * 4) / 3))}`);
if (usedIcons.sets.length) console.log(`  iconos: ${usedIcons.sets.join(', ')} (solo las fuentes de estos juegos van dentro)`);
else console.log('  iconos: la app no importa ningún juego de @expo/vector-icons');
const byStatus = new Map();
for (const a of assets) {
  const e = byStatus.get(a.status) ?? { n: 0, bytes: 0 };
  e.n++;
  e.bytes += a.bytes;
  byStatus.set(a.status, e);
}
for (const [status, e] of byStatus) console.log(`  recursos «${status}»: ${e.n} (${kb(e.bytes)})`);
for (const [name, n] of cdnReport) console.log(`  descarga desde CDN desactivada: ${name} (${n})`);
console.log(`  diseños: ${data.designs.length} · escenarios: ${Object.keys(data.scenarios).length} · miniaturas: ${Object.keys(data.thumbs).length}`);
console.log(`\n✔ ${rel(OUT_VIEWER)} · ${mb(sizeViewer)} (${sizeViewer.toLocaleString('es-ES')} bytes; límite ${mb(LIMIT_BYTES)})`);
console.log(`✔ ${rel(OUT_APP)} · ${mb(sizeApp)} (la app sola; para pruebas: ?profile=passenger&device=iphone15&perm=granted)`);
console.log(`  informe: ${rel(OUT_REPORT)}`);
console.log(`  montaje en ${((Date.now() - assembleStart) / 1000).toFixed(1)} s (sin contar la espera del bloqueo ni la exportación)`);
if (sizeViewer > LIMIT_BYTES) fail('El HTML del visor supera el límite de 16 MB.');
if (sizeViewer > WARN_BYTES) warn('El visor se acerca al límite de 16 MB.');
