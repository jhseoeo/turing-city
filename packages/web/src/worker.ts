/// <reference lib="webworker" />
import type { WorkerRequest, WorkerResponse } from '@turing-city/core';
import { createSeasonWorker } from '@turing-city/server/season-worker';
import wasmUrl from 'wasmoon/dist/glue.wasm?url';

/** The season's thread in the web demo: the server's season worker, in a Web Worker, with Lua's WebAssembly from the page's files. */
const scope = self as unknown as DedicatedWorkerGlobalScope;
const receive = createSeasonWorker({ post: (message: WorkerResponse) => scope.postMessage(message), wasmUrl });
scope.addEventListener('message', (event: MessageEvent<WorkerRequest>) => receive(event.data));
