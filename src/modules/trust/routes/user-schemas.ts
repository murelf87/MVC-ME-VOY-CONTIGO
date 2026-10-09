import { type Schema, arr, bool, enumOf, int, nint, nenum, nullable, nstr, nReasonS, obj, str } from "../schemas.js";

export const uploadIntentS: Schema = obj({
  intentId: str(),
  uploadUrl: str(),
  method: enumOf(["PUT"]),
  headers: { type: "object", additionalProperties: { type: "string" } },
  expiresAt: str(),
  maxSizeBytes: int(),
  allowedContentTypes: arr(str())
});

/**
 * Cuerpo de «pedir subida». Es deliberadamente permisivo en tipo y tamaño: el servicio responde con los códigos estables
 * 422 UPLOAD_TYPE_NOT_ALLOWED / UPLOAD_SIZE_INVALID (y la UI muestra el motivo) en lugar de un 400 genérico.
 */
export const uploadIntentBody = (types: readonly string[], maxBytes: number): Schema =>
  obj(
    {
      contentType: str({ minLength: 1, maxLength: 100, description: `Tipo MIME. Admitidos: ${types.join(", ")}.` }),
      sizeBytes: int({ description: `Tamaño exacto del archivo en bytes (de 1 a ${maxBytes}).` })
    },
    ["contentType", "sizeBytes"]
  );

const photoSubmissionS: Schema = obj({
  id: str(),
  status: enumOf(["in_review", "approved", "rejected", "superseded"]),
  submittedAt: str(),
  decidedAt: nstr(),
  reason: nReasonS,
  previewUrl: nstr(),
  previewExpiresAt: nstr()
});

export const photoStateS: Schema = obj({
  state: enumOf(["none", "in_review", "approved", "rejected"]),
  required: bool(),
  publicPhotoUrl: nstr(),
  latest: nullable(photoSubmissionS),
  uploadAvailable: bool()
});

const attemptS: Schema = obj({
  id: str(),
  attemptNo: int(),
  status: enumOf(["in_review", "accepted", "needs_retry", "rejected", "superseded"]),
  submittedAt: str(),
  decidedAt: nstr(),
  previewUrl: nstr(),
  previewExpiresAt: nstr()
});

export const privateCheckS: Schema = obj({
  state: enumOf(["not_started", "in_review", "needs_retry", "completed", "rejected"]),
  method: nenum(["selfie", "identity_document"]),
  attempts: obj({ used: int(), max: int(), remaining: int() }),
  reason: nReasonS,
  nextAction: enumOf(["accept_notice", "capture", "retry_capture", "wait_review", "use_alternative", "none"]),
  canUseAlternative: bool(),
  consent: obj({
    noticeKind: enumOf(["private_check_notice"]),
    noticeVersion: nint(),
    accepted: bool(),
    acceptedAt: nstr(),
    noticeLegallyReviewed: bool()
  }),
  lastAttempt: nullable(attemptS),
  review: enumOf(["human"]),
  biometricMatching: enumOf(["not_activated"]),
  selfieAloneVerifiesIdentity: bool(),
  uploadAvailable: bool(),
  updatedAt: nstr()
});

export const documentSubmissionS: Schema = obj({
  id: str(),
  kind: enumOf(["identity_document", "driver_license"]),
  status: enumOf(["in_review", "approved", "rejected"]),
  submittedAt: str(),
  decidedAt: nstr(),
  reason: nReasonS
});

export const identityStateS: Schema = obj({
  status: enumOf(["unverified", "pending", "verified", "rejected"]),
  verifiedBy: nenum(["identity_document"]),
  documents: arr(documentSubmissionS),
  driverLicense: nullable(documentSubmissionS),
  uploadAvailable: bool()
});

export const overviewS: Schema = obj({
  roles: arr(enumOf(["passenger", "driver"])),
  photo: photoStateS,
  privateCheck: privateCheckS,
  identity: identityStateS
});

export const documentCompletedS: Schema = obj({
  document: documentSubmissionS,
  privateCheck: privateCheckS,
  identity: identityStateS
});

/* ───────── Legal ───────── */

const sectionS: Schema = obj({ heading: str(), paragraphs: arr(str()), bullets: arr(str()) });
export const legalSummaryS: Schema = obj({
  id: str(),
  kind: enumOf(["terms", "privacy", "cancellation", "private_check_notice"]),
  version: int(),
  status: enumOf(["draft_pending_legal_review", "published", "retired"]),
  title: str(),
  locale: enumOf(["es-ES"]),
  legallyEffective: bool(),
  pendingLegalReview: bool(),
  effectiveFrom: nstr(),
  publishedAt: nstr(),
  contentSha256: str()
});
export const legalDocumentS: Schema = obj({
  ...(legalSummaryS.properties as Record<string, Schema>),
  sections: arr(sectionS)
});
export const legalSectionInputS: Schema = obj(
  {
    heading: str({ minLength: 1, maxLength: 200 }),
    paragraphs: arr(str({ minLength: 1, maxLength: 5000 }), { maxItems: 50 }),
    bullets: arr(str({ minLength: 1, maxLength: 1000 }), { maxItems: 50 })
  },
  ["heading"]
);
export const legalAcceptanceS: Schema = obj({
  id: str(),
  documentId: str(),
  kind: enumOf(["terms", "privacy", "cancellation", "private_check_notice"]),
  version: int(),
  context: enumOf(["registration", "account", "booking", "private_check", "other"]),
  acceptedAt: str(),
  legallyEffective: bool()
});
export const legalStatusS: Schema = obj({
  items: arr(
    obj({
      kind: enumOf(["terms", "privacy", "cancellation", "private_check_notice"]),
      latestVersion: int(),
      status: enumOf(["draft_pending_legal_review", "published", "retired"]),
      pendingLegalReview: bool(),
      scope: enumOf(["account", "booking", "private_check"]),
      accepted: bool(),
      acceptedVersion: nint(),
      acceptedAt: nstr()
    })
  ),
  accountDocumentsAccepted: bool()
});
