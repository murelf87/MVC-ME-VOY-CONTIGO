import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { plateText, vehicleImageKey, vehicleLine } from "./vehicle";

describe("vehicleLine", () => {
  it("une modelo y color", () => {
    assert.equal(vehicleLine({ make: "Seat", model: "León", color: "Blanco" }), "Seat León · Blanco");
  });
  it("omite el color si no se indicó", () => {
    assert.equal(vehicleLine({ make: "Seat", model: "León", color: null }), "Seat León");
    assert.equal(vehicleLine({ make: "Seat", model: "León", color: "  " }), "Seat León");
  });
  it("compacta espacios", () => {
    assert.equal(vehicleLine({ make: "  Renault ", model: "Clio   V", color: null }), "Renault Clio V");
  });
});

describe("vehicleImageKey", () => {
  it("solo devuelve ilustración si marca, modelo y color coinciden", () => {
    assert.equal(vehicleImageKey({ make: "Seat", model: "León", color: "Blanco" }), "seatLeon");
    assert.equal(vehicleImageKey({ make: "SEAT", model: "Leon", color: "blanco" }), "seatLeon");
  });
  it("no enseña la foto de otro color o modelo", () => {
    assert.equal(vehicleImageKey({ make: "Seat", model: "León", color: "Negro" }), null);
    assert.equal(vehicleImageKey({ make: "Seat", model: "León", color: null }), null);
    assert.equal(vehicleImageKey({ make: "Seat", model: "Arona", color: "Blanco" }), null);
    assert.equal(vehicleImageKey({ make: "Renault", model: "Clio", color: "Blanco" }), null);
  });
});

describe("plateText", () => {
  it("normaliza espacios y mayúsculas", () => {
    assert.equal(plateText(" 1234  lbc "), "1234 LBC");
  });
});
