import { startSleep } from './boards.ts';
import { coolSteps } from './datacenter.ts';
import { clamp } from './fixed.ts';
import type { Ticked } from './ticks.ts';
import { type SimContext, toInt } from './world.ts';

/** Phase 5: applies what each tick asked for. A failed tick asks for nothing. */
export function applyActions(ctx: SimContext, step: number, ticked: readonly Ticked[]): void {
  const t = ctx.scenario.tuning;
  // A priority list names facilities, with a board or not: housing is a consumer too.
  const known = new Set(ctx.world.facilities.map((f) => f.id));
  for (const { board, outcome } of ticked) {
    let processed = false;
    for (const action of outcome.actions) {
      if (board.status !== 'running') break; // a sleep stops the rest of the list
      const dc = ctx.world.datacenters[board.id];
      switch (action.kind) {
        case 'process':
          if (dc && !processed) {
            processed = true;
            // The power phase charged this step under the old window, so a job still running at it goes on: no step is lost.
            // It runs until the board's next tick, as in milestone 1.
            const running = dc.busyFrom <= step && step < dc.busyUntil;
            if (!running) dc.busyFrom = step + 1;
            dc.busyUntil = step + board.period + 1;
          }
          break;
        case 'cool':
          // A level above 0 starts a cooling cycle at the next step, unless one covers that step; level 0 does nothing.
          if (dc && toInt(action.level) > 0 && !(dc.coolFrom <= step + 1 && step + 1 < dc.coolUntil)) {
            dc.coolFrom = step + 1;
            dc.coolUntil = step + 1 + coolSteps(ctx);
          }
          break;
        case 'setThermal':
          if (board.kind === 'power') ctx.world.plant.thermalSetting = clamp(toInt(action.output), 0, t.thermal.max);
          break;
        case 'setPriority':
          if (board.kind === 'power') ctx.world.plant.priority = [...new Set(action.order.filter((id) => known.has(id)))];
          break;
        case 'sleep':
          startSleep(ctx, board, step, action.seconds);
          break;
      }
    }
  }
}
