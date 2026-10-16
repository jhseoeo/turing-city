import { Worker } from 'node:worker_threads';
import type { WorkerRequest, WorkerResponse } from '@turing-city/core';
import type { SeasonThread } from './game-controller.ts';

/**
 * A season's thread on the server: a Node worker thread running worker.ts. Which board is ticking lives in shared memory, so the
 * controller's watchdog reads it even while the thread is stuck in a tick.
 */
export interface NodeSeasonThread extends SeasonThread {
  /** The worker thread itself, and the shared [board index, version] it writes: what a test reaches into. */
  readonly thread: Worker;
  readonly shared: Int32Array;
}

export function nodeSeasonThread(): NodeSeasonThread {
  const progress = new Int32Array(new SharedArrayBuffer(8));
  progress[0] = -1;
  // Node strips the worker's types itself and warns about it once per thread; the server runs with this flag already.
  const worker = new Worker(new URL('./worker.ts', import.meta.url), {
    workerData: { progress: progress.buffer },
    execArgv: ['--disable-warning=ExperimentalWarning'],
  });
  return {
    thread: worker,
    shared: progress,
    post: (message: WorkerRequest) => worker.postMessage(message),
    onMessage: (listener: (message: WorkerResponse) => void) => worker.on('message', listener),
    onError: (listener: (error: unknown) => void) => worker.on('error', listener),
    terminate: () => void worker.terminate(),
    progress: () => [Atomics.load(progress, 0), Atomics.load(progress, 1)],
  };
}
