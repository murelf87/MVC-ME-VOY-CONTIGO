import test from "node:test";
import assert from "node:assert/strict";
import { extensionFor, matchesDeclaredType } from "../../src/modules/trust/magic-bytes.js";

const bytes = (...values: number[]) => Uint8Array.from(values);
const ascii = (text: string) => Uint8Array.from(Buffer.from(text, "latin1"));
const concat = (...parts: Uint8Array[]) => Uint8Array.from(Buffer.concat(parts));

const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00);
const WEBP = concat(ascii("RIFF"), bytes(0x24, 0, 0, 0), ascii("WEBPVP8 "));
const heif = (brand: string) => concat(bytes(0, 0, 0, 0x18), ascii("ftyp"), ascii(brand), bytes(0, 0, 0, 0));
const PDF = ascii("%PDF-1.7\n");

test("trust/magic-bytes: reconoce cada formato por su firma binaria", () => {
  assert.equal(matchesDeclaredType(JPEG, "image/jpeg"), true);
  assert.equal(matchesDeclaredType(PNG, "image/png"), true);
  assert.equal(matchesDeclaredType(WEBP, "image/webp"), true);
  assert.equal(matchesDeclaredType(PDF, "application/pdf"), true);
  for (const brand of ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1", "heif"]) {
    assert.equal(matchesDeclaredType(heif(brand), "image/heic"), true, brand);
    assert.equal(matchesDeclaredType(heif(brand), "image/heif"), true, brand);
  }
});

test("trust/magic-bytes: rechaza un binario que no corresponde al tipo declarado", () => {
  assert.equal(matchesDeclaredType(PNG, "image/jpeg"), false);
  assert.equal(matchesDeclaredType(JPEG, "image/png"), false);
  assert.equal(matchesDeclaredType(JPEG, "application/pdf"), false);
  assert.equal(matchesDeclaredType(PDF, "image/jpeg"), false);
  assert.equal(matchesDeclaredType(ascii("MZ\u0090\u0000executable"), "image/jpeg"), false);
  assert.equal(matchesDeclaredType(ascii("<?php echo 1; ?>"), "image/png"), false);
  assert.equal(matchesDeclaredType(ascii("<svg xmlns='http://www.w3.org/2000/svg'/>"), "image/webp"), false);
});

test("trust/magic-bytes: RIFF sin WEBP, HEIF con marca desconocida o sin ftyp no valen", () => {
  assert.equal(matchesDeclaredType(concat(ascii("RIFF"), bytes(0, 0, 0, 0), ascii("WAVEfmt ")), "image/webp"), false);
  assert.equal(matchesDeclaredType(heif("avif"), "image/heic"), false);
  assert.equal(matchesDeclaredType(concat(bytes(0, 0, 0, 0x18), ascii("moov"), ascii("heic")), "image/heic"), false);
});

test("trust/magic-bytes: archivos vacíos o más cortos que la firma se rechazan sin lanzar", () => {
  for (const type of ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"]) {
    assert.equal(matchesDeclaredType(new Uint8Array(0), type), false, `${type} vacío`);
    assert.equal(matchesDeclaredType(bytes(0xff), type), false, `${type} 1 byte`);
  }
  assert.equal(matchesDeclaredType(bytes(0xff, 0xd8), "image/jpeg"), false);
  assert.equal(matchesDeclaredType(ascii("%PDF"), "application/pdf"), false);
});

test("trust/magic-bytes: un tipo no permitido nunca coincide", () => {
  for (const type of ["image/gif", "image/svg+xml", "text/html", "application/octet-stream", "application/zip", ""]) {
    assert.equal(matchesDeclaredType(JPEG, type), false, type);
    assert.equal(matchesDeclaredType(PDF, type), false, type);
  }
});

test("trust/magic-bytes: extensionFor devuelve la extensión canónica o «bin»", () => {
  assert.deepEqual(
    ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"].map(extensionFor),
    ["jpg", "png", "webp", "heic", "heif", "pdf"]
  );
  assert.equal(extensionFor("application/x-unknown"), "bin");
  assert.equal(extensionFor(""), "bin");
});
