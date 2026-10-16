import type { Snapshot } from '@turing-city/core';

/** How long a pay's "+40" shows, in real milliseconds. */
export const PAY_FLASH_MS = 1200;

/** A finished job's pay, as the screen shows it: where, how much, and since when (real milliseconds). */
export interface PayFlash {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly amount: number;
  readonly since: number;
}

/**
 * The "+40" a datacenter shows when a job pays (the user, 2026-10-16). Each snapshot carries every datacenter's last pay; this tells
 * a new one from one the screen has seen. The first snapshot of a facility only sets what was seen: a page opened mid-season shows
 * no old pay.
 */
export class PayFlashes {
  private readonly seen = new Map<string, number>();
  private readonly shown = new Map<string, PayFlash>();

  /** Takes a snapshot: the pays it brings that the screen hasn't seen, each starting its flash now. The same snapshot twice brings none. */
  take(s: Snapshot, now: number): PayFlash[] {
    const fresh: PayFlash[] = [];
    for (const f of s.facilities) {
      const pay = f.datacenter?.lastPay ?? null;
      const before = this.seen.get(f.id);
      this.seen.set(f.id, pay?.step ?? -1);
      // A new season starts its steps over, so a pay is new when its step differs, not only when it is later.
      if (!pay || before === undefined || before === pay.step) continue;
      const flash = { id: f.id, x: f.x, y: f.y, amount: pay.amount, since: now };
      this.shown.set(f.id, flash);
      fresh.push(flash);
    }
    return fresh;
  }

  /** The flash a facility shows at this moment, or null once its time is up. */
  flash(id: string, now: number): PayFlash | null {
    const f = this.shown.get(id);
    return f && now - f.since < PAY_FLASH_MS ? f : null;
  }
}
