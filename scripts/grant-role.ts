/**
 * Concede, retira o lista roles de PERSONAL por teléfono. Es la única vía para dar acceso al panel de administración:
 * no existe contraseña maestra, endpoint de arranque ni puerta trasera; hace falta acceso a la base de datos.
 *
 *   DATABASE_URL=postgres://… npx tsx scripts/grant-role.ts grant  +34600111222 verification_admin
 *   DATABASE_URL=postgres://… npx tsx scripts/grant-role.ts revoke +34600111222 verification_admin
 *   DATABASE_URL=postgres://… npx tsx scripts/grant-role.ts list [+34600111222]
 *
 * Opciones: --dry-run (no escribe nada) · --force (permite retirar el último admin activo).
 * Roles de personal: admin, verification_admin, finance_admin, support_admin. `passenger` y `driver` NO se gestionan aquí.
 * Cada cambio deja un evento `admin.role.granted` / `admin.role.revoked` en audit_events (sin teléfono; actor nulo, vía CLI).
 */
import os from "node:os";
import { pathToFileURL } from "node:url";
import type { Pool } from "pg";
import { normalizeE164 } from "../src/auth/phone.js";
import { writeAudit } from "../src/lib/audit.js";
import { STAFF_ROLES, type StaffRole, isStaffRole } from "../src/modules/trust/rbac.js";
import { maskPhone } from "../src/modules/trust/common.js";

export type GrantRoleResult = {
  ok: boolean;
  /** true si se escribió algo (o se habría escrito, en --dry-run). */
  changed: boolean;
  code: string;
  message: string;
  userId?: string;
  roles?: string[];
};

export type GrantRoleOptions = { dryRun?: boolean; force?: boolean };

function operatorName(): string {
  try {
    return os.userInfo().username;
  } catch {
    return "desconocido";
  }
}

function fail(code: string, message: string): GrantRoleResult {
  return { ok: false, changed: false, code, message };
}

function parseStaffRole(raw: string): StaffRole | GrantRoleResult {
  if (isStaffRole(raw)) return raw;
  if (raw === "passenger" || raw === "driver") {
    return fail("ROLE_NOT_STAFF", `«${raw}» no es un rol de personal: lo elige cada persona en la app. Roles de personal: ${STAFF_ROLES.join(", ")}.`);
  }
  return fail("ROLE_UNKNOWN", `Rol desconocido «${raw}». Roles de personal: ${STAFF_ROLES.join(", ")}.`);
}

function parsePhone(raw: string): string | GrantRoleResult {
  try {
    return normalizeE164(raw);
  } catch {
    return fail("PHONE_INVALID", "El teléfono debe estar en formato E.164, por ejemplo +34600111222.");
  }
}

type UserRow = { id: string; status: string; phone_e164: string | null };

async function findUser(pool: Pool, phone: string): Promise<UserRow | null> {
  const found = await pool.query<UserRow>(`select id, status::text as status, phone_e164 from app_users where phone_e164 = $1`, [phone]);
  return found.rows[0] ?? null;
}

