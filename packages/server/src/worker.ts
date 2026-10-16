import { parentPort, workerData } from 'node:worker_threads';
import type { WorkerRequest } from '@turing-city/core';
import { createSeasonWorker } from './season-worker.ts';

if (!parentPort) throw new Error('worker.ts runs as a worker thread');
const port = parentPort;
/** [board index or -1, firmware version]: what the watchdog reports if this thread stops answering. */
const progress = new Int32Array((workerData as { progress: SharedArrayBuffer }).progress);

const receive = createSeasonWorker({
  post: (message) => port.postMessage(message),
  // Written into shared memory around each tick, where the controller reads it even while this thread is stuck in one.
  progress: (index, version) => {
    if (index >= 0) Atomics.store(progress, 1, version);
    Atomics.store(progress, 0, index);
  },
});
port.on('message', (message: WorkerRequest) => receive(message));
