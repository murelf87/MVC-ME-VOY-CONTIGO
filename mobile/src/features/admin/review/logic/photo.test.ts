// Pruebas de la resolución de fotos públicas (admin-review).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolvePublicPhoto } from "./photo";

describe("resolvePublicPhoto", () => {
  it("resuelve la ruta relativa contra la API", () => {
    assert.equal(resolvePublicPhoto("/v1/public/users/1/photo?v=a", "https://api.mvc.es"), "https://api.mvc.es/v1/public/users/1/photo?v=a");
  });
  it("deja intactas las URL absolutas, los datos en línea y los recursos empaquetados", () => {
    assert.equal(resolvePublicPhoto("https://cdn.mvc.es/a.jpg", "https://api.mvc.es"), "https://cdn.mvc.es/a.jpg");
    assert.equal(resolvePublicPhoto("data:image/png;base64,AAAA", ""), "data:image/png;base64,AAAA");
    assert.equal(resolvePublicPhoto("/assets/avatars/ana.png?hash=1", "https://api.mvc.es"), "/assets/avatars/ana.png?hash=1");
  });
  it("sin foto o sin API configurada devuelve null", () => {
    assert.equal(resolvePublicPhoto(null, "https://api.mvc.es"), null);
    assert.equal(resolvePublicPhoto("", "https://api.mvc.es"), null);
    assert.equal(resolvePublicPhoto("/v1/x", ""), null);
  });
});
