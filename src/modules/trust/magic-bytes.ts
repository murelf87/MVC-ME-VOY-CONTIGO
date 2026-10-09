/**
 * Comprobación de la firma binaria de un archivo frente al tipo declarado. No sustituye a un antivirus ni valida que el
 * contenido sea una foto de una persona: solo evita que se acepte un binario cualquiera con otra extensión/tipo.
 */
const HEIF_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1", "heif"]);

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((value, index) => bytes[offset + index] === value);
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  let out = "";
  for (let i = start; i < end && i < bytes.length; i += 1) out += String.fromCharCode(bytes[i] ?? 0);
  return out;
}

export function matchesDeclaredType(bytes: Uint8Array, contentType: string): boolean {
  switch (contentType) {
    case "image/jpeg":
      return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case "image/png":
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/webp":
      return ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP";
    case "image/heic":
    case "image/heif":
      return ascii(bytes, 4, 8) === "ftyp" && HEIF_BRANDS.has(ascii(bytes, 8, 12));
    case "application/pdf":
      return ascii(bytes, 0, 5) === "%PDF-";
    default:
      return false;
  }
}

export function extensionFor(contentType: string): string {
  switch (contentType) {
    case "image/jpeg": return "jpg";
    case "image/png": return "png";
    case "image/webp": return "webp";
    case "image/heic": return "heic";
    case "image/heif": return "heif";
    case "application/pdf": return "pdf";
    default: return "bin";
  }
}
