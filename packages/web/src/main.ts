import { parseScenario, type ServerToViewer } from '@turing-city/core';
import { SyntaxChecker } from '@turing-city/firmware';
import { GameController } from '@turing-city/server/game-controller';
import { createViewerPeer, toMessage } from '@turing-city/server/viewer-peer';
import { startViewer } from '@turing-city/viewer/app';
import wasmUrl from 'wasmoon/dist/glue.wasm?url';
import town from '../../../scenarios/m2-town.json' with { type: 'json' };
import { webSeasonThread } from './season-thread.ts';

/**
 * The web demo: the whole game in the page. The server's controller runs here, its season in a Web Worker, and one viewer peer
 * stands where the WebSocket would. No MCP server, so no agent: hello says port 0, and the viewer leaves out what needs one.
 */
const scenario = parseScenario(town);
const controller = new GameController({
  scenario,
  spawn: webSeasonThread,
  syntaxChecker: () => SyntaxChecker.create(wasmUrl),
});

startViewer((onMessage, onOpenChange) => {
  // As a socket would: later, and as a copy, so that the screen never holds the controller's own objects.
  const deliver = (message: ServerToViewer): void => {
    const copy = JSON.parse(JSON.stringify(message)) as ServerToViewer;
    queueMicrotask(() => onMessage(copy));
  };
  controller.onEvent((event) => deliver(toMessage(event)));
  const peer = createViewerPeer({
    controller,
    send: deliver,
    hello: () => ({ type: 'hello', connect: '', port: 0, scenario }),
    reissueToken: () => undefined,
  });
  queueMicrotask(() => {
    onOpenChange(true);
    peer.greet();
  });
  return { send: (message) => peer.receive(JSON.stringify(message)) };
});
