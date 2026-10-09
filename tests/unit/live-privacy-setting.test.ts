import test from "node:test";
import assert from "node:assert/strict";
import type { Db } from "../../src/modules/live/common.js";
import { sharesPreciseLocation } from "../../src/modules/live/privacy-service.js";

/**
 * `sharesPreciseLocation` lee el ajuste «Compartir ubicación en viaje» de `comms` (`user_settings`). Sin base de datos:
 * se comprueba el valor por defecto, la ausencia de la tabla y que la existencia de la tabla solo se consulta hasta confirmarla.
 * Un único test porque el módulo recuerda (en memoria) que la tabla existe: el orden importa.
 */
type Plan = { tablePresent: boolean; rows: Array<{ value: boolean }> };

function fakeDb(plan: Plan): { db: Db; calls: string[] } {
  const calls: string[] = [];
  const db = {
    query: async (sql: string) => {
      calls.push(sql.includes("to_regclass") ? "to_regclass" : "setting");
      if (sql.includes("to_regclass")) return { rows: [{ present: plan.tablePresent }] };
      return { rows: plan.rows };
    }
  } as unknown as Db;
  return { db, calls };
}

test("sharesPreciseLocation: por defecto comparte; sin tabla comparte; solo un false explícito lo desactiva", async () => {
  // 1) comms sin desplegar (no existe user_settings): nadie ha podido desactivarlo → true, y la ausencia no se recuerda.
  const absent = fakeDb({ tablePresent: false, rows: [] });
  assert.equal(await sharesPreciseLocation(absent.db, "u1"), true);
  assert.equal(await sharesPreciseLocation(absent.db, "u1"), true);
  assert.deepEqual(absent.calls, ["to_regclass", "to_regclass"]);

  // 2) la tabla existe y la persona lo desactivó → false (se confirma la tabla y se lee el ajuste).
  const off = fakeDb({ tablePresent: true, rows: [{ value: false }] });
  assert.equal(await sharesPreciseLocation(off.db, "u2"), false);
  assert.deepEqual(off.calls, ["to_regclass", "setting"]);

  // 3) la existencia de la tabla ya está confirmada: solo se lee el ajuste.
  const on = fakeDb({ tablePresent: true, rows: [{ value: true }] });
  assert.equal(await sharesPreciseLocation(on.db, "u3"), true);
  assert.deepEqual(on.calls, ["setting"]);

  // 4) cualquier respuesta distinta de un false explícito (sin fila devuelta) cuenta como compartir.
  const empty = fakeDb({ tablePresent: true, rows: [] });
  assert.equal(await sharesPreciseLocation(empty.db, "u4"), true);
});
