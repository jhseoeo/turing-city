import { clearFlag, raiseOnce } from './alerts.ts';
import { MICRO, MILLI, mulDiv } from './fixed.ts';
import { stepsPerDay } from './time.ts';
import type { FacilityState, SimContext } from './world.ts';

/** The milli-food a housing block's residents eat each step. */
export function mealMilli(ctx: SimContext): number {
  const h = ctx.scenario.tuning.housing;
  return mulDiv(h.residents * h.foodPerPersonPerDay, MILLI, stepsPerDay(ctx.scenario.time));
}

/** The micro-units of tax a fed and powered block pays each step. */
export function taxMicro(ctx: SimContext): number {
  const h = ctx.scenario.tuning.housing;
  return mulDiv(h.residents * h.taxPerPersonPerDay, MICRO, stepsPerDay(ctx.scenario.time));
}

/**
 * What a facility where residents live (a housing block) requests from the grid before transmission loss: people live there, so it
 * uses power whatever anyone runs. A facility with no residents: nothing.
 */
export function housingDraw(ctx: SimContext, facility: FacilityState): number {
  return ctx.world.housing[facility.id] ? ctx.scenario.tuning.housing.power : 0;
}

/**
 * Phase 6: every block eats its meal from its food. A block that cannot is hungry, and what food it had is gone. Fed and powered
 * residents pay tax. A block that turns hungry raises one hunger alert, until it is fed again.
 */
export function runHousing(ctx: SimContext, step: number): void {
  const w = ctx.world;
  const meal = mealMilli(ctx);
  const tax = taxMicro(ctx);
  for (const f of w.facilities) {
    const home = w.housing[f.id];
    if (!home) continue;
    if (home.foodMilli >= meal) {
      home.foodMilli -= meal;
      home.fed = true;
    } else {
      home.foodMilli = 0;
      home.fed = false;
    }
    if (home.fed && f.powered) {
      w.money += tax;
      w.ledger.tax += tax;
    }
    if (home.fed) clearFlag(w, `hunger:${f.id}`);
    else raiseOnce(w, `hunger:${f.id}`, step, 'hunger', f.id, `${f.id} 주민이 굶고 있어요`);
  }
}

export interface PopulationCounts {
  readonly fed: number;
  readonly hungry: number;
  readonly unpowered: number;
}

/** Residents by how they stood at the last step: fed and powered, hungry, or fed but without power. */
export function populationCounts(ctx: SimContext): PopulationCounts {
  const residents = ctx.scenario.tuning.housing.residents;
  let fed = 0;
  let hungry = 0;
  let unpowered = 0;
  for (const f of ctx.world.facilities) {
    const home = ctx.world.housing[f.id];
    if (!home) continue;
    if (!home.fed) hungry += residents;
    else if (!f.powered) unpowered += residents;
    else fed += residents;
  }
  return { fed, hungry, unpowered };
}
