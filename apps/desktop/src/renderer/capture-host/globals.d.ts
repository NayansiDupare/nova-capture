import type { CaptureHostApi, CaptureHostBridge } from '../../preload/capture-host-api';

declare global {
  interface Window {
    readonly novaCaptureHostBridge: CaptureHostBridge;
    novaCaptureHost: CaptureHostApi;
  }

  // AudioWorkletGlobalScope is not in TypeScript's DOM lib.
  abstract class AudioWorkletProcessor {
    readonly port: MessagePort;
    abstract process(
      inputs: Float32Array[][],
      outputs: Float32Array[][],
      parameters: Record<string, Float32Array>,
    ): boolean;
  }
  function registerProcessor(name: string, processor: new () => AudioWorkletProcessor): void;
}
