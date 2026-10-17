import type { Act, Action, BootInfo, FirmwareHost, TickError, TickInput, TickOutcome } from '../../src/firmware-host.ts';

export interface FakeTick {
  actions?: Action[];
  logs?: string[];
  droppedLogs?: number;
  instructions?: number;
  error?: TickError;
}
export type FakeProgram = (sensors: TickInput['sensors'], mem: Record<string, unknown>) => FakeTick;

/** A FirmwareHost whose "firmware" is a registered TypeScript function. */
export class FakeHost implements FirmwareHost {
  readonly programs = new Map<string, FakeProgram>();
  readonly calls: string[] = [];
  readonly boots: BootInfo[] = [];
  private readonly vms = new Map<string, { program: FakeProgram | null; mem: Record<string, unknown> }>();

  /** Registers a program and returns the "source" that selects it. */
  program(source: string, fn: FakeProgram): string {
    this.programs.set(source, fn);
    return source;
  }
  memOf(boardId: string): Record<string, unknown> | undefined {
    return this.vms.get(boardId)?.mem;
  }
  boot(info: BootInfo): void {
    this.calls.push(`boot:${info.boardId}`);
    this.boots.push(info);
    this.vms.set(info.boardId, { program: null, mem: {} });
  }
  /** What each action of the last tick of each board was answered: null, or why the game did not take it. */
  readonly answers = new Map<string, Array<string | null>>();
  tick(boardId: string, input: TickInput, act: Act): TickOutcome {
    this.calls.push(`tick:${boardId}`);
    const vm = this.vms.get(boardId);
    if (!vm) throw new Error(`tick before boot: ${boardId}`);
    if (input.newSource !== null) {
      const program = this.programs.get(input.newSource);
      if (!program) throw new Error(`no fake program for source ${JSON.stringify(input.newSource)}`);
      vm.program = program;
    }
    if (!vm.program) {
      return { ok: false, instructions: 0, actions: [], logs: [], error: { kind: 'noTick', message: 'no firmware' }, ramUsedBytes: 0 };
    }
    const out = vm.program(input.sensors, vm.mem);
    const ok = out.error === undefined;
    // A program that fails fails before its actions: none of them is called.
    const called = ok ? (out.actions ?? []) : [];
    const answers = called.map((action) => act(action));
    this.answers.set(boardId, answers);
    return {
      ok,
      instructions: out.instructions ?? 100,
      actions: called.filter((_, i) => answers[i] === null),
      logs: out.logs ?? [],
      droppedLogs: out.droppedLogs ?? 0,
      error: out.error ?? null,
      ramUsedBytes: 0,
    };
  }
  shutdown(boardId: string): void {
    this.calls.push(`shutdown:${boardId}`);
    this.vms.delete(boardId);
  }
  close(): void {
    this.vms.clear();
  }
}
