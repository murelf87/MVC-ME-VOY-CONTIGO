// Builds the phone preview as one self-contained HTML: mobile/dist-preview/movil-mvc.html.
// Exports the Expo web app, inlines the bundle, the in-browser sample backend and the icon font,
// and wraps it in the device stage (iPhone 15, Pro Max, SE, Android, Pixel, Fold, 320 px).
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const mobile = path.resolve(here, "..");
const web = path.join(mobile, "dist-web");
const out = path.join(mobile, "dist-preview");

fs.rmSync(web, { recursive: true, force: true });
execSync("npx expo export -p web --clear --output-dir dist-web", {
  cwd: mobile,
  stdio: "inherit",
  env: { ...process.env, CI: "1", EXPO_PUBLIC_API_URL: "https://preview.mvc.invalid" }
});

const jsDir = path.join(web, "_expo", "static", "js", "web");
const bundle = fs.readdirSync(jsDir).find(f => /^index-.*\.js$/.test(f));
if (!bundle) throw new Error("Expo web bundle not found in " + jsDir);
let app = fs.readFileSync(path.join(jsDir, bundle), "utf8");

// Only Ionicons is used by the app (see the @expo/vector-icons imports); the other icon fonts stay out.
const fonts = [...new Set(app.match(/"\/assets\/[^"]*\/Ionicons\.[0-9a-f]+\.ttf"/g) ?? [])];
if (!fonts.length) throw new Error("Ionicons font not found in the bundle");
for (const quoted of fonts) {
  const rel = quoted.slice(2, -1);
  const data = fs.readFileSync(path.join(web, rel)).toString("base64");
  app = app.split(quoted).join(`"data:font/ttf;base64,${data}"`);
}

const esc = s => s.replace(/<\/script/gi, "<\\/script");
const api = fs.readFileSync(path.join(here, "preview-api.js"), "utf8");
const inner = fs.readFileSync(path.join(here, "app.html"), "utf8")
  .replace('<script src="preview-api.js"></script>', () => `<script>${esc(api)}</script>`)
  .replace('<script src="app.js" defer></script>', () => `<script>${esc(app)}</script>`);
const b64 = Buffer.from(inner, "utf8").toString("base64");

const stage = fs.readFileSync(path.join(here, "stage.html"), "utf8")
  .replace('<iframe id="app" src="app.html"', '<iframe id="app"')
  .replace("</style>", "</style></head><body>");
const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
${stage}<script>(function(){var b=atob("${b64}");var u=new Uint8Array(b.length);for(var i=0;i<b.length;i++)u[i]=b.charCodeAt(i);document.getElementById("app").srcdoc=new TextDecoder().decode(u);})();</script>
</body></html>
`;
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "movil-mvc.html"), html);
console.log(`dist-preview/movil-mvc.html (${(html.length / 1048576).toFixed(1)} MB, ${fonts.length} font(s) inlined)`);
