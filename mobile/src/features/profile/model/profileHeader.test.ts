import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TrustVerificationOverview } from "@/api/types";
import { hasBothRoles, locationLine, municipalityFromAddress, provinceIdOfFavorites, readOwnRating, roleCards, summarizeVerification } from "./profileHeader";

describe("municipalityFromAddress", () => {
  it("toma el último tramo y quita el barrio entre paréntesis", () => {
    assert.equal(municipalityFromAddress("Torre Sevilla, Sevilla"), "Sevilla");
    assert.equal(municipalityFromAddress("U. Pablo de Olavide, Sevilla"), "Sevilla");
    assert.equal(municipalityFromAddress("Sevilla (Nervión)"), "Sevilla");
    assert.equal(municipalityFromAddress("Calle Real 4, Dos Hermanas (Montequinto)"), "Dos Hermanas");
  });
  it("devuelve null sin texto", () => {
    assert.equal(municipalityFromAddress(""), null);
    assert.equal(municipalityFromAddress(" , "), null);
    assert.equal(municipalityFromAddress("(Nervión)"), null);
  });
});

describe("locationLine", () => {
  const casa = { kind: "home" as const, address: "Sevilla (Nervión)" };
  const trabajo = { kind: "work" as const, address: "Torre Sevilla, Sevilla" };
  it("une municipio y provincia como la lámina («Sevilla, Sevilla»)", () => {
    assert.equal(locationLine([trabajo, casa], "Sevilla"), "Sevilla, Sevilla");
  });
  it("prefiere la dirección de casa", () => {
    const otra = { kind: "other" as const, address: "Plaza Mayor 1, Écija" };
    assert.equal(locationLine([otra, casa], "Sevilla"), "Sevilla, Sevilla");
    assert.equal(locationLine([otra], "Sevilla"), "Écija, Sevilla");
  });
  it("sin destinos guardados muestra solo la provincia; sin nada, null", () => {
    assert.equal(locationLine([], "Sevilla"), "Sevilla");
    assert.equal(locationLine([], null), null);
    assert.equal(locationLine([casa], null), "Sevilla");
  });
});

describe("provinceIdOfFavorites", () => {
  it("usa la provincia de casa o, si no, la del primero con provincia", () => {
    assert.equal(provinceIdOfFavorites([{ kind: "work", provinceId: "p1" }, { kind: "home", provinceId: "p2" }]), "p2");
    assert.equal(provinceIdOfFavorites([{ kind: "work", provinceId: null }, { kind: "other", provinceId: "p3" }]), "p3");
    assert.equal(provinceIdOfFavorites([]), null);
  });
});

describe("readOwnRating", () => {
  it("lee la valoración solo si viene completa y es creíble", () => {
    assert.deepEqual(readOwnRating({ rating_average: 4.8, rating_count: 32 }), { average: 4.8, count: 32 });
  });
  it("no inventa estrellas", () => {
    assert.equal(readOwnRating({}), null);
    assert.equal(readOwnRating(null), null);
    assert.equal(readOwnRating({ rating_average: null, rating_count: 0 }), null);
    assert.equal(readOwnRating({ rating_average: 4.8, rating_count: 0 }), null);
    assert.equal(readOwnRating({ rating_average: 7, rating_count: 3 }), null);
    assert.equal(readOwnRating({ rating_average: "4.8", rating_count: 3 }), null);
    assert.equal(readOwnRating({ rating_average: 4.8, rating_count: 2.5 }), null);
  });
});

describe("roles", () => {
  it("marca los roles que tiene y el activo", () => {
    assert.deepEqual(roleCards(["passenger"], "passenger"), [
      { role: "passenger", owned: true, active: true },
      { role: "driver", owned: false, active: false },
    ]);
    assert.deepEqual(roleCards(["passenger", "driver", "admin"], "driver"), [
      { role: "passenger", owned: true, active: false },
      { role: "driver", owned: true, active: true },
    ]);
  });
  it("alterna solo con los dos roles", () => {
    assert.equal(hasBothRoles(["passenger"]), false);
    assert.equal(hasBothRoles(["passenger", "driver"]), true);
  });
});

function verification(overrides: {
  photo?: TrustVerificationOverview["photo"]["state"];
  check?: TrustVerificationOverview["privateCheck"]["state"];
  identity?: TrustVerificationOverview["identity"]["status"];
}): TrustVerificationOverview {
  return {
    roles: ["passenger"],
    photo: { state: overrides.photo ?? "approved", required: true, publicPhotoUrl: null, latest: null, uploadAvailable: true },
    privateCheck: {
      state: overrides.check ?? "completed",
      method: "selfie",
      attempts: { used: 1, max: 3, remaining: 2 },
      reason: null,
      nextAction: "none",
      canUseAlternative: true,
      consent: { noticeKind: "private_check_notice", noticeVersion: 1, accepted: true, acceptedAt: null, noticeLegallyReviewed: false },
      lastAttempt: null,
      review: "human",
      biometricMatching: "not_activated",
      selfieAloneVerifiesIdentity: false,
      uploadAvailable: true,
      updatedAt: null,
    },
    identity: { status: overrides.identity ?? "unverified", verifiedBy: null, documents: [], driverLicense: null, uploadAvailable: true },
  };
}

describe("summarizeVerification", () => {
  it("todo en orden", () => {
    assert.deepEqual(summarizeVerification(verification({})), { tone: "ok", next: null });
  });
  it("lo que exige acción gana a lo que está en revisión", () => {
    assert.deepEqual(summarizeVerification(verification({ photo: "none" })), { tone: "action", next: "photo_missing" });
    assert.deepEqual(summarizeVerification(verification({ photo: "rejected" })), { tone: "action", next: "photo_rejected" });
    assert.deepEqual(summarizeVerification(verification({ check: "needs_retry", identity: "pending" })), { tone: "action", next: "check_retry" });
    assert.deepEqual(summarizeVerification(verification({ check: "rejected" })), { tone: "action", next: "check_rejected" });
    assert.deepEqual(summarizeVerification(verification({ identity: "rejected" })), { tone: "action", next: "identity_rejected" });
  });
  it("revisión en curso", () => {
    assert.deepEqual(summarizeVerification(verification({ photo: "in_review" })), { tone: "review", next: "in_review" });
    assert.deepEqual(summarizeVerification(verification({ check: "in_review" })), { tone: "review", next: "in_review" });
    assert.deepEqual(summarizeVerification(verification({ identity: "pending" })), { tone: "review", next: "in_review" });
  });
  it("sin comprobación empezada no es una acción obligatoria", () => {
    assert.deepEqual(summarizeVerification(verification({ check: "not_started" })), { tone: "ok", next: null });
  });
});
