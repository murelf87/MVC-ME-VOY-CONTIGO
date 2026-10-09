import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MeProfile } from "@/api/types";
import type { SessionStatus } from "@/session/types";
import { isRouteAllowed } from "./access";

function makeMe(roles: MeProfile["roles"]): MeProfile {
  return {
    id: "user-1",
    phone_e164: "+34600111222",
    status: "active",
    display_name: "Ana",
    public_photo_key: "photos/user-1.jpg",
    public_photo_status: "approved",
    identity_status: "unverified",
    presence_status: null,
    roles,
  };
}

const STATUSES: SessionStatus[] = ["booting", "guest", "signedOut", "signedIn"];

describe("isRouteAllowed", () => {
  it("public: cualquier estado de sesión", () => {
    for (const status of STATUSES) assert.equal(isRouteAllowed("public", { status, me: null }), true, status);
  });

  it("auth: solo con sesión iniciada", () => {
    assert.equal(isRouteAllowed("auth", { status: "signedIn", me: makeMe(["passenger"]) }), true);
    assert.equal(isRouteAllowed("auth", { status: "signedIn", me: null }), true);
    assert.equal(isRouteAllowed("auth", { status: "guest", me: null }), false);
    assert.equal(isRouteAllowed("auth", { status: "signedOut", me: null }), false);
    assert.equal(isRouteAllowed("auth", { status: "booting", me: null }), false);
  });

  it("staff: sesión + algún rol administrativo", () => {
    assert.equal(isRouteAllowed("staff", { status: "signedIn", me: makeMe(["passenger"]) }), false);
    assert.equal(isRouteAllowed("staff", { status: "signedIn", me: makeMe(["driver", "passenger"]) }), false);
    for (const role of ["admin", "verification_admin", "finance_admin", "support_admin"] as const) {
      assert.equal(isRouteAllowed("staff", { status: "signedIn", me: makeMe([role]) }), true, role);
    }
    assert.equal(isRouteAllowed("staff", { status: "signedIn", me: makeMe(["passenger", "admin"]) }), true);
  });

  it("staff: sin /me o sin sesión nunca entra", () => {
    assert.equal(isRouteAllowed("staff", { status: "signedIn", me: null }), false);
    assert.equal(isRouteAllowed("staff", { status: "guest", me: null }), false);
    assert.equal(isRouteAllowed("staff", { status: "signedOut", me: makeMe(["admin"]) }), false);
  });
});
