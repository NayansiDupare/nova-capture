import type { IpcEvent, IpcEventPayload, IpcRequest, IpcResponse } from '@nova/core';

/** Stops listening to an event. */
export type Unsubscribe = () => void;

/**
 * The API the main UI preload exposes as `window.nova`: one narrow function per IPC channel
 * (AGENTS.md §5). Main validates every call; there is deliberately no way to read a secret.
 */
export type NovaApi = {
  readonly settings: {
    get(): Promise<IpcResponse<'settings:get'>>;
    set(patch: IpcRequest<'settings:set'>): Promise<IpcResponse<'settings:set'>>;
  };
  readonly secrets: {
    set(request: IpcRequest<'secrets:set'>): Promise<IpcResponse<'secrets:set'>>;
  };
  readonly capture: {
    start(): Promise<IpcResponse<'capture:start'>>;
    stop(): Promise<IpcResponse<'capture:stop'>>;
    pause(): Promise<IpcResponse<'capture:pause'>>;
    resume(): Promise<IpcResponse<'capture:resume'>>;
  };
  readonly sessions: {
    retry(request: IpcRequest<'sessions:retry'>): Promise<IpcResponse<'sessions:retry'>>;
    discard(request: IpcRequest<'sessions:discard'>): Promise<IpcResponse<'sessions:discard'>>;
    transcript(
      request: IpcRequest<'sessions:transcript'>,
    ): Promise<IpcResponse<'sessions:transcript'>>;
  };
  /** Subscribes to a main → UI event. */
  on<E extends IpcEvent>(event: E, listener: (payload: IpcEventPayload<E>) => void): Unsubscribe;
};
