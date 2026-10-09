// Sustituto web de expo-document-picker (SOLO VISTA PREVIA): «Archivos» del móvil simulado = selector de archivos del navegador.
import { previewShell } from './_preview-system';

export async function getDocumentAsync(options) {
  const opts = options || {};
  const shell = previewShell();
  if (!shell || typeof shell.pickDocument !== 'function') return { canceled: true, assets: null };
  const type = opts.type;
  const accept = Array.isArray(type) ? type : type && type !== '*/*' ? [type] : [];
  const files = await shell.pickDocument({ accept, multiple: !!opts.multiple });
  if (!files.length) return { canceled: true, assets: null };
  return {
    canceled: false,
    assets: files.map((f) => ({ uri: f.uri, name: f.name, size: f.size, mimeType: f.mimeType, lastModified: Date.now() })),
  };
}
