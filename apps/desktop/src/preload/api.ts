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
  readonly notes: {
    draft(request: IpcRequest<'notes:draft'>): Promise<IpcResponse<'notes:draft'>>;
    save(request: IpcRequest<'notes:save'>): Promise<IpcResponse<'notes:save'>>;
    list(request: IpcRequest<'notes:list'>): Promise<IpcResponse<'notes:list'>>;
    get(request: IpcRequest<'notes:get'>): Promise<IpcResponse<'notes:get'>>;
    search(request: IpcRequest<'notes:search'>): Promise<IpcResponse<'notes:search'>>;
    update(request: IpcRequest<'notes:update'>): Promise<IpcResponse<'notes:update'>>;
    delete(request: IpcRequest<'notes:delete'>): Promise<IpcResponse<'notes:delete'>>;
  };
  /** Subscribes to a main → UI event. */
  on<E extends IpcEvent>(event: E, listener: (payload: IpcEventPayload<E>) => void): Unsubscribe;
};
