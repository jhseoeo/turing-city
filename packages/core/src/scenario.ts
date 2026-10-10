import { z } from 'zod';

export const FACILITY_KINDS = ['power', 'datacenter'] as const;
export type FacilityKind = (typeof FACILITY_KINDS)[number];

export const ALL_SENSORS = ['wind', 'demand', 'fuelPrice', 'temp', 'powerHeadroom', 'price', 'emf', 'ludditeDist'] as const;
export type SensorName = (typeof ALL_SENSORS)[number];

/** The sensors a board can carry, by the kind of facility it sits in. */
export const SENSORS_BY_KIND: Record<FacilityKind, readonly SensorName[]> = {
  power: ['wind', 'demand', 'fuelPrice'],
  datacenter: ['temp', 'powerHeadroom', 'price', 'emf', 'ludditeDist'],
};

const int = (min: number) => z.number().int().min(min);

const BoardSchema = z.object({
  clockHz: int(1),
  instructionCap: int(100),
  ramKb: int(1),
  sensors: z.array(z.enum(ALL_SENSORS)),
  /** Power the board itself draws, every step it's awake. */
  power: int(0),
  baseEmfPerSecond: int(0),
});

const FacilitySchema = z.object({
  id: z.string().regex(/^[A-Z][A-Z0-9]{0,7}$/, 'an id is 1-8 capital letters or digits, starting with a letter'),
  kind: z.enum(FACILITY_KINDS),
  x: int(0),
  y: int(0),
  board: BoardSchema,
});

const TuningSchema = z.object({
  transmissionLossPctPerCell: int(0),
  /**
   * How long the grid, or a board, must be steady before an outage is over: a shortage alert is raised again only after the grid has
   * had no shed facility for this long, and a board logs "power back" only after it has had power, unbroken, for this long.
   */
  shortageQuietSeconds: int(0),
  wind: z.object({ max: int(0), start: int(0), maxChangePerSecond: int(0) }),
  thermal: z.object({ max: int(0) }),
  fuelPrice: z.object({ start: int(0), min: int(0), max: int(0) }),
  jobPrice: z.object({ start: int(0), min: int(0), max: int(0), maxChangePerSecond: int(0) }),
  datacenter: z.object({
    processPower: int(0),
    ambientMilli: int(0),
    heatMilliPerSecond: int(0),
    passiveCoolingPctPerSecond: int(0),
    coolingMilliPerLevelPerSecond: int(0),
    coolingPowerPerLevel: int(0),
    maxCoolingLevel: int(0),
    overheatAlertMilli: int(0),
    fireThresholdMilli: int(0),
    firePermillePerDegreePerSecond: int(0),
  }),
  boardUpkeepPerDay: int(0),
  sleepPower: int(0),
  maxSleepSeconds: int(1),
  emf: z.object({
    instructionsPerUnit: int(1),
    perAction: int(0),
    diffusionPctPerSecond: int(0),
    decayPctPerSecond: int(0),
    detectionThreshold: int(0),
    rumourThreshold: int(1),
  }),
  luddites: z.object({ groupSize: int(1), cellsPerSecond: int(1), quietSecondsToLeave: int(1), approachCells: int(1) }),
  rebuild: z.object({ cost: int(0), seconds: int(1) }),
  bankruptcyDays: int(1),
});

const ScenarioSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    grid: z.object({ width: z.number().int().min(1).max(64), height: z.number().int().min(1).max(64) }),
    time: z.object({ stepsPerSecond: int(1), secondsPerDay: int(1), seasonDays: int(1) }),
    startMoney: int(0),
    facilities: z.array(FacilitySchema).min(1),
    tuning: TuningSchema,
  })
  .superRefine((s, ctx) => {
    const ids = new Set<string>();
    const cells = new Set<string>();
    s.facilities.forEach((f, i) => {
      if (ids.has(f.id)) ctx.addIssue({ code: 'custom', path: ['facilities', i, 'id'], message: `duplicate facility id ${f.id}` });
      ids.add(f.id);
      if (f.x >= s.grid.width || f.y >= s.grid.height) {
        ctx.addIssue({
          code: 'custom',
          path: ['facilities', i],
          message: `(${f.x}, ${f.y}) is outside the ${s.grid.width}x${s.grid.height} grid`,
        });
      }
      const cell = `${f.x},${f.y}`;
      if (cells.has(cell)) ctx.addIssue({ code: 'custom', path: ['facilities', i], message: `two facilities at (${cell})` });
      cells.add(cell);
      if (s.time.stepsPerSecond % f.board.clockHz !== 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['facilities', i, 'board', 'clockHz'],
          message: `clockHz ${f.board.clockHz} must divide stepsPerSecond ${s.time.stepsPerSecond}`,
        });
      }
      const offered = SENSORS_BY_KIND[f.kind];
      f.board.sensors.forEach((sensor, j) => {
        if (!offered.includes(sensor)) {
          ctx.addIssue({
            code: 'custom',
            path: ['facilities', i, 'board', 'sensors', j],
            message: `a ${f.kind} board has no ${sensor} sensor`,
          });
        }
      });
    });
    if (s.facilities.filter((f) => f.kind === 'power').length !== 1) {
      ctx.addIssue({ code: 'custom', path: ['facilities'], message: 'exactly one power plant is required' });
    }
    // A series starts inside its range and stays there (the wind's range is 0..max). An inverted range or a start
    // outside it is a mistake in the file, so it is refused here rather than met in the middle of a session.
    const { wind, fuelPrice, jobPrice } = s.tuning;
    const series = [
      ['wind', 0, wind.max, wind.start],
      ['fuelPrice', fuelPrice.min, fuelPrice.max, fuelPrice.start],
      ['jobPrice', jobPrice.min, jobPrice.max, jobPrice.start],
    ] as const;
    for (const [name, min, max, start] of series) {
      if (min > max) {
        ctx.addIssue({ code: 'custom', path: ['tuning', name], message: `min ${min} is above max ${max}` });
      } else if (start < min || start > max) {
        ctx.addIssue({ code: 'custom', path: ['tuning', name, 'start'], message: `start ${start} is outside the range ${min}..${max}` });
      }
    }
  });

export type Scenario = z.infer<typeof ScenarioSchema>;
export type FacilitySpec = Scenario['facilities'][number];
export type BoardSpec = FacilitySpec['board'];
export type Tuning = Scenario['tuning'];

export class ScenarioError extends Error {}

/** Validates a scenario (parsed JSON). Throws ScenarioError listing every problem as "path: problem". */
export function parseScenario(input: unknown): Scenario {
  const result = ScenarioSchema.safeParse(input);
  if (!result.success) {
    const lines = result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);
    throw new ScenarioError(lines.join('\n'));
  }
  return result.data;
}
