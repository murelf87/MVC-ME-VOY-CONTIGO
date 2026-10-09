// Bloqueo global de tareas pesadas (la máquina tiene 2 núcleos y 7 GB compartidos por varios agentes):
// export web, Playwright y builds se serializan con `flock /tmp/mvc-heavy.lock`.
// Uso: al principio de un script → `ensureHeavyLock('descripción')`. Si aún no se tiene el bloqueo, el proceso se vuelve a
// lanzar a sí mismo bajo flock (espera su turno) y termina con el código del hijo. `--no-lock` o MVC_HEAVY_LOCKED=1 lo omiten.
import { spawnSync } from 'node:child_process';

export const HEAVY_LOCK = process.env.MVC_HEAVY_LOCK_FILE || '/tmp/mvc-heavy.lock';

export function ensureHeavyLock(label = 'tarea pesada') {
  if (process.env.MVC_HEAVY_LOCKED === '1' || process.argv.includes('--no-lock')) return;
  const probe = spawnSync('flock', ['--version'], { stdio: 'ignore' });
  if (probe.error || probe.status !== 0) {
    console.error('! flock no está disponible: se continúa sin bloqueo global.');
    return;
  }
  const lockFile = process.env.MVC_HEAVY_LOCK_FILE || HEAVY_LOCK;
  console.error(`› Esperando el bloqueo ${lockFile} (${label})…`);
  const r = spawnSync('flock', [lockFile, process.execPath, ...process.execArgv, ...process.argv.slice(1)], {
    stdio: 'inherit',
    env: { ...process.env, MVC_HEAVY_LOCKED: '1' },
  });
  process.exit(r.status ?? (r.signal ? 1 : 0));
}
