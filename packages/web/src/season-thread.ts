import type { WorkerRequest, WorkerResponse } from '@turing-city/core';
import type { SeasonThread } from '@turing-city/server/game-controller';

/**
 * A season's thread in the web demo: a Web Worker running worker.ts. A browser shares no memory with a worker here (that needs a
 * cross-origin-isolated page), so the watchdog cannot tell which board stopped answering: progress always reads none.
 */
export function webSeasonThread(): SeasonThread {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  return {
    post: (message: WorkerRequest) => worker.postMessage(message),
    onMessage: (listener: (message: WorkerResponse) => void) =>
      worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => listener(event.data)),
    onError: (listener: (error: unknown) => void) => {
      worker.addEventListener('error', (event) => listener(new Error(event.message || 'the worker failed to load')));
      worker.addEventListener('messageerror', () => listener(new Error('a message from the worker could not be read')));
    },
    terminate: () => worker.terminate(),
    progress: () => [-1, 0],
  };
}
