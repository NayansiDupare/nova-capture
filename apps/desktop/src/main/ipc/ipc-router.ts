import { IPC_CHANNELS } from '@nova/core';
import type { IpcChannel, IpcParsedRequest, IpcResponse } from '@nova/core';

import { log } from '../log';

/** What the router needs from an `ipcMain.handle` event. `IpcMainInvokeEvent` satisfies it. */
export type InvokeEvent = {
  readonly sender: { readonly id: number };
  readonly senderFrame: { readonly parent: unknown } | null;
};

/** The part of `ipcMain` the router uses; injected so tests run without Electron. */
export type IpcHandleTarget<E extends InvokeEvent> = {
  handle(channel: string, listener: (event: E, ...args: unknown[]) => unknown): void;
};

/** One handler per channel. The mapped type makes a missing handler a compile error. */
export type IpcHandlers = {
  readonly [C in IpcChannel]: (
    request: IpcParsedRequest<C>,
  ) => IpcResponse<C> | Promise<IpcResponse<C>>;
};

/** Sent to the renderer as the rejection message. Never includes payload contents. */
export class IpcRequestError extends Error {
  constructor(
    readonly channel: IpcChannel,
    reason: string,
  ) {
    super(`${channel}: ${reason}`);
    this.name = 'IpcRequestError';
  }
}

/**
 * Registers every channel in {@link IPC_CHANNELS}. Each call is checked in order: trusted sender,
 * at most one argument, request schema; the handler's reply is validated against the response
 * schema before it leaves main (SECURITY.md §4).
 */
export function registerIpcHandlers<E extends InvokeEvent>(
  ipc: IpcHandleTarget<E>,
  handlers: IpcHandlers,
  isTrustedSender: (event: E) => boolean,
): void {
  for (const channel of Object.keys(IPC_CHANNELS) as IpcChannel[]) {
    ipc.handle(channel, createListener(channel, handlers[channel], isTrustedSender));
  }
}

function createListener<C extends IpcChannel, E extends InvokeEvent>(
  channel: C,
  handler: IpcHandlers[C],
  isTrustedSender: (event: E) => boolean,
) {
  const { request, response } = IPC_CHANNELS[channel];

  return async (event: E, ...args: unknown[]): Promise<IpcResponse<C>> => {
    if (!isTrustedSender(event)) {
      log.warn('rejected IPC from untrusted sender', { channel, senderId: event.sender.id });
      throw new IpcRequestError(channel, 'untrusted sender');
    }
    if (args.length > 1) {
      log.warn('rejected IPC with extra arguments', { channel, count: args.length });
      throw new IpcRequestError(channel, 'unexpected arguments');
    }
    const parsed = request.safeParse(args[0]);
    if (!parsed.success) {
      // Paths and codes only: the payload may hold an API key.
      const issues = parsed.error.issues.map(({ path, code }) => ({ path: path.join('.'), code }));
      log.warn('rejected invalid IPC payload', { channel, issues });
      throw new IpcRequestError(channel, 'invalid payload');
    }
    // TypeScript cannot narrow the channel-indexed schema union back to `C`; the schema is C's own.
    const result = await handler(parsed.data as IpcParsedRequest<C>);
    return response.parse(result) as IpcResponse<C>;
  };
}
