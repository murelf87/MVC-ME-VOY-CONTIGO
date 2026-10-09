/**
 * Base de datos en memoria: colecciones, índices únicos (parciales), transacciones con deshacer, instantáneas, ajustes,
 * eventos, tareas y azar determinista.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createPreviewDb, isUniqueViolation, SNAPSHOT_VERSION } from "./db";
import { stableUuid, PreviewIds, STRICT_UUID_RE, UUID_RE } from "./ids";

interface Thing {
  id: string;
  n: number;
  tag?: string | null;
  status?: string;
}

describe("Collection", () => {
  it("guarda copias congeladas: ni quien inserta ni quien lee puede mutar la fila guardada", () => {
    const db = createPreviewDb();
    const things = db.collection<Thing>("things");
    const original: Thing = { id: "a", n: 1 };
    const stored = things.insert(original);
    original.n = 99;
    assert.equal(things.get("a")?.n, 1);
    try {
      (stored as Thing).n = 5; // en modo estricto lanza TypeError; en sloppy se ignora: en ambos casos no cambia
    } catch {
      // esperado en modo estricto
    }
    assert.equal(things.get("a")?.n, 1);
    assert.ok(Object.isFrozen(stored));
  });

  it("la clave primaria repetida es una violación de unicidad (23505)", () => {
    const db = createPreviewDb();
    const things = db.collection<Thing>("things");
    things.insert({ id: "a", n: 1 });
    try {
      things.insert({ id: "a", n: 2 });
      assert.fail("debía fallar");
    } catch (error) {
      assert.ok(isUniqueViolation(error));
      assert.match((error as Error).message, /duplicate key value violates unique constraint "things_pkey"/);
    }
    assert.equal(things.size, 1);
  });

  it("índices únicos: rechazan duplicados, ignoran las filas con clave nula y se liberan al borrar o actualizar", () => {
    const db = createPreviewDb();
    const things = db.collection<Thing>("things").unique("tag", (r) => r.tag);
    things.insert({ id: "a", n: 1, tag: "x" });
    things.insert({ id: "b", n: 2, tag: null });
    things.insert({ id: "c", n: 3 });
    assert.throws(() => things.insert({ id: "d", n: 4, tag: "x" }), /things_tag/);
    things.update("a", { tag: "y" });
    things.insert({ id: "d", n: 4, tag: "x" });
    things.delete("d");
    things.insert({ id: "e", n: 5, tag: "x" });
    assert.equal(things.count(), 4);
  });

  it("índice único PARCIAL: solo cuenta las filas que devuelven clave (como un índice con WHERE)", () => {
    const db = createPreviewDb();
    const reqs = db.collection<Thing>("reqs").unique("open", (r) => (r.status === "open" ? r.tag : null));
    reqs.insert({ id: "1", n: 0, tag: "t", status: "open" });
    assert.throws(() => reqs.insert({ id: "2", n: 0, tag: "t", status: "open" }));
    reqs.update("1", { status: "closed" });
    reqs.insert({ id: "2", n: 0, tag: "t", status: "open" });
    reqs.insert({ id: "3", n: 0, tag: "t", status: "closed" });
    assert.equal(reqs.count((r) => r.status === "open"), 1);
  });

  it("update que choca con un índice deja la fila y los índices intactos", () => {
    const db = createPreviewDb();
    const things = db.collection<Thing>("things").unique("tag", (r) => r.tag);
    things.insert({ id: "a", n: 1, tag: "x" });
    things.insert({ id: "b", n: 2, tag: "y" });
    assert.throws(() => things.update("b", { tag: "x" }));
    assert.equal(things.get("b")?.tag, "y");
    assert.throws(() => things.insert({ id: "c", n: 3, tag: "y" }), "«y» sigue reservado por b");
    things.insert({ id: "d", n: 4, tag: "z" });
  });

  it("update no puede cambiar la clave primaria ni actualizar filas inexistentes", () => {
    const db = createPreviewDb();
    const things = db.collection<Thing>("things");
    things.insert({ id: "a", n: 1 });
    assert.throws(() => things.update("a", { id: "z" }), /no se puede cambiar la clave primaria/);
    assert.throws(() => things.update("nada", { n: 1 }), /no existe la fila/);
  });

  it("update acepta una función y put inserta o sustituye", () => {
    const db = createPreviewDb();
    const things = db.collection<Thing>("things");
    things.insert({ id: "a", n: 1 });
    things.update("a", (row) => ({ n: row.n + 10 }));
    assert.equal(things.get("a")?.n, 11);
    things.put({ id: "a", n: 2 });
    things.put({ id: "b", n: 3 });
    assert.deepEqual(things.all().map((r) => [r.id, r.n]), [["a", 2], ["b", 3]]);
  });

  it("find / filter / count / deleteWhere", () => {
    const db = createPreviewDb();
    const things = db.collection<Thing>("things");
    for (let i = 1; i <= 5; i += 1) things.insert({ id: `t${i}`, n: i });
    assert.equal(things.find((r) => r.n === 3)?.id, "t3");
    assert.equal(things.filter((r) => r.n > 2).length, 3);
    assert.equal(things.count((r) => r.n % 2 === 0), 2);
    assert.equal(things.deleteWhere((r) => r.n > 3), 2);
    assert.equal(things.size, 3);
  });

  it("se puede usar otra clave primaria y los slices crean colecciones al vuelo", () => {
    const db = createPreviewDb();
    const byUser = db.collection<{ user_id: string; v: number }>("per_user", { pk: "user_id" });
    byUser.insert({ user_id: "u1", v: 1 });
    assert.equal(db.collection("per_user", { pk: "user_id" }), byUser, "misma instancia");
    assert.throws(() => db.collection("per_user"), /ya existe con otra clave primaria/);
    assert.ok(db.collectionNames().includes("per_user"));
  });
});

describe("transacciones", () => {
  it("confirman si el callback termina bien", () => {
    const db = createPreviewDb();
    const things = db.collection<Thing>("things");
    const out = db.tx(() => {
      things.insert({ id: "a", n: 1 });
      return "hecho";
    });
    assert.equal(out, "hecho");
    assert.equal(things.size, 1);
  });

  it("deshacen inserciones, actualizaciones y borrados (con sus índices) si el callback lanza", () => {
    const db = createPreviewDb();
    const things = db.collection<Thing>("things").unique("tag", (r) => r.tag);
    things.insert({ id: "a", n: 1, tag: "x" });
    things.insert({ id: "b", n: 2, tag: "y" });
    assert.throws(() =>
      db.tx(() => {
        things.insert({ id: "c", n: 3, tag: "z" });
        things.update("a", { n: 100, tag: "w" });
        things.delete("b");
        throw new Error("falla a mitad");
      })
    );
    assert.deepEqual(things.all().map((r) => [r.id, r.n, r.tag]), [["a", 1, "x"], ["b", 2, "y"]]);
    assert.throws(() => things.insert({ id: "d", n: 4, tag: "x" }), "el índice vuelve a reservar «x»");
    things.insert({ id: "e", n: 5, tag: "z" });
    things.insert({ id: "f", n: 6, tag: "w" });
  });

  it("las anidadas se deshacen con la externa aunque la interna ya hubiera terminado", () => {
    const db = createPreviewDb();
    const things = db.collection<Thing>("things");
    assert.throws(() =>
      db.tx(() => {
        db.tx(() => {
          things.insert({ id: "a", n: 1 });
        });
        things.insert({ id: "b", n: 2 });
        throw new Error("fuera");
      })
    );
    assert.equal(things.size, 0);
  });

  it("una interna que falla y se captura NO deshace lo anterior de la externa", () => {
    const db = createPreviewDb();
    const things = db.collection<Thing>("things");
    db.tx(() => {
      things.insert({ id: "a", n: 1 });
      try {
        db.tx(() => {
          things.insert({ id: "b", n: 2 });
          throw new Error("interna");
        });
      } catch {
        // se ignora
      }
    });
    assert.deepEqual(things.all().map((r) => r.id), ["a"]);
  });

  it("no admite funciones asíncronas (se confundiría el deshacer)", () => {
    const db = createPreviewDb();
    assert.throws(() => db.tx((async () => 1) as unknown as () => number), /solo admite funciones síncronas/);
  });
});

describe("instantáneas, ajustes y reinicio", () => {
  it("snapshot/restore recupera colecciones, ajustes, objetos, azar y reloj, y es serializable a JSON", () => {
    const db = createPreviewDb({ seed: "snap" });
    const things = db.collection<Thing>("things").unique("tag", (r) => r.tag);
    things.insert({ id: "a", n: 1, tag: "x" });
    db.setSetting("k", { a: [1, 2, { b: null }] });
    db.blobs.put("clave/obj", new Uint8Array([1, 2, 3]), "image/png", db.nowMs());
    const idBefore = db.ids.uuid();
    db.clock.advance(5000);
    const snapshot = JSON.parse(JSON.stringify(db.snapshot())) as ReturnType<typeof db.snapshot>;
    assert.equal(snapshot.version, SNAPSHOT_VERSION);
    const next = db.ids.uuid();

    const other = createPreviewDb({ seed: "otra" });
    other.collection<Thing>("things").unique("tag", (r) => r.tag);
    other.restore(snapshot);
    assert.deepEqual(other.collection<Thing>("things").all(), [{ id: "a", n: 1, tag: "x" }]);
    assert.deepEqual(other.getSetting("k"), { a: [1, 2, { b: null }] });
    assert.equal(other.blobs.has("clave/obj"), true);
    assert.equal(other.nowMs(), db.nowMs());
    assert.equal(other.ids.uuid(), next, "el azar continúa donde se guardó");
    assert.notEqual(idBefore, next);
    assert.throws(() => other.collection<Thing>("things").insert({ id: "b", n: 2, tag: "x" }), "los índices se reconstruyen");
  });

  it("restore rechaza una versión desconocida", () => {
    const db = createPreviewDb();
    const snapshot = { ...db.snapshot(), version: 999 };
    assert.throws(() => db.restore(snapshot), /Versión de instantánea no soportada/);
  });

  it("ajustes clave/valor", () => {
    const db = createPreviewDb();
    assert.equal(db.getSetting("x"), undefined);
    db.setSetting("x", 5);
    assert.equal(db.getSetting("x"), 5);
    db.deleteSetting("x");
    assert.equal(db.getSetting("x"), undefined);
  });

  it("onChange y getRevision avisan de cada escritura", () => {
    const db = createPreviewDb();
    const things = db.collection<Thing>("things");
    let calls = 0;
    const off = db.onChange(() => {
      calls += 1;
    });
    const before = db.getRevision();
    things.insert({ id: "a", n: 1 });
    things.update("a", { n: 2 });
    things.delete("a");
    assert.equal(calls, 3);
    assert.equal(db.getRevision(), before + 3);
    off();
    things.insert({ id: "b", n: 1 });
    assert.equal(calls, 3);
  });

  it("resetEmpty vacía el mundo, reinicia el azar y conserva el modo del reloj", () => {
    const db = createPreviewDb({ seed: "uno", clockMode: "running" });
    const things = db.collection<Thing>("things");
    things.insert({ id: "a", n: 1 });
    db.setSetting("k", 1);
    const first = db.ids.uuid();
    db.resetEmpty({ seed: "uno", now: "2026-10-05T08:00:00+02:00" });
    assert.equal(things.size, 0);
    assert.equal(db.getSetting("k"), undefined);
    assert.equal(db.ids.uuid(), first, "misma semilla, misma secuencia");
    assert.equal(db.clock.getMode(), "running");
  });
});

describe("eventos y tareas", () => {
  it("los eventos son síncronos, se pueden cancelar y un fallo del manejador deshace la transacción", () => {
    const db = createPreviewDb();
    const things = db.collection<Thing>("things");
    const seen: unknown[] = [];
    const off = db.events.on("ride_request.created", (payload) => seen.push(payload));
    db.events.on("ride_request.created", () => {
      throw new Error("el manejador falla");
    });
    assert.equal(db.events.count("ride_request.created"), 2);
    assert.throws(() =>
      db.tx(() => {
        things.insert({ id: "a", n: 1 });
        db.events.emit("ride_request.created", { id: 1 });
      })
    );
    assert.equal(things.size, 0, "como un notify() fallido dentro de la transacción del backend");
    assert.deepEqual(seen, [{ id: 1 }]);
    off();
    assert.equal(db.events.count("ride_request.created"), 1);
  });

  it("las tareas se ejecutan por nombre, sin reentrada, y se pueden retirar", () => {
    const db = createPreviewDb();
    let runs = 0;
    db.jobs.register("a", (d) => {
      runs += 1;
      d.jobs.run(d); // reentrada: se ignora
    });
    db.jobs.run(db);
    assert.equal(runs, 1);
    db.jobs.register("a", () => {
      runs += 10;
    });
    db.jobs.run(db);
    assert.equal(runs, 11, "registrar con el mismo nombre sustituye");
    db.jobs.unregister("a");
    db.jobs.run(db);
    assert.equal(runs, 11);
    assert.deepEqual(db.jobs.names(), []);
  });

  it("una tarea que falla no deja la bandera de ejecución puesta", () => {
    const db = createPreviewDb();
    let fail = true;
    let runs = 0;
    db.jobs.register("x", () => {
      runs += 1;
      if (fail) throw new Error("x");
    });
    assert.throws(() => db.jobs.run(db));
    fail = false;
    db.jobs.run(db);
    assert.equal(runs, 2);
  });
});

describe("azar e identificadores deterministas", () => {
  it("misma semilla, misma secuencia; semillas distintas, secuencias distintas", () => {
    const a = new PreviewIds("s1");
    const b = new PreviewIds("s1");
    const c = new PreviewIds("s2");
    const seqA = [a.uuid(), a.uuid(), a.hex(12), a.digits(6), a.sessionToken()];
    const seqB = [b.uuid(), b.uuid(), b.hex(12), b.digits(6), b.sessionToken()];
    assert.deepEqual(seqA, seqB);
    assert.notEqual(c.uuid(), seqA[0]);
  });

  it("los uuid son v4 estrictos y los códigos de 6 cifras nunca empiezan por 0", () => {
    const ids = new PreviewIds("formas");
    for (let i = 0; i < 200; i += 1) {
      const uuid = ids.uuid();
      assert.match(uuid, STRICT_UUID_RE);
      assert.match(uuid, UUID_RE);
      assert.match(ids.digits(6), /^[1-9]\d{5}$/);
    }
    assert.match(ids.sessionToken(), /^mvc_sess_[A-Za-z0-9_-]{43}$/);
    assert.equal(ids.hex(7).length, 7);
  });

  it("requestId cuenta en base 36 como el generador de Fastify y no consume azar", () => {
    const ids = new PreviewIds("req");
    const control = new PreviewIds("req");
    const out = Array.from({ length: 37 }, () => ids.requestId());
    assert.deepEqual(out.slice(0, 3), ["req-1", "req-2", "req-3"]);
    assert.equal(out[9], "req-a");
    assert.equal(out[34], "req-z");
    assert.equal(out[35], "req-10");
    assert.equal(ids.uuid(), control.uuid());
  });

  it("stableUuid es independiente del orden de creación y distinto según el nombre", () => {
    assert.equal(stableUuid("user:ana"), stableUuid("user:ana"));
    assert.notEqual(stableUuid("user:ana"), stableUuid("user:miguel"));
    assert.match(stableUuid("lo-que-sea"), STRICT_UUID_RE);
  });

  it("seq cuenta por nombre y restore recupera el estado", () => {
    const ids = new PreviewIds("seq");
    assert.equal(ids.seq("msg"), 1);
    assert.equal(ids.seq("msg"), 2);
    assert.equal(ids.seq("otra"), 1);
    const state = ids.state();
    ids.seq("msg");
    ids.restore(state);
    assert.equal(ids.seq("msg"), 3);
  });

  it("int y pick respetan los límites", () => {
    const ids = new PreviewIds("limites");
    for (let i = 0; i < 300; i += 1) {
      const n = ids.int(3, 5);
      assert.ok(n >= 3 && n <= 5);
    }
    assert.throws(() => ids.pick([]), /lista vacía/);
    assert.equal(ids.pick(["solo"]), "solo");
  });
});
