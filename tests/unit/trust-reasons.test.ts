import test from "node:test";
import assert from "node:assert/strict";
import {
  CHECK_REJECT_REASON_CODES,
  CHECK_RETRY_REASON_CODES,
  DOCUMENT_REASON_CODE,
  PHOTO_REASON_CODES,
  checkReasonOptions,
  checkReasonView,
  documentReasonOptions,
  documentReasonView,
  isCheckRejectReason,
  isCheckRetryReason,
  isPhotoReason,
  photoReasonOptions,
  photoReasonView
} from "../../src/modules/trust/reasons.js";

test("trust/reasons: catálogos de códigos estables", () => {
  assert.deepEqual([...PHOTO_REASON_CODES], [
    "FACE_NOT_VISIBLE", "SUNGLASSES_OR_COVERING", "MULTIPLE_PEOPLE", "LOW_QUALITY", "NOT_A_PERSON", "INAPPROPRIATE_CONTENT", "OTHER"
  ]);
  assert.deepEqual([...CHECK_RETRY_REASON_CODES], ["FACE_OUT_OF_FRAME", "LOW_LIGHT", "IMAGE_BLURRY", "FACE_COVERED", "MULTIPLE_PEOPLE"]);
  assert.deepEqual([...CHECK_REJECT_REASON_CODES], ["NOT_MATCHING_PROFILE_PHOTO", "NOT_A_LIVE_PERSON", "MAX_ATTEMPTS_REACHED", "OTHER"]);
  assert.equal(DOCUMENT_REASON_CODE, "DOCUMENT_REVIEW_REJECTED");
});

test("trust/reasons: los guardas de tipo distinguen cada catálogo", () => {
  assert.equal(isPhotoReason("LOW_QUALITY"), true);
  assert.equal(isPhotoReason("LOW_LIGHT"), false);
  assert.equal(isCheckRetryReason("LOW_LIGHT"), true);
  assert.equal(isCheckRetryReason("NOT_A_LIVE_PERSON"), false);
  assert.equal(isCheckRejectReason("NOT_A_LIVE_PERSON"), true);
  assert.equal(isCheckRejectReason("FACE_COVERED"), false);
  assert.equal(isPhotoReason(""), false);
});

test("trust/reasons: photoReasonView devuelve null sin motivo y «OTHER» ante un código desconocido", () => {
  assert.equal(photoReasonView(null), null);
  assert.equal(photoReasonView(undefined), null);
  assert.equal(photoReasonView(""), null);
  const known = photoReasonView("LOW_QUALITY");
  assert.equal(known?.code, "LOW_QUALITY");
  assert.equal(known?.title, "Necesitamos otra foto");
  const unknown = photoReasonView("ALGO_NUEVO");
  assert.equal(unknown?.code, "OTHER");
  assert.ok((unknown?.message ?? "").length > 10);
});

test("trust/reasons: reintento de la comprobación → «Necesitamos otra captura» con el motivo concreto", () => {
  const view = checkReasonView("needs_retry", "LOW_LIGHT");
  assert.deepEqual(view, { code: "LOW_LIGHT", title: "Necesitamos otra captura", message: "Hay poca luz. Busca un lugar más iluminado." });
  assert.equal(checkReasonView("needs_retry", "FACE_OUT_OF_FRAME").message, "El rostro está fuera del marco o no se ve con claridad.");
});

test("trust/reasons: un reintento sin motivo válido cae en «rostro fuera del marco» y nunca filtra un motivo de rechazo", () => {
  for (const code of [null, undefined, "", "ALGO_NUEVO", "NOT_A_LIVE_PERSON", "NOT_MATCHING_PROFILE_PHOTO"]) {
    assert.equal(checkReasonView("needs_retry", code).code, "FACE_OUT_OF_FRAME", String(code));
  }
});

test("trust/reasons: el rechazo de la comprobación es NEUTRO (no revela la sospecha del revisor)", () => {
  const neutral = ["NOT_MATCHING_PROFILE_PHOTO", "NOT_A_LIVE_PERSON", "OTHER"].map(code => checkReasonView("rejected", code));
  for (const view of neutral) {
    assert.equal(view.title, "No hemos podido completar la comprobación");
    assert.match(view.message, /^No hemos podido completar la comprobación con una foto\./);
    assert.match(view.message, /documento/);
    assert.doesNotMatch(view.message, /coincid|perfil|persona real|viva|biometr|suplant|falsa|fraude/i);
  }
  // Los tres mensajes son idénticos: la persona usuaria no puede distinguir el motivo interno.
  assert.equal(new Set(neutral.map(v => v.message)).size, 1);
});

test("trust/reasons: intentos agotados tiene su propio texto y un código desconocido cae en «OTHER»", () => {
  const max = checkReasonView("rejected", "MAX_ATTEMPTS_REACHED");
  assert.equal(max.code, "MAX_ATTEMPTS_REACHED");
  assert.match(max.message, /3 intentos/);
  assert.equal(checkReasonView("rejected", "LOW_LIGHT").code, "OTHER");
  assert.equal(checkReasonView("rejected", null).code, "OTHER");
});

test("trust/reasons: documentReasonView muestra el texto del revisor recortado o uno por defecto", () => {
  assert.deepEqual(documentReasonView("  Imagen ilegible  "), {
    code: "DOCUMENT_REVIEW_REJECTED",
    title: "No hemos podido validar tu documento",
    message: "Imagen ilegible"
  });
  for (const empty of [null, undefined, "", "   "]) {
    const view = documentReasonView(empty);
    assert.equal(view.code, "DOCUMENT_REVIEW_REJECTED");
    assert.equal(view.message, "No hemos podido validar tu documento. Puedes aportar otro.");
  }
});

test("trust/reasons: opciones del personal por decisión", () => {
  const photo = photoReasonOptions();
  assert.deepEqual(photo.map(o => o.code), [...PHOTO_REASON_CODES]);
  assert.ok(photo.every(o => o.decisions.length === 1 && o.decisions[0] === "rejected" && o.label.length > 0));

  const check = checkReasonOptions();
  const retry = check.filter(o => o.decisions.includes("needs_retry"));
  const reject = check.filter(o => o.decisions.includes("rejected"));
  assert.deepEqual(retry.map(o => o.code), [...CHECK_RETRY_REASON_CODES]);
  assert.deepEqual(reject.map(o => o.code), ["NOT_MATCHING_PROFILE_PHOTO", "NOT_A_LIVE_PERSON", "OTHER"]);
  // MAX_ATTEMPTS_REACHED lo fija el sistema: el revisor no puede elegirlo.
  assert.equal(check.some(o => o.code === "MAX_ATTEMPTS_REACHED"), false);
  assert.equal(check.length, 8);

  assert.deepEqual(documentReasonOptions(), [{ code: "DOCUMENT_REVIEW_REJECTED", label: "Documento no válido", decisions: ["rejected"] }]);
});
