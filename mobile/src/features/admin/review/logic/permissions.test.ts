// Pruebas del control de acceso por rol del panel (admin-review). La matriz es la de docs/contracts/trust.md §3.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AdminMe, AdminPermission, AdminResource, TrustStaffRole } from "@/api/types";
import { bookingsSource, canRead, canWrite, hasFinanceAccess, homeSections, permissionLines, permissionOf, rolesText, staffFirstName, staffInitial } from "./permissions";

const A: TrustStaffRole = "admin";
const V: TrustStaffRole = "verification_admin";
const F: TrustStaffRole = "finance_admin";
const S: TrustStaffRole = "support_admin";

const MATRIX: Record<AdminResource, { read: TrustStaffRole[]; write: TrustStaffRole[] }> = {
  summary: { read: [A, F, S], write: [] },
  finance_kpis: { read: [A, F], write: [] },
  review: { read: [A, V], write: [A, V] },
  evidence: { read: [A, V], write: [A, V] },
  bookings: { read: [A, F, S], write: [] },
  tariffs: { read: [A, F], write: [A, F] },
  tariff_activation: { read: [A], write: [A] },
  operations: { read: [A, F, S], write: [A] },
  alerts: { read: [A, F, S], write: [A, S] },
  audit: { read: [A], write: [] },
  legal: { read: [A], write: [A] },
  support: { read: [A, S], write: [A, S] },
};

function makeMe(roles: TrustStaffRole[], displayName: string | null = "Lucía Ramos"): AdminMe {
  const permissions = {} as Record<AdminResource, AdminPermission>;
  for (const [resource, grant] of Object.entries(MATRIX) as Array<[AdminResource, (typeof MATRIX)[AdminResource]]>) {
    permissions[resource] = roles.some((r) => grant.write.includes(r)) ? "write" : roles.some((r) => grant.read.includes(r)) ? "read" : "none";
  }
  return { userId: "u1", displayName, roles, permissions };
}

describe("permisos", () => {
  it("sin datos no se puede nada", () => {
    assert.equal(permissionOf(null, "review"), "none");
    assert.equal(canRead(undefined, "summary"), false);
    assert.equal(canWrite(null, "review"), false);
  });

  it("escribir implica leer, leer no implica escribir", () => {
    const verification = makeMe([V]);
    assert.equal(canRead(verification, "review"), true);
    assert.equal(canWrite(verification, "review"), true);
    const support = makeMe([S]);
    assert.equal(canRead(support, "summary"), true);
    assert.equal(canWrite(support, "summary"), false);
    assert.equal(canRead(support, "review"), false);
  });

  it("solo Administración y Finanzas tienen el módulo de devoluciones", () => {
    assert.equal(hasFinanceAccess(makeMe([A])), true);
    assert.equal(hasFinanceAccess(makeMe([F])), true);
    assert.equal(hasFinanceAccess(makeMe([V])), false);
    assert.equal(hasFinanceAccess(makeMe([S])), false);
  });

  it("la pantalla 39 sale de devoluciones para Finanzas, de reservas para Atención y no existe para Verificación", () => {
    assert.equal(bookingsSource(makeMe([A])), "refunds");
    assert.equal(bookingsSource(makeMe([F])), "refunds");
    assert.equal(bookingsSource(makeMe([S])), "bookings");
    assert.equal(bookingsSource(makeMe([V])), "none");
    assert.equal(bookingsSource(null), "none");
  });
});

describe("textos del acceso", () => {
  it("lista los roles en español, en el orden del panel", () => {
    assert.equal(rolesText(makeMe([V])), "Verificación");
    assert.equal(rolesText(makeMe([F, A])), "Administración y Finanzas");
    assert.equal(rolesText(makeMe([S, F, V])), "Verificación, Finanzas y Atención al cliente");
    assert.equal(rolesText(makeMe([])), "Sin roles de personal");
    assert.equal(rolesText(null), "Sin roles de personal");
  });

  it("la inicial y el nombre salen de `displayName`", () => {
    assert.equal(staffInitial(makeMe([A], "Administración MVC")), "A");
    assert.equal(staffInitial(makeMe([A], "  ñandú ")), "Ñ");
    assert.equal(staffInitial(makeMe([A], null)), "A");
    assert.equal(staffFirstName(makeMe([A], "Lucía Ramos")), "Lucía");
    assert.equal(staffFirstName(makeMe([A], null)), null);
  });

  it("describe las doce áreas", () => {
    const lines = permissionLines(makeMe([V]));
    assert.equal(lines.length, 12);
    assert.deepEqual(
      lines.filter((line) => line.permission !== "none").map((line) => [line.label, line.permissionLabel]),
      [
        ["Usuarios y revisión", "Puede editar"],
        ["Documentación privada", "Puede editar"],
      ],
    );
  });
});

describe("inicio del panel: solo lo que el rol puede ver", () => {
  const keys = (me: AdminMe): string[] => homeSections(me).map((section) => section.key);

  it("Administración lo ve todo", () => {
    assert.deepEqual(keys(makeMe([A])), ["summary", "users", "bookings", "tariffs", "payouts", "alerts", "support", "legal", "audit"]);
  });

  it("Verificación solo ve usuarios y revisión", () => {
    assert.deepEqual(keys(makeMe([V])), ["users"]);
  });

  it("Finanzas ve resumen, devoluciones, tarifas, liquidaciones y alertas", () => {
    assert.deepEqual(keys(makeMe([F])), ["summary", "bookings", "tariffs", "payouts", "alerts"]);
  });

  it("Atención al cliente ve resumen, reservas, alertas y consultas, pero no liquidaciones", () => {
    assert.deepEqual(keys(makeMe([S])), ["summary", "bookings", "tariffs", "alerts", "support"]);
  });

  it("cada tarjeta lleva la ruta de su pantalla", () => {
    const routes = Object.fromEntries(homeSections(makeMe([A])).map((section) => [section.key, section.route]));
    assert.equal(routes["users"], "AdminUsersReview");
    assert.equal(routes["bookings"], "AdminBookingsRefunds");
    assert.equal(routes["summary"], "AdminSummary");
  });

  it("sin permisos no hay secciones", () => {
    assert.deepEqual(homeSections(makeMe([])), []);
    assert.deepEqual(homeSections(null), []);
  });
});
