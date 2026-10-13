// Audio Worker entry point, run with utilityProcess.fork (ARCHITECTURE.md §3, §6).
import type { MessagePortMain } from 'electron';

import { MainToWorkerSchema } from '@nova/core';
import type { WorkerToMain } from '@nova/core';

import { AudioWorker } from './audio-worker';

const parentPort = process.parentPort;
const send = (message: WorkerToMain) => {
  parentPort.postMessage(message);
};
const worker = new AudioWorker({ send });
let framePort: MessagePortMain | undefined;

function closeFramePort(): void {
  framePort?.close();
  framePort = undefined;
}

parentPort.on('message', (event) => {
  const parsed = MainToWorkerSchema.safeParse(event.data);
  if (!parsed.success) {
    send({ type: 'error', message: 'Invalid control message' });
    return;
  }
  const message = parsed.data;
  switch (message.type) {
    case 'start': {
      const port = event.ports[0];
      if (!port) {
        send({ type: 'error', sessionId: message.sessionId, message: 'No frame port' });
        return;
      }
      closeFramePort();
      framePort = port;
      port.on('message', (frameEvent) => {
        worker.frame(frameEvent.data);
      });
      port.start();
      worker.start(message.sessionId, message.spoolPath);
      return;
    }
    case 'pause':
      worker.pause();
      return;
    case 'resume':
      worker.resume();
      return;
    case 'stop':
      closeFramePort();
      worker.stop();
      return;
    case 'analyze':
      void worker.analyze(message.requestId, message.spoolPath);
      return;
    default: {
      const _exhaustive: never = message;
      throw new Error(`Unhandled message: ${JSON.stringify(_exhaustive)}`);
    }
  }
});
