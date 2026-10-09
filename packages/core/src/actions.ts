import { startSleep } from './boards.ts';
import { clamp } from './fixed.ts';
import type { Ticked } from './ticks.ts';
import { type SimContext, toInt } from './world.ts';

/** Phase 5: applies what each tick asked for. A failed tick asks for nothing. */
export function applyActions(ctx: SimContext, step: number, ticked: readonly Ticked[]): void {
  const t = ctx.scenario.tuning;
  const known = new Set(ctx.world.boards.map((b) => b.id));
  for (const { board, outcome } of ticked) {
    let processed = false;
    for (const action of outcome.actions) {
      if (board.status !== 'running') break; // a sleep stops the rest of the list
      const dc = ctx.world.datacenters[board.id];
      switch (action.kind) {
        case 'process':
          if (dc && !processed) {
            processed = true;
            // The power phase charged this step under the old window, so a job still running at it goes on from it: no step is lost.
            const running = dc.jobFrom <= step && step <= dc.jobUntil;
            dc.jobFrom = running ? step : step + 1;
            dc.jobUntil = step + board.period;
          }
          break;
        case 'cool':
          if (dc) dc.cooling = clamp(toInt(action.level), 0, t.datacenter.maxCoolingLevel);
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
