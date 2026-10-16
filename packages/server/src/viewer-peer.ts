import {
  ALERT_KINDS,
  type CommandResult,
  type ControllerEvent,
  FACILITY_ACTION,
  FIRMWARE_SOURCE,
  INSTALL_PART,
  type ServerToViewer,
  ToolError,
  type ViewerToServer,
} from '@turing-city/core';
import { z } from 'zod';
import type { GameController } from './game-controller.ts';

/** A controller's event as the message every viewer gets. */
export function toMessage(event: ControllerEvent): ServerToViewer {
  switch (event.kind) {
    case 'status':
      return { type: 'status', status: event.status };
    case 'snapshot':
      return { type: 'snapshot', snapshot: event.snapshot };
    case 'alerts':
      return { type: 'alerts', alerts: event.alerts };
    case 'deploy':
      return { type: 'deploy', board: event.board, version: event.version, time: event.time, by: event.by };
  }
}

/**
 * The most a viewer's message may weigh. A command is a few dozen bytes, but the editor's deploy carries a firmware source of up to
 * 65,536 characters, which JSON can spend 6 bytes on each (a control character's \u escape): 384 KiB. A bigger message closes its
 * connection.
 */
export const MAX_MESSAGE_BYTES = 512 * 1024;

const boardId = z.string().min(1).max(32);

/** What a viewer may send: the commands of ViewerToServer, exactly. Nothing else reaches the controller. */
const viewerCommand: z.ZodType<ViewerToServer> = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('startSeason') }),
  z.strictObject({ type: z.literal('play') }),
  z.strictObject({ type: z.literal('pause') }),
  z.strictObject({ type: z.literal('speed'), speed: z.literal([1, 2, 3]) }),
  z.strictObject({ type: z.literal('deploy'), board: boardId, code: FIRMWARE_SOURCE }),
  z.strictObject({ type: z.literal('hand'), facility: boardId, action: FACILITY_ACTION }),
  z.strictObject({ type: z.literal('install'), facility: boardId, part: INSTALL_PART }),
  z.strictObject({ type: z.literal('repair'), facility: boardId }),
  z.strictObject({ type: z.literal('rebuild'), board: boardId }),
  z.strictObject({ type: z.literal('autoPause'), kinds: z.array(z.enum(ALERT_KINDS)).max(ALERT_KINDS.length) }),
  z.strictObject({ type: z.literal('reissueToken') }),
  z.strictObject({ type: z.literal('inspect'), board: boardId }),
]);

const BAD_COMMAND = 'bad command: ';

/** A viewer's message as a command, or why it is none (short, because it goes back to the viewer). */
function parseCommand(text: string): { ok: true; command: ViewerToServer } | { ok: false; reason: string } {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, reason: `${BAD_COMMAND}not JSON` };
  }
  const parsed = viewerCommand.safeParse(json);
  if (parsed.success) return { ok: true, command: parsed.data };
  const issues = parsed.error.issues.map((i) => (i.path.length > 0 ? `${i.path.map(String).join('.')}: ${i.message}` : i.message));
  return { ok: false, reason: `${BAD_COMMAND}${issues.join('; ')}`.slice(0, 200) };
}

/** What the viewer is told when a command fails: the English message, and the code of the refusal when it is one the viewer knows. */
function refused(error: unknown): ServerToViewer {
  const message = error instanceof Error ? error.message : String(error);
  return error instanceof ToolError && error.refusal ? { type: 'error', message, refusal: error.refusal } : { type: 'error', message };
}

export interface ViewerPeerOptions {
  readonly controller: GameController;
  /** Sends a message to this viewer. It must not throw: it runs inside the controller's events and the viewer's commands. */
  readonly send: (message: ServerToViewer) => void;
  /** What the viewer is told first. */
  readonly hello: () => ServerToViewer;
  /** The viewer's request for a new agent token; the transport tells every viewer the new hello. */
  readonly reissueToken: () => void;
}

/**
 * One viewer's side of the game, with no transport of its own: the server's viewer hub makes one per WebSocket, and the web demo
 * one for its page. It checks each message the viewer sends against the exact commands, carries it to the controller, and answers
 * this viewer; the controller's events reach every viewer through the transport (toMessage).
 */
export function createViewerPeer(options: ViewerPeerOptions): { greet(): void; receive(text: string): void } {
  const { controller, send } = options;
  /** A command the game refused is told to the viewer that sent it, with its code; a done one says nothing (the snapshot shows it). */
  const tell = (result: CommandResult): void => {
    if (!result.ok) send({ type: 'error', message: result.reason, refusal: result.refusal });
  };

  async function handle(message: ViewerToServer): Promise<void> {
    switch (message.type) {
      case 'startSeason':
        await controller.startSeason();
        return;
      case 'play':
        controller.play();
        return;
      case 'pause':
        controller.pause();
        return;
      case 'speed':
        controller.setSpeed(message.speed);
        return;
      case 'deploy': {
        // The editor's deploy is always the player's: `by` is never read from the message. Its answer, a syntax error included, goes
        // to the viewer that sent it; a refusal (a facility with no board, no season) is told by the catch around handle().
        const outcome = await controller.deploy(message.board, message.code, 'player');
        send({ type: 'deployResult', board: message.board, outcome });
        return;
      }
      case 'hand':
        tell(await controller.hand(message.facility, message.action));
        return;
      case 'install':
        tell(await controller.install(message.facility, message.part));
        return;
      case 'repair':
        tell(await controller.repair(message.facility));
        return;
      case 'rebuild':
        tell(await controller.rebuild(message.board));
        return;
      case 'autoPause':
        controller.setAutoPause(message.kinds);
        return;
      case 'reissueToken':
        options.reissueToken();
        return;
      case 'inspect': {
        // The panel asks twice a second while a board is selected. With no season to read (before the first, after a crash,
        // or one replaced while the question was out, which the controller fails with a plain Error) it gets an empty
        // inspection: a refusal would sit in the screen's notice, over the overlay. A failure of the season's own is still told.
        const inspection = await controller.inspect(message.board).catch((error: unknown) => {
          const code = error instanceof ToolError ? error.refusal?.code : undefined;
          if (!(error instanceof ToolError) || code === 'noSeason' || code === 'crashed') return null;
          throw error;
        });
        send({ type: 'inspection', board: message.board, inspection });
        return;
      }
    }
  }

  return {
    /** What a viewer is told when it comes: the hello, the controller's status, and the latest snapshot. */
    greet() {
      send(options.hello());
      send({ type: 'status', status: controller.status() });
      const snap = controller.latestSnapshot();
      if (snap) send({ type: 'snapshot', snapshot: snap });
    },
    receive(text: string) {
      const parsed = parseCommand(text);
      if (!parsed.ok) {
        send({
          type: 'error',
          message: parsed.reason,
          refusal: { code: 'badCommand', detail: parsed.reason.slice(BAD_COMMAND.length) },
        });
        return;
      }
      handle(parsed.command).catch((error: unknown) => send(refused(error)));
    },
  };
}
