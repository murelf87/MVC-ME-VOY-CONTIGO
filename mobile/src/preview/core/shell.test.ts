/**
 * Acceso tolerante al visor (`__MVC_PREVIEW_SHELL__`): todo degrada con valores por defecto cuando no hay visor o este
 * falla, y nunca lanza hacia el backend en memoria.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { clearShell, withShell } from "../testing/harness";
import { deliverSmsToShell, hasShell, isShellOffline, notifyShell, pickLatencyMs, readBoot, readShell, subscribeSim } from "./shell";

afterEach(() => {
  clearShell();
});

describe("core/shell: sin visor", () => {
  it("todo degrada: sin boot, en línea, sin entrega de SMS ni notificaciones y con la latencia por defecto", () => {
    assert.equal(hasShell(), false);
    assert.deepEqual(readShell(), {});
    assert.deepEqual(readBoot(), {});
    assert.equal(isShellOffline(), false);
    assert.equal(deliverSmsToShell({ to: "+34611000101", from: "MVC", body: "x", code: "123456" }), false);
    assert.equal(notifyShell({ title: "Hola" }), false);
    const sample = pickLatencyMs(() => 0.5);
    assert.ok(sample >= 80 && sample <= 250, `latencia ${sample}`);
  });

  it("subscribeSim sin window devuelve una baja que no hace nada", () => {
    const off = subscribeSim(() => undefined);
    assert.equal(typeof off, "function");
    off();
  });
});

describe("core/shell: con visor", () => {
  it("readBoot devuelve perfil, variante y reloj del arranque", async () => {
    await withShell({ boot: { profile: "driver", seed: "request-pending", clock: "2026-10-05T07:17:00+02:00" } }, () => {
      assert.equal(hasShell(), true);
      assert.deepEqual(readBoot(), { profile: "driver", seed: "request-pending", clock: "2026-10-05T07:17:00+02:00" });
    });
  });

  it("isShellOffline usa isOffline() y, si no existe, sim.network === «none»; un visor que lanza se toma por en línea", async () => {
    await withShell({ isOffline: () => true }, () => assert.equal(isShellOffline(), true));
    await withShell({ sim: { network: "none" } }, () => assert.equal(isShellOffline(), true));
    await withShell({ sim: { network: "wifi" } }, () => assert.equal(isShellOffline(), false));
    await withShell(
      {
        isOffline: () => {
          throw new Error("visor roto");
        },
      },
      () => assert.equal(isShellOffline(), false)
    );
  });

  it("deliverSmsToShell y notifyShell llaman al visor y devuelven false si este lanza", async () => {
    const received: unknown[] = [];
    await withShell(
      {
        deliverSms: (sms: unknown) => received.push(["sms", sms]),
        notify: (n: unknown) => received.push(["notify", n]),
      },
      () => {
        assert.equal(deliverSmsToShell({ to: "+34611000101", from: "MVC", body: "Tu código", code: "654321" }), true);
        assert.equal(notifyShell({ app: "MVC", title: "Ana ha aceptado tu solicitud", tone: "info" }), true);
      }
    );
    assert.deepEqual(received, [
      ["sms", { to: "+34611000101", from: "MVC", body: "Tu código", code: "654321" }],
      ["notify", { app: "MVC", title: "Ana ha aceptado tu solicitud", tone: "info" }],
    ]);
    const broken = (): never => {
      throw new Error("visor roto");
    };
    await withShell({ deliverSms: broken, notify: broken }, () => {
      assert.equal(deliverSmsToShell({ to: "+34611000101", from: "MVC", body: "x" }), false);
      assert.equal(notifyShell({ title: "x" }), false);
    });
  });

  it("pickLatencyMs respeta un valor fijo (también 0), un rango y los extremos", async () => {
    await withShell({ latency: 0 }, () => assert.equal(pickLatencyMs(() => 0.9), 0));
    await withShell({ latency: 120 }, () => assert.equal(pickLatencyMs(() => 0.9), 120));
    await withShell({ latency: [100, 200] as const }, () => {
      assert.equal(pickLatencyMs(() => 0), 100);
      assert.equal(pickLatencyMs(() => 1), 200);
      assert.equal(pickLatencyMs(() => 0.5), 150);
    });
    await withShell({ latency: [90, 90] as const }, () => assert.equal(pickLatencyMs(() => 0.3), 90));
  });
});
