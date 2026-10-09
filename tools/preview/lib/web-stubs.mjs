// Sustitutos web de los módulos nativos de Expo (mobile/web-stubs/*): quién es quién y si cubren lo que la app usa.
//  - readWebStubMap(): módulo → fichero, leído de mobile/metro.config.js (única fuente de verdad de la sustitución).
//  - checkStubCoverage(): recorre mobile/src y App.tsx con el compilador de TypeScript, recoge los NOMBRES que la app importa de
//    cada módulo con sustituto (import { x }, import * as X + X.x, import X, export … from, require/import() dinámico) y avisa de
//    los que el sustituto no exporta. Un nombre sin exportar no rompe la build (Metro no lo comprueba) pero hace fallar la
//    pantalla que lo llama, solo en la vista previa. La usa build-artifact.mjs (aviso, no error) y el informe de la build.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

/** nombre del módulo → fichero de web-stubs/ (el mapa de react-native-maps lo escribe otro agente y no se evalúa aquí). */
export function readWebStubMap(mobileDir) {
  const src = fs.readFileSync(path.join(mobileDir, 'metro.config.js'), 'utf8');
  const block = /const WEB_STUBS = \{([\s\S]*?)\n\};/.exec(src);
  if (!block) throw new Error('mobile/metro.config.js: no se encuentra la tabla WEB_STUBS');
  const map = {};
  for (const m of block[1].matchAll(/'([^']+)':\s*'([^']+\.js)'/g)) map[m[1]] = m[2];
  return map;
}

/** Nombres que exporta un sustituto (export function/const/class, export { a, b as c }, export default, export *). */
export function stubExportNames(file) {
  const src = fs.readFileSync(file, 'utf8');
  const names = new Set();
  for (const m of src.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z0-9_$]+)/gm)) names.add(m[1]);
  for (const m of src.matchAll(/^export\s*\{([^}]*)\}/gm)) m[1].split(',').map((x) => x.trim()).filter(Boolean).forEach((x) => names.add(x.split(/\s+as\s+/).pop().trim()));
  if (/^export\s+default\b/m.test(src)) names.add('default');
  if (/^export\s+\*\s+from/m.test(src)) names.add('*');
  return names;
}

function loadTypeScript(mobileDir) {
  for (const base of [mobileDir, path.resolve(mobileDir, '..')]) {
    try {
      return createRequire(path.join(base, 'package.json'))('typescript');
    } catch {
      // siguiente candidato
    }
  }
  return null;
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'dist-preview', 'web-stubs', '.expo', 'android', 'ios'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}

/**
 * Devuelve { modules, names, missing: [{ module, name, files }], unused: [módulo…] } o { skipped: motivo }.
 * `names` = cuántos pares (módulo, nombre) usa la app; `unused` = módulos con sustituto que la app aún no importa.
 */
export function checkStubCoverage(mobileDir) {
  const ts = loadTypeScript(mobileDir);
  if (!ts) return { skipped: 'typescript no está instalado en mobile/node_modules' };
  const stubs = readWebStubMap(mobileDir);
  const used = {}; // módulo → Map(nombre → Set(ficheros))
  const note = (mod, name, file) => {
    const byName = (used[mod] ||= new Map());
    if (!byName.has(name)) byName.set(name, new Set());
    byName.get(name).add(path.relative(mobileDir, file));
  };
  const isStubbed = (spec) => Object.prototype.hasOwnProperty.call(stubs, spec);

  for (const file of walk(mobileDir)) {
    const text = fs.readFileSync(file, 'utf8');
    if (!Object.keys(stubs).some((m) => text.includes(m))) continue;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const alias = {}; // identificador de «import * as X» o «import X» → módulo
    const visit = (n) => {
      if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && isStubbed(n.moduleSpecifier.text)) {
        const mod = n.moduleSpecifier.text;
        const c = n.importClause;
        if (c && !c.isTypeOnly) {
          if (c.name) {
            note(mod, 'default', file);
            alias[c.name.text] = mod;
          }
          if (c.namedBindings) {
            if (ts.isNamespaceImport(c.namedBindings)) alias[c.namedBindings.name.text] = mod;
            else c.namedBindings.elements.forEach((el) => !el.isTypeOnly && note(mod, (el.propertyName || el.name).text, file));
          }
        }
      }
      if (ts.isExportDeclaration(n) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier) && isStubbed(n.moduleSpecifier.text) && !n.isTypeOnly) {
        const mod = n.moduleSpecifier.text;
        if (n.exportClause && ts.isNamedExports(n.exportClause)) n.exportClause.elements.forEach((el) => !el.isTypeOnly && note(mod, (el.propertyName || el.name).text, file));
        else note(mod, '*', file);
      }
      if (ts.isCallExpression(n) && n.arguments.length === 1 && ts.isStringLiteral(n.arguments[0]) && isStubbed(n.arguments[0].text) && (n.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(n.expression) && n.expression.text === 'require'))) {
        note(n.arguments[0].text, '(dinámico)', file);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    if (Object.keys(alias).length) {
      const visitUse = (n) => {
        if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && alias[n.expression.text]) note(alias[n.expression.text], n.name.text, file);
        else if (ts.isElementAccessExpression(n) && ts.isIdentifier(n.expression) && alias[n.expression.text] && ts.isStringLiteralLike(n.argumentExpression)) note(alias[n.expression.text], n.argumentExpression.text, file);
        else if (ts.isVariableDeclaration(n) && n.initializer && ts.isIdentifier(n.initializer) && alias[n.initializer.text] && ts.isObjectBindingPattern(n.name)) {
          n.name.elements.forEach((el) => note(alias[n.initializer.text], (el.propertyName || el.name).text, file));
        }
        ts.forEachChild(n, visitUse);
      };
      visitUse(sf);
    }
  }

  const missing = [];
  let names = 0;
  let modules = 0;
  const unused = [];
  for (const [mod, file] of Object.entries(stubs)) {
    if (mod === 'react-native-maps') continue; // lo cubre el agente `map`
    modules++;
    const exported = stubExportNames(path.join(mobileDir, 'web-stubs', file));
    const byName = used[mod];
    if (!byName) {
      unused.push(mod);
      continue;
    }
    for (const [name, files] of byName) {
      names++;
      if (name.startsWith('(') || exported.has(name) || exported.has('*')) continue;
      missing.push({ module: mod, name, stub: `web-stubs/${file}`, files: [...files].sort().slice(0, 5) });
    }
  }
  return { modules, names, missing, unused };
}
