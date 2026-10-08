export type InsuranceExpiryDetection = {
  expiresOn: string;
  confidence: number;
  matchedText: string;
};

const EXPIRY_KEYWORDS = [
  "caducidad",
  "caduca",
  "vencimiento",
  "vence",
  "valido hasta",
  "válido hasta",
  "fecha fin",
  "fin de cobertura",
  "expiry",
  "expires",
  "valid until"
];

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ");
}

function isoDate(year: number, month: number, day: number): string | null {
  const value = new Date(Date.UTC(year, month - 1, day));
  if (
    value.getUTCFullYear() !== year ||
    value.getUTCMonth() !== month - 1 ||
    value.getUTCDate() !== day
  ) {
    return null;
  }
  return value.toISOString().slice(0, 10);
}

function parseDateToken(token: string): string | null {
  let match = /^(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})$/.exec(token);
  if (match) return isoDate(Number(match[1]), Number(match[2]), Number(match[3]));

  match = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/.exec(token);
  if (match) return isoDate(Number(match[3]), Number(match[2]), Number(match[1]));

  return null;
}

export function detectInsuranceExpiryFromText(
  rawText: string,
  today = new Date()
): InsuranceExpiryDetection | null {
  const text = normalize(rawText);
  const dateRegex = /\b(?:\d{4}[\/.\-]\d{1,2}[\/.\-]\d{1,2}|\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{4})\b/g;
  const candidates: Array<{
    expiresOn: string;
    matchedText: string;
    score: number;
    index: number;
  }> = [];

  for (const match of text.matchAll(dateRegex)) {
    const token = match[0];
    const index = match.index ?? 0;
    const expiresOn = parseDateToken(token);
    if (!expiresOn) continue;

    const windowStart = Math.max(0, index - 90);
    const windowEnd = Math.min(text.length, index + token.length + 40);
    const context = text.slice(windowStart, windowEnd);
    const keyword = EXPIRY_KEYWORDS.find(item => context.includes(item));
    const dateValue = new Date(`${expiresOn}T00:00:00.000Z`).getTime();
    const todayValue = Date.UTC(
      today.getUTCFullYear(),
      today.getUTCMonth(),
      today.getUTCDate()
    );

    let score = keyword ? 0.92 : 0.55;
    if (dateValue >= todayValue) score += 0.04;

    candidates.push({
      expiresOn,
      matchedText: context.trim(),
      score: Math.min(0.99, score),
      index
    });
  }

  if (!candidates.length) return null;

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.expiresOn.localeCompare(a.expiresOn);
  });

  const best = candidates[0]!;
  return {
    expiresOn: best.expiresOn,
    confidence: Number(best.score.toFixed(4)),
    matchedText: best.matchedText
  };
}
