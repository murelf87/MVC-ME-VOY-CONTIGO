import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MeProfile } from "@/api/types";
import type { SessionStatus } from "@/session/types";
import { decideGate, stackForTarget, type GateInput } from "./gating";
import type { ReturnTarget } from "./returnTo";
import type { RouteAccess } from "./routeDef";

const ACCESS: Record<string, RouteAccess> = {
  Welcome: "public",
  ChooseRole: "public",
  CreateAccount: "public",
  MapHome: "public",
  TripDetail: "public",
  ProfilePhoto: "auth",
  ReviewRequest: "auth",
  RequestStatusPayment: "auth",
  Notifications: "auth",
  AdminSummary: "staff",
};
const accessOf = (name: string): RouteAccess | undefined => ACCESS[name];

function makeMe(overrides: Partial<MeProfile> = {}): MeProfile {
  return {
    id: "user-1",
    phone_e164: "+34600111222",
    status: "active",
    display_name: "Miguel Torres",
    public_photo_key: "photos/user-1.jpg",
    public_photo_status: "approved",
    identity_status: "unverified",
    presence_status: null,
    roles: ["passenger"],
    ...overrides,
  };
}

function gate(status: SessionStatus, me: MeProfile | null, pending: ReturnTarget | null = null): GateInput {
  return { session: { status, me }, pending, accessOf };
}

const names = (stack: readonly ReturnTarget[] | undefined): string[] => (stack ?? []).map((entry) => entry.name);

describe("decideGate: sesión", () => {
  it("mientras la sesión arranca no decide nada", () => {
    assert.equal(decideGate(gate("booting", null)), null);
  });

  it("sin sesión: Bienvenida", () => {
    const decision = decideGate(gate("signedOut", null));
    assert.deepEqual(names(decision?.stack), ["Welcome"]);
    assert.equal(decision?.reason, "signed_out");
    assert.equal(decision?.pendingHandled, false);
  });

  it("invitado: MapHome", () => {
    const decision = decideGate(gate("guest", null));
    assert.deepEqual(names(decision?.stack), ["MapHome"]);
    assert.equal(decision?.reason, "guest");
  });

  it("con sesión y alta completa: MapHome", () => {
    const decision = decideGate(gate("signedIn", makeMe()));
    assert.deepEqual(names(decision?.stack), ["MapHome"]);
    assert.equal(decision?.reason, "home");
  });

  it("con sesión pero sin /me todavía (offline sin caché): se entra al mapa", () => {
    const decision = decideGate(gate("signedIn", null));
    assert.deepEqual(names(decision?.stack), ["MapHome"]);
    assert.equal(decision?.reason, "home");
  });
});

describe("decideGate: alta incompleta (derivada de /me real)", () => {
  it("sin ningún rol: ChooseRole", () => {
    const decision = decideGate(gate("signedIn", makeMe({ roles: [], public_photo_key: null, public_photo_status: "pending" })));
    assert.deepEqual(names(decision?.stack), ["ChooseRole"]);
    assert.equal(decision?.reason, "onboarding_role");
  });

  it("con rol pero sin foto: ProfilePhoto", () => {
    const decision = decideGate(gate("signedIn", makeMe({ public_photo_key: null, public_photo_status: "pending" })));
    assert.deepEqual(names(decision?.stack), ["ProfilePhoto"]);
    assert.equal(decision?.reason, "onboarding_photo");
  });

  it("foto rechazada: vuelve a ProfilePhoto", () => {
    const decision = decideGate(gate("signedIn", makeMe({ public_photo_status: "rejected" })));
    assert.deepEqual(names(decision?.stack), ["ProfilePhoto"]);
  });

  it("foto subida y pendiente de revisión: el alta se considera completa", () => {
    const decision = decideGate(gate("signedIn", makeMe({ public_photo_status: "pending" })));
    assert.deepEqual(names(decision?.stack), ["MapHome"]);
  });

  it("el alta incompleta manda sobre cualquier destino pendiente, y no lo consume", () => {
    const pending: ReturnTarget = { name: "TripDetail", params: { tripId: "t-1" } };
    const decision = decideGate(gate("signedIn", makeMe({ public_photo_key: null, public_photo_status: "pending" }), pending));
    assert.deepEqual(names(decision?.stack), ["ProfilePhoto"]);
    assert.equal(decision?.pendingHandled, false);
  });

  it("personal sin rol de viajero no pasa por el alta", () => {
    const decision = decideGate(gate("signedIn", makeMe({ roles: ["admin"], public_photo_key: null, public_photo_status: "pending" })));
    assert.deepEqual(names(decision?.stack), ["MapHome"]);
  });
});

