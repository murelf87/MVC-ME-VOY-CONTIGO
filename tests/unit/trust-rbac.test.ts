import test from "node:test";
import assert from "node:assert/strict";
import type { UserRole } from "../../src/auth/session.js";
import {
  ADMIN_MATRIX,
  ADMIN_RESOURCES,
  STAFF_ROLES,
  isStaffRole,
  normalizeRoles,
  permissionFor,
  permissionsFor,
  permits,
  staffRolesOf
} from "../../src/modules/trust/rbac.js";

const none = Object.fromEntries(ADMIN_RESOURCES.map(r => [r, "none"]));

test("trust/rbac: la matriz cubre cada recurso y quien escribe también puede leer", () => {
  assert.equal(ADMIN_RESOURCES.length, 12);
  assert.deepEqual(Object.keys(ADMIN_MATRIX).sort(), [...ADMIN_RESOURCES].sort());
  for (const resource of ADMIN_RESOURCES) {
    const { read, write } = ADMIN_MATRIX[resource];
    for (const role of write) assert.ok(read.includes(role), `${resource}: ${role} escribe pero no lee`);
    for (const role of [...read, ...write]) assert.ok(isStaffRole(role), `${resource}: ${role} no es un rol de personal`);
  }
});

test("trust/rbac: ni pasajeros ni conductores tienen ningún permiso de administración", () => {
  for (const roles of [[], ["passenger"], ["driver"], ["passenger", "driver"]] as UserRole[][]) {
    assert.deepEqual(permissionsFor(roles), none);
  }
});

test("trust/rbac: admin lee todo y escribe donde la matriz lo permite", () => {
  const p = permissionsFor(["admin"]);
  assert.deepEqual(p, {
    summary: "read", finance_kpis: "read", review: "write", evidence: "write", bookings: "read", tariffs: "write",
    tariff_activation: "write", operations: "write", alerts: "write", audit: "read", legal: "write", support: "write"
  });
});

test("trust/rbac: verification_admin solo revisa identidad y evidencias", () => {
  const p = permissionsFor(["verification_admin"]);
  assert.deepEqual(p, { ...none, review: "write", evidence: "write" });
});

test("trust/rbac: finance_admin ve el resumen con finanzas y edita borradores de tarifa, pero NO activa", () => {
  const p = permissionsFor(["finance_admin"]);
  assert.deepEqual(p, {
    ...none, summary: "read", finance_kpis: "read", bookings: "read", tariffs: "write", operations: "read", alerts: "read"
  });
  assert.equal(p.tariff_activation, "none");
  assert.equal(p.audit, "none");
  assert.equal(p.review, "none");
});

test("trust/rbac: support_admin atiende consultas y alertas, sin finanzas ni tarifas", () => {
  const p = permissionsFor(["support_admin"]);
  assert.deepEqual(p, { ...none, summary: "read", bookings: "read", operations: "read", alerts: "write", support: "write" });
  assert.equal(p.finance_kpis, "none");
  assert.equal(p.tariffs, "none");
});

test("trust/rbac: activar tarifas, ver la auditoría y gestionar documentos legales son exclusivos de admin", () => {
  for (const resource of ["tariff_activation", "audit", "legal"] as const) {
    assert.deepEqual(ADMIN_MATRIX[resource].read, ["admin"], resource);
    for (const role of STAFF_ROLES) {
      if (role !== "admin") assert.equal(permissionFor([role], resource), "none", `${role} → ${resource}`);
    }
  }
});

test("trust/rbac: con varios roles prevalece el permiso más alto", () => {
  assert.equal(permissionFor(["finance_admin", "support_admin"], "alerts"), "write"); // F lee, S escribe
  assert.equal(permissionFor(["finance_admin", "support_admin"], "operations"), "read");
  assert.equal(permissionFor(["verification_admin", "finance_admin"], "tariffs"), "write");
  assert.equal(permissionFor(["driver", "passenger", "verification_admin"], "review"), "write");
});

test("trust/rbac: permits(): escribir implica leer, leer no implica escribir, none no permite nada", () => {
  assert.equal(permits("write", "write"), true);
  assert.equal(permits("write", "read"), true);
  assert.equal(permits("read", "read"), true);
  assert.equal(permits("read", "write"), false);
  assert.equal(permits("none", "read"), false);
  assert.equal(permits("none", "write"), false);
});

test("trust/rbac: staffRolesOf conserva el orden canónico y descarta roles de usuario", () => {
  assert.deepEqual(staffRolesOf(["driver", "support_admin", "passenger", "admin"]), ["admin", "support_admin"]);
  assert.deepEqual(staffRolesOf(["passenger"]), []);
  assert.deepEqual([...STAFF_ROLES], ["admin", "verification_admin", "finance_admin", "support_admin"]);
});

test("trust/rbac: isStaffRole solo acepta los cuatro roles de personal", () => {
  for (const role of STAFF_ROLES) assert.equal(isStaffRole(role), true);
  for (const role of ["passenger", "driver", "root", "superadmin", "master", "", "ADMIN"]) assert.equal(isStaffRole(role), false, role);
});

test("trust/rbac: normalizeRoles entiende el array real y el literal de Postgres que entrega pg para enumerados", () => {
  assert.deepEqual(normalizeRoles(["driver", "passenger"]), ["driver", "passenger"]);
  assert.deepEqual(normalizeRoles("{driver,passenger}"), ["driver", "passenger"]);
  assert.deepEqual(normalizeRoles("{driver, admin}"), ["driver", "admin"]);
  assert.deepEqual(normalizeRoles('{"driver","verification_admin"}'), ["driver", "verification_admin"]);
  assert.deepEqual(normalizeRoles("{}"), []);
  assert.deepEqual(normalizeRoles(""), []);
  assert.deepEqual(normalizeRoles("passenger"), ["passenger"]);
});

test("trust/rbac: normalizeRoles descarta valores desconocidos y duplicados (nunca concede permisos por un valor raro)", () => {
  assert.deepEqual(normalizeRoles(["admin", "root", "superadmin", "admin"]), ["admin"]);
  assert.deepEqual(normalizeRoles("{admin,}"), ["admin"]);
  assert.deepEqual(normalizeRoles("{ADMIN}"), []);
  for (const junk of [null, undefined, 5, true, {}, [1, 2], [null], () => "admin"]) {
    assert.deepEqual(normalizeRoles(junk), [], String(junk));
  }
  assert.equal(permissionFor(normalizeRoles("{root,master}"), "audit"), "none");
});
