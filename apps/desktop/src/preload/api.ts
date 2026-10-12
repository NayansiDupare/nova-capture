import type { IpcRequest, IpcResponse } from '@nova/core';

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
};
