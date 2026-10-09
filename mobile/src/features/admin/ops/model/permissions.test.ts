// Pruebas de la matriz de permisos del personal (admin-ops), espejo de src/modules/trust/rbac.ts.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AdminMe } from "@/api/types";
import { accessFromMe, accessFromRoles, canReadTab, canUsePayouts, firstAllowedTab, noAccess, permissionFromRoles, permissionsFromRoles } from "./permissions";

describe("matriz RBAC", () => {
  it("admin lo ve y lo escribe todo menos auditoría (solo lectura)", () => {
    assert.equal(permissionFromRoles(["admin"], "tariffs"), "write");
    assert.equal(permissionFromRoles(["admin"], "tariff_activation"), "write");
    assert.equal(permissionFromRoles(["admin"], "operations"), "write");
    assert.equal(permissionFromRoles(["admin"], "audit"), "read");
    assert.equal(permissionFromRoles(["admin"], "legal"), "write");
    assert.equal(permissionFromRoles(["admin"], "support"), "write");
  });
  it("finanzas: tarifas sí, activar no, operaciones solo lectura, sin auditoría ni legal ni atención", () => {
    const a = accessFromRoles(["finance_admin"], null);
    assert.equal(a.readTariffs && a.writeTariffs, true);
    assert.equal(a.activateTariffs, false);
    assert.equal(a.readOperations, true);
    assert.equal(a.writeOperations, false);
    assert.equal(a.readAudit, false);
    assert.equal(a.readLegal, false);
    assert.equal(a.readSupport, false);
    assert.equal(a.payouts, true);
  });
  it("atención: cola y alertas sí, tarifas no, operaciones solo lectura, sin liquidaciones", () => {
    const a = accessFromRoles(["support_admin"], null);
    assert.equal(a.readSupport && a.writeSupport, true);
    assert.equal(a.readAlerts && a.writeAlerts, true);
    assert.equal(a.readTariffs, false);
    assert.equal(a.readOperations, true);
    assert.equal(a.writeOperations, false);
    assert.equal(a.payouts, false);
  });
  it("verificación no tiene acceso a nada de esto", () => {
    const a = accessFromRoles(["verification_admin"], null);
    for (const tab of ["tariffs", "operations", "alerts", "audit"] as const) assert.equal(canReadTab(a, tab), false);
    assert.equal(a.readSupport, false);
    assert.equal(a.payouts, false);
  });
  it("ignora roles que no son del personal", () => {
    const a = accessFromRoles(["passenger", "driver"], null);
    assert.deepEqual(a.roles, []);
    assert.equal(a.readTariffs, false);
    assert.deepEqual(permissionsFromRoles(["passenger"]).summary, "none");
  });
  it("liquidaciones solo para finanzas y administración", () => {
    assert.equal(canUsePayouts(["admin"]), true);
    assert.equal(canUsePayouts(["finance_admin"]), true);
    assert.equal(canUsePayouts(["support_admin", "verification_admin"]), false);
  });
});

describe("acceso confirmado por el servidor", () => {
  it("manda lo que devuelve GET /v1/admin/me", () => {
    const me: AdminMe = {
      userId: "u1",
      displayName: "Administración MVC",
      roles: ["support_admin"],
      permissions: { ...permissionsFromRoles(["support_admin"]), tariffs: "read" },
    };
    const a = accessFromMe(me);
    assert.equal(a.confirmed, true);
    assert.equal(a.readTariffs, true);
    assert.equal(a.writeTariffs, false);
    assert.equal(a.displayName, "Administración MVC");
  });
  it("sin acceso: nada permitido", () => {
    const a = noAccess();
    assert.equal(a.readTariffs || a.readOperations || a.readAlerts || a.readAudit || a.readLegal || a.readSupport || a.payouts, false);
  });
});

describe("pestañas", () => {
  it("la pestaña pedida si se puede leer; si no, la primera permitida", () => {
    const support = accessFromRoles(["support_admin"], null);
    assert.equal(firstAllowedTab(support, "tariffs"), "operations");
    assert.equal(firstAllowedTab(support, "alerts"), "alerts");
    const admin = accessFromRoles(["admin"], null);
    assert.equal(firstAllowedTab(admin, "audit"), "audit");
    const none = accessFromRoles([], null);
    assert.equal(firstAllowedTab(none, "tariffs"), "tariffs");
  });
});
