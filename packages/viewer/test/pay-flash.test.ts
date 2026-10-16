import type { FacilityView, Snapshot } from '@turing-city/core';
import { describe, expect, it } from 'vitest';
import { PAY_FLASH_MS, PayFlashes } from '../src/pay-flash.ts';

const datacenter = (lastPay: { step: number; amount: number } | null): FacilityView =>
  ({
    id: 'DA',
    kind: 'datacenter',
    x: 5,
    y: 4,
    datacenter: { tempC: 30, processing: false, cooling: false, jobLeft: 0, coolLeft: 0, lastPay },
  }) as unknown as FacilityView;
const snap = (...facilities: FacilityView[]): Snapshot => ({ facilities }) as unknown as Snapshot;

describe('pay flashes', () => {
  it('flashes a new pay once, where its datacenter is, for its time', () => {
    const pays = new PayFlashes();
    expect(pays.take(snap(datacenter(null)), 0)).toEqual([]);
    const fresh = pays.take(snap(datacenter({ step: 19, amount: 40 })), 1000);
    expect(fresh).toEqual([{ id: 'DA', x: 5, y: 4, amount: 40, since: 1000 }]);
    expect(pays.take(snap(datacenter({ step: 19, amount: 40 })), 1050)).toEqual([]); // the same pay again: already shown
    expect(pays.flash('DA', 1000 + PAY_FLASH_MS - 1)?.amount).toBe(40);
    expect(pays.flash('DA', 1000 + PAY_FLASH_MS)).toBeNull();
    expect(pays.take(snap(datacenter({ step: 39, amount: 40 })), 2000)).toHaveLength(1); // the next job's pay
  });

  it('shows no old pay on the first snapshot it sees, and a pay at a lower step after a new season', () => {
    const pays = new PayFlashes();
    expect(pays.take(snap(datacenter({ step: 500, amount: 40 })), 0)).toEqual([]);
    expect(pays.flash('DA', 0)).toBeNull();
    expect(pays.take(snap(datacenter(null)), 10)).toEqual([]); // a new season
    expect(pays.take(snap(datacenter({ step: 19, amount: 40 })), 20)).toHaveLength(1);
  });
});