describe("decideGate: destino pendiente", () => {
  it("ruta pública: se apila sobre MapHome y se consume", () => {
    const pending: ReturnTarget = { name: "TripDetail", params: { tripId: "t-9" } };
    const decision = decideGate(gate("guest", null, pending));
    assert.deepEqual(names(decision?.stack), ["MapHome", "TripDetail"]);
    assert.deepEqual(decision?.stack[1], pending);
    assert.equal(decision?.pendingHandled, true);
  });

  it("ruta con cuenta + sesión válida: se apila y se consume", () => {
    const pending: ReturnTarget = { name: "RequestStatusPayment", params: { requestId: "r-1" } };
    const decision = decideGate(gate("signedIn", makeMe(), pending));
    assert.deepEqual(names(decision?.stack), ["MapHome", "RequestStatusPayment"]);
    assert.equal(decision?.pendingHandled, true);
  });

  it("un invitado con una ruta que exige cuenta conserva el destino (aún puede crear la cuenta)", () => {
    const pending: ReturnTarget = { name: "Notifications" };
    const decision = decideGate(gate("guest", null, pending));
    assert.deepEqual(names(decision?.stack), ["MapHome"]);
    assert.equal(decision?.pendingHandled, false);
  });

  it("ruta de personal sin permisos: se descarta sin revelarla", () => {
    const pending: ReturnTarget = { name: "AdminSummary" };
    const decision = decideGate(gate("signedIn", makeMe(), pending));
    assert.deepEqual(names(decision?.stack), ["MapHome"]);
    assert.equal(decision?.pendingHandled, true);
  });

  it("ruta de personal con permisos: se abre", () => {
    const pending: ReturnTarget = { name: "AdminSummary" };
    const decision = decideGate(gate("signedIn", makeMe({ roles: ["passenger", "support_admin"] }), pending));
    assert.deepEqual(names(decision?.stack), ["MapHome", "AdminSummary"]);
  });

  it("ruta inexistente: se descarta", () => {
    const pending = { name: "NoExiste" } as unknown as ReturnTarget;
    const decision = decideGate(gate("signedIn", makeMe(), pending));
    assert.deepEqual(names(decision?.stack), ["MapHome"]);
    assert.equal(decision?.pendingHandled, true);
  });

  it("MapHome pendiente no duplica la pantalla", () => {
    const decision = decideGate(gate("signedIn", makeMe(), { name: "MapHome" }));
    assert.deepEqual(names(decision?.stack), ["MapHome"]);
    assert.equal(decision?.pendingHandled, true);
  });

  it("sin sesión, el destino pendiente no se toca (se usará tras el alta)", () => {
    const pending: ReturnTarget = { name: "ReviewRequest", params: { tripId: "t-1" } as never };
    const decision = decideGate(gate("signedOut", null, pending));
    assert.deepEqual(names(decision?.stack), ["Welcome"]);
    assert.equal(decision?.pendingHandled, false);
  });
});

describe("stackForTarget", () => {
  const target: ReturnTarget = { name: "TripDetail", params: { tripId: "t-2" } };

  it("con sesión: MapHome + la ruta", () => {
    assert.deepEqual(names(stackForTarget(gate("signedIn", makeMe()), target)), ["MapHome", "TripDetail"]);
  });

  it("abrir MapHome no lo duplica", () => {
    assert.deepEqual(names(stackForTarget(gate("signedIn", makeMe()), { name: "MapHome" })), ["MapHome"]);
  });

  it("invitado y ruta con cuenta: solo la pila de entrada", () => {
    assert.deepEqual(names(stackForTarget(gate("guest", null), { name: "Notifications" })), ["MapHome"]);
  });

  it("ruta de personal sin permisos: solo la pila de entrada", () => {
    assert.deepEqual(names(stackForTarget(gate("signedIn", makeMe()), { name: "AdminSummary" })), ["MapHome"]);
  });

  it("con el alta incompleta, la pila de entrada es el paso que falta (la ruta pública va encima)", () => {
    const me = makeMe({ public_photo_key: null, public_photo_status: "pending" });
    assert.deepEqual(names(stackForTarget(gate("signedIn", me), target)), ["ProfilePhoto", "TripDetail"]);
  });

  it("sin decisión posible (sesión arrancando): solo la ruta", () => {
    assert.deepEqual(names(stackForTarget(gate("booting", null), target)), ["TripDetail"]);
  });
});
