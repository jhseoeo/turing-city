import type { Alert, AlertKind, WorldState } from './world.ts';

const ALERT_LIMIT = 500;

export function raiseAlert(world: WorldState, step: number, kind: AlertKind, facilityId: string | null, message: string): Alert {
  const alert: Alert = { id: world.nextAlertId++, step, kind, facilityId, message };
  world.alerts.push(alert);
  if (world.alerts.length > ALERT_LIMIT) world.alerts.splice(0, world.alerts.length - ALERT_LIMIT);
  return alert;
}

/** Raises the alert only when its flag isn't already up; clearFlag ends the episode. */
export function raiseOnce(
  world: WorldState,
  flag: string,
  step: number,
  kind: AlertKind,
  facilityId: string | null,
  message: string,
): Alert | null {
  if (world.flags[flag]) return null;
  world.flags[flag] = true;
  return raiseAlert(world, step, kind, facilityId, message);
}

export function clearFlag(world: WorldState, flag: string): void {
  delete world.flags[flag];
}
