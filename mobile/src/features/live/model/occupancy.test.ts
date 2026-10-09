import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LiveOccupancy, LiveTimelineStop, PublicUser } from "@/api/types";
import { occupantColumns } from "./occupancy";
import { connectorIsActive, stopName, timelineRows } from "./timeline";

function user(id: string, name: string): PublicUser {
  return { id, displayName: name, firstName: name, photoUrl: null, ratingAverage: 4.8, ratingCount: 3 };
}

describe("occupantColumns", () => {
  it("ordena conductor, tú y agrupa a quien no comparte su perfil", () => {
    const occupancy: LiveOccupancy = {
      occupied: 3,
      capacity: 4,
      members: [
        { role: "passenger", isYou: false, user: null },
        { role: "passenger", isYou: true, user: user("m", "Miguel") },
        { role: "driver", isYou: false, user: user("a", "Ana") },
        { role: "passenger", isYou: false, user: null },
      ],
    };
    const columns = occupantColumns(occupancy);
    assert.equal(columns.length, 3);
    assert.deepEqual(
      columns.map((c) => (c.kind === "person" ? c.role : `hidden:${c.count}`)),
      ["driver", "you", "hidden:2"],
    );
  });
  it("sin copasajeros ocultos no añade columna", () => {
    const columns = occupantColumns({ occupied: 1, capacity: 3, members: [{ role: "driver", isYou: false, user: user("a", "Ana") }] });
    assert.equal(columns.length, 1);
  });
});

describe("timelineRows", () => {
  const stops: LiveTimelineStop[] = [
    { seq: 2, label: "Universidad de Sevilla", location: { lat: 37.36, lng: -5.99 }, role: "dropoff", eta: "2026-10-05T06:20:00.000Z", state: "next" },
    { seq: 0, label: "C. Luis Montoto", location: { lat: 37.38, lng: -5.97 }, role: "pickup", eta: "2026-10-05T05:25:00.000Z", state: "current" },
    { seq: 1, label: null, location: { lat: 37.37, lng: -5.96 }, role: "stop", eta: "2026-10-05T06:05:00.000Z", state: "next" },
  ];
  it("ordena por seq, añade el rol y la hora de Madrid", () => {
    const rows = timelineRows(stops);
    assert.deepEqual(
      rows.map((r) => [r.title, r.time]),
      [
        ["C. Luis Montoto (recogida)", "07:25"],
        ["Parada 1 (parada)", "08:05"],
        ["Universidad de Sevilla (destino)", "08:20"],
      ],
    );
    assert.equal(rows[0]?.caption, "En curso");
    assert.equal(rows[1]?.caption, null);
  });
  it("nombra una parada sin etiqueta", () => {
    assert.equal(stopName({ seq: 3, label: "  " }), "Parada 3");
  });
  it("el tramo es azul solo desde paradas hechas o en curso", () => {
    assert.equal(connectorIsActive("done"), true);
    assert.equal(connectorIsActive("current"), true);
    assert.equal(connectorIsActive("next"), false);
  });
});
