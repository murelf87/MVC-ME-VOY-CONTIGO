// Pruebas de la etiqueta de rol («Ana (Conductora)») del slice messages.
// Ejecutar:  cd mobile && node --import tsx --test "src/features/messages/**/*.test.ts"
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { firstNameOf, guessGender, nameWithRole, peerRoleOf, roleWord } from "./people";

describe("guessGender", () => {
  it("nombres femeninos que acaban en «a» y excepciones sin «a»", () => {
    for (const name of ["Ana", "Laura", "Marta", "Lucía", "Nuria", "Carmen", "Inés", "Irene", "Beatriz", "Pilar", "Mercedes"]) {
      assert.equal(guessGender(name), "feminine", name);
    }
  });

  it("nombres masculinos con terminación consonante, en «o» o excepciones en «a»", () => {
    for (const name of ["Carlos", "Daniel", "Miguel Ángel", "Rafael", "Hugo", "Pablo", "Álvaro", "Borja", "Luca"]) {
      assert.equal(guessGender(name), "masculine", name);
    }
  });

  it("sin pista clara → desconocido", () => {
    for (const name of ["Jose", "Noe", "", "  "]) assert.equal(guessGender(name), "unknown", name);
  });

  it("solo mira el primer nombre y no distingue acentos ni mayúsculas", () => {
    assert.equal(guessGender("INÉS María"), "feminine");
    assert.equal(guessGender("  miguel ángel  "), "masculine");
  });
});

describe("etiquetas de rol", () => {
  it("«Ana (Conductora)» es el literal de la lámina 26", () => {
    assert.equal(nameWithRole("Ana", "driver"), "Ana (Conductora)");
    assert.equal(roleWord("driver", "Carlos"), "Conductor");
    assert.equal(roleWord("passenger", "Laura"), "Pasajera");
    assert.equal(roleWord("passenger", "Miguel"), "Pasajero");
  });

  it("neutro cuando el nombre no permite deducir el género", () => {
    assert.equal(roleWord("driver", "Jose"), "Conductor/a");
    assert.equal(roleWord("passenger", "Noe"), "Pasajero/a");
  });

  it("el rol de la otra persona es el contrario del mío", () => {
    assert.equal(peerRoleOf("passenger"), "driver");
    assert.equal(peerRoleOf("driver"), "passenger");
  });
});

describe("firstNameOf", () => {
  it("se queda con el primer nombre", () => {
    assert.equal(firstNameOf("Ana García López"), "Ana");
    assert.equal(firstNameOf("  Miguel Ángel Ruiz "), "Miguel");
    assert.equal(firstNameOf("Carlos"), "Carlos");
    assert.equal(firstNameOf("   "), "");
  });
});
