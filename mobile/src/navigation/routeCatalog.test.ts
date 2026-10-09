/**
 * Contrato de rutas del producto (BUILD_BRIEF §3.1): las 40 pantallas de las láminas existen, cada una en el slice
 * que le corresponde, sin repetirse. Se lee el código fuente de `features/<slice>/routes.ts` (no se importa: los slices
 * arrastran React Native, que no se ejecuta en Node). Los slices pueden AÑADIR rutas; no pueden perder ni mover estas.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const FEATURES_DIR = join(__dirname, "..", "features");

const REQUIRED: Record<string, string[]> = {
  auth: ["Welcome", "ChooseRole", "CreateAccount", "VerifyPhone", "ProfilePhoto", "PrivateCheckCapture", "PrivateCheckPrivacy", "PrivateCheckStatus"],
  search: ["MapHome", "DefineRoute", "TripResults", "TripDetail", "PickupPoint", "WeeklySeat", "ReviewRequest", "RequestStatusPayment"],
  driver: ["MyVehicle", "PublishRoute", "StopsRoute", "DriverRequests"],
  live: ["WaitingForCar", "RouteChange", "InCar", "TripFinished"],
  messages: ["Inbox", "BookingChat", "Notifications", "CancelBooking"],
  profile: ["MyProfile", "MyTrips", "FavoritesRoutine", "Plans"],
  account: ["PaymentsEarnings", "Settings", "HelpCenter", "ServiceStatus"],
  admin: ["AdminSummary", "AdminUsersReview", "AdminBookingsRefunds", "AdminTariffsOps"],
};

function declaredRoutes(slice: string): string[] {
  const source = readFileSync(join(FEATURES_DIR, slice, "routes.ts"), "utf8");
  return [...source.matchAll(/defineRoute\(\s*\{\s*name:\s*"([A-Za-z0-9]+)"/g)].map((match) => match[1] as string);
}

describe("catálogo de rutas del producto", () => {
  it("hay exactamente 40 pantallas obligatorias repartidas en 8 slices", () => {
    assert.equal(Object.keys(REQUIRED).length, 8);
    assert.equal(Object.values(REQUIRED).flat().length, 40);
    assert.equal(new Set(Object.values(REQUIRED).flat()).size, 40);
  });

  for (const [slice, expected] of Object.entries(REQUIRED)) {
    it(`slice ${slice}: declara sus rutas obligatorias`, () => {
      const declared = declaredRoutes(slice);
      for (const name of expected) assert.ok(declared.includes(name), `falta la ruta ${name} en features/${slice}/routes.ts`);
    });

    it(`slice ${slice}: exporta el tipo de parámetros y la lista de rutas con el nombre convenido`, () => {
      const source = readFileSync(join(FEATURES_DIR, slice, "routes.ts"), "utf8");
      const typeName = `${slice[0]?.toUpperCase()}${slice.slice(1)}Params`;
      assert.match(source, new RegExp(`export type ${typeName}\\b`), `falta export type ${typeName}`);
      assert.match(source, new RegExp(`export const ${slice}Routes\\b`), `falta export const ${slice}Routes`);
      const index = readFileSync(join(FEATURES_DIR, slice, "index.ts"), "utf8");
      assert.match(index, /\bas routes\b/, `features/${slice}/index.ts debe exportar { routes }`);
    });
  }

  it("ningún nombre de ruta se repite entre slices", () => {
    const owner = new Map<string, string>();
    for (const slice of readdirSync(FEATURES_DIR, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name)) {
      let names: string[];
      try {
        names = declaredRoutes(slice);
      } catch {
        continue; // carpeta sin routes.ts (no es un slice)
      }
      for (const name of names) {
        assert.equal(owner.get(name), undefined, `la ruta ${name} está en «${owner.get(name)}» y en «${slice}»`);
        owner.set(name, slice);
      }
    }
    assert.ok(owner.size >= 40, `se esperaban ≥ 40 rutas, hay ${owner.size}`);
  });
});