export async function grantRole(pool: Pool, phoneRaw: string, roleRaw: string, options: GrantRoleOptions = {}): Promise<GrantRoleResult> {
  const role = parseStaffRole(roleRaw);
  if (typeof role !== "string") return role;
  const phone = parsePhone(phoneRaw);
  if (typeof phone !== "string") return phone;

  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`select pg_advisory_xact_lock(hashtext('trust_staff_roles'))`);
    const found = await client.query<UserRow>(
      `select id, status::text as status, phone_e164 from app_users where phone_e164 = $1 for update`,
      [phone]
    );
    const user = found.rows[0];
    if (!user) {
      await client.query("rollback");
      return fail("USER_NOT_FOUND", `No existe ninguna cuenta con el teléfono ${maskPhone(phone)}. La persona debe registrarse primero en la app.`);
    }
    if (user.status !== "active") {
      await client.query("rollback");
      return fail("USER_NOT_ACTIVE", `La cuenta ${maskPhone(phone)} no está activa (estado: ${user.status}).`);
    }
    const has = await client.query(`select 1 from user_roles where user_id = $1 and role = $2::user_role`, [user.id, role]);
    if (has.rowCount) {
      await client.query("rollback");
      return { ok: true, changed: false, code: "ALREADY_GRANTED", message: `${maskPhone(phone)} ya tenía el rol ${role}.`, userId: user.id };
    }
    if (options.dryRun) {
      await client.query("rollback");
      return { ok: true, changed: true, code: "DRY_RUN", message: `[simulación] Se concedería el rol ${role} a ${maskPhone(phone)}.`, userId: user.id };
    }
    await client.query(`insert into user_roles(user_id, role) values($1, $2::user_role)`, [user.id, role]);
    await writeAudit(client, {
      actorUserId: null,
      action: "admin.role.granted",
      entityType: "user",
      entityId: user.id,
      metadata: { role, via: "cli", operator: operatorName() }
    });
    await client.query("commit");
    return { ok: true, changed: true, code: "GRANTED", message: `Rol ${role} concedido a ${maskPhone(phone)}.`, userId: user.id };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function revokeRole(pool: Pool, phoneRaw: string, roleRaw: string, options: GrantRoleOptions = {}): Promise<GrantRoleResult> {
  const role = parseStaffRole(roleRaw);
  if (typeof role !== "string") return role;
  const phone = parsePhone(phoneRaw);
  if (typeof phone !== "string") return phone;

  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`select pg_advisory_xact_lock(hashtext('trust_staff_roles'))`);
    const found = await client.query<UserRow>(
      `select id, status::text as status, phone_e164 from app_users where phone_e164 = $1 for update`,
      [phone]
    );
    const user = found.rows[0];
    if (!user) {
      await client.query("rollback");
      return fail("USER_NOT_FOUND", `No existe ninguna cuenta con el teléfono ${maskPhone(phone)}.`);
    }
    const has = await client.query(`select 1 from user_roles where user_id = $1 and role = $2::user_role`, [user.id, role]);
    if (!has.rowCount) {
      await client.query("rollback");
      return { ok: true, changed: false, code: "NOT_GRANTED", message: `${maskPhone(phone)} no tenía el rol ${role}.`, userId: user.id };
    }
    if (role === "admin" && !options.force) {
      const others = await client.query<{ n: string }>(
        `select count(*)::text as n
           from user_roles ur join app_users u on u.id = ur.user_id
          where ur.role = 'admin' and u.status = 'active' and ur.user_id <> $1`,
        [user.id]
      );
      if (Number(others.rows[0]?.n ?? 0) === 0) {
        await client.query("rollback");
        return fail("LAST_ADMIN", "Es el último admin activo: retirarlo dejaría el panel sin administración. Concede antes el rol a otra cuenta o usa --force.");
      }
    }
    if (options.dryRun) {
      await client.query("rollback");
      return { ok: true, changed: true, code: "DRY_RUN", message: `[simulación] Se retiraría el rol ${role} a ${maskPhone(phone)}.`, userId: user.id };
    }
    await client.query(`delete from user_roles where user_id = $1 and role = $2::user_role`, [user.id, role]);
    await writeAudit(client, {
      actorUserId: null,
      action: "admin.role.revoked",
      entityType: "user",
      entityId: user.id,
      metadata: { role, via: "cli", operator: operatorName(), forced: Boolean(options.force) }
    });
    await client.query("commit");
    return { ok: true, changed: true, code: "REVOKED", message: `Rol ${role} retirado a ${maskPhone(phone)}. Las sesiones abiertas pierden el acceso de inmediato (los roles se leen en cada petición).`, userId: user.id };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function listStaffRoles(pool: Pool, phoneRaw?: string): Promise<GrantRoleResult & { entries: Array<{ userId: string; phone: string | null; status: string; roles: string[] }> }> {
  let phone: string | null = null;
  if (phoneRaw !== undefined) {
    const parsed = parsePhone(phoneRaw);
    if (typeof parsed !== "string") return { ...parsed, entries: [] };
    phone = parsed;
  }
  const rows = await pool.query<{ id: string; phone_e164: string | null; status: string; roles: string[] }>(
    `select u.id, u.phone_e164, u.status::text as status,
            array_agg(ur.role::text order by ur.role::text) filter (where ur.role::text = any($1::text[])) as roles
       from app_users u
       left join user_roles ur on ur.user_id = u.id
      where ($2::text is null or u.phone_e164 = $2::text)
      group by u.id
     having count(*) filter (where ur.role::text = any($1::text[])) > 0 or $2::text is not null
      order by u.created_at, u.id`,
    [[...STAFF_ROLES], phone]
  );
  const entries = rows.rows.map(r => ({ userId: r.id, phone: maskPhone(r.phone_e164), status: r.status, roles: r.roles ?? [] }));
  return { ok: true, changed: false, code: "LISTED", message: `${entries.length} cuenta(s).`, entries };
}

/* ───────── Línea de comandos ───────── */

const USAGE = `Uso:
  npx tsx scripts/grant-role.ts grant  <teléfono E.164> <rol> [--dry-run]
  npx tsx scripts/grant-role.ts revoke <teléfono E.164> <rol> [--dry-run] [--force]
  npx tsx scripts/grant-role.ts list   [<teléfono E.164>]
Roles de personal: ${STAFF_ROLES.join(", ")}`;

export type CliIo = { out: (text: string) => void; err: (text: string) => void };

/** Ejecuta un comando y devuelve el código de salida (0 correcto · 1 error · 2 uso). */
export async function runCli(argv: readonly string[], pool: Pool, io: CliIo): Promise<number> {
  const flags = new Set(argv.filter(a => a.startsWith("--")));
  const positional = argv.filter(a => !a.startsWith("--"));
  const unknown = [...flags].filter(f => f !== "--dry-run" && f !== "--force");
  if (unknown.length > 0) {
    io.err(`Opción desconocida: ${unknown.join(", ")}\n${USAGE}`);
    return 2;
  }
  const [command, phone, role] = positional;
  const options: GrantRoleOptions = { dryRun: flags.has("--dry-run"), force: flags.has("--force") };

  if (command === "list" && positional.length <= 2) {
    const result = await listStaffRoles(pool, phone);
    if (!result.ok) {
      io.err(result.message);
      return 1;
    }
    for (const e of result.entries) io.out(`${e.userId}  ${e.phone ?? "-"}  ${e.status}  ${e.roles.join(",") || "(sin roles de personal)"}`);
    io.out(result.message);
    return 0;
  }
  if ((command === "grant" || command === "revoke") && phone && role && positional.length === 3) {
    const result = command === "grant" ? await grantRole(pool, phone, role, options) : await revokeRole(pool, phone, role, options);
    (result.ok ? io.out : io.err)(result.message);
    return result.ok ? 0 : 1;
  }
  io.err(USAGE);
  return 2;
}

async function main(): Promise<void> {
  const { pool } = await import("../src/db/pool.js");
  try {
    process.exitCode = await runCli(process.argv.slice(2), pool, {
      out: text => process.stdout.write(`${text}\n`),
      err: text => process.stderr.write(`${text}\n`)
    });
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
