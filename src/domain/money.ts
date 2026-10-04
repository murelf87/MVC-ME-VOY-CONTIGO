export type MoneyBreakdown = {
  contributionCents: number;
  passengerCommissionCents: number;
  driverCommissionCents: number;
  processingCents: number;
  taxesCents: number;
  passengerTotalCents: number;
  driverNetCents: number;
};

function assertSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) throw new Error(`${label} must be a safe integer`);
}

export function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error("denominator must be positive");
  if (numerator < 0n) throw new Error("negative monetary values are not supported here");
  return (numerator + denominator / 2n) / denominator;
}

/**
 * rateMicrosPerKm is micro-euros per km.
 * Example only: 300000 micro-euros/km = 0.30 EUR/km.
 * Calling this function does NOT activate any tariff.
 */
export function contributionForRoadDistance(
  distanceMeters: number,
  rateMicrosPerKm: number
): number {
  assertSafeInteger(distanceMeters, "distanceMeters");
  assertSafeInteger(rateMicrosPerKm, "rateMicrosPerKm");
  if (distanceMeters < 0 || rateMicrosPerKm < 0) throw new Error("values must be non-negative");

  // euros = meters/1000 * micro-euros/1_000_000
  // cents = euros * 100 -> meters * rate / 10_000_000
  const cents = roundHalfUp(BigInt(distanceMeters) * BigInt(rateMicrosPerKm), 10_000_000n);
  const result = Number(cents);
  assertSafeInteger(result, "contributionCents");
  return result;
}

export function buildBreakdown(input: {
  contributionCents: number;
  passengerCommissionCents?: number;
  driverCommissionCents?: number;
  processingCents?: number;
  taxesCents?: number;
}): MoneyBreakdown {
  const contribution = input.contributionCents;
  const passengerCommission = input.passengerCommissionCents ?? 0;
  const driverCommission = input.driverCommissionCents ?? 0;
  const processing = input.processingCents ?? 0;
  const taxes = input.taxesCents ?? 0;

  for (const [label, value] of Object.entries({
    contribution,
    passengerCommission,
    driverCommission,
    processing,
    taxes
  })) {
    assertSafeInteger(value, label);
    if (value < 0) throw new Error(`${label} must be non-negative`);
  }

  return {
    contributionCents: contribution,
    passengerCommissionCents: passengerCommission,
    driverCommissionCents: driverCommission,
    processingCents: processing,
    taxesCents: taxes,
    passengerTotalCents: contribution + passengerCommission + processing + taxes,
    driverNetCents: contribution - driverCommission
  };
}
