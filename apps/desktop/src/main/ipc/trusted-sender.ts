import type { InvokeEvent } from './ipc-router';

/**
 * True when the call comes from the top frame of one of our own windows (SECURITY.md §4).
 * Subframes are rejected; our pages have none, so one appearing means something is wrong.
 */
export function isTrustedSender(
  event: InvokeEvent,
  trustedWebContentsIds: ReadonlySet<number>,
): boolean {
  return (
    trustedWebContentsIds.has(event.sender.id) &&
    event.senderFrame !== null &&
    event.senderFrame.parent === null
  );
}
