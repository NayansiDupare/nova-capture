import { closeSync, fsyncSync, mkdirSync, openSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';

import { pcmToBytes } from '@nova/core';

/** 60 s of 100 ms frames. Beyond this the disk has stalled and frames are dropped (and counted). */
export const DEFAULT_MAX_PENDING_FRAMES = 600;

/**
 * Appends raw 16-bit little-endian PCM to the session's spool file (ARCHITECTURE.md §6).
 *
 * Frames are queued in a bounded buffer and written by {@link SpoolWriter.flush}, which also
 * fsyncs, so a crash loses at most one flush interval. The file is opened in append mode:
 * a respawned worker continues the same spool instead of truncating it.
 */
export class SpoolWriter {
  private readonly fd: number;
  private pending: Int16Array[] = [];
  private unwritten = new Uint8Array(0);
  private isClosed = false;
  private written = 0;
  private dropped = 0;

  constructor(
    readonly path: string,
    private readonly maxPendingFrames: number = DEFAULT_MAX_PENDING_FRAMES,
  ) {
    mkdirSync(dirname(path), { recursive: true });
    this.fd = openSync(path, 'a');
  }

  get bytesWritten(): number {
    return this.written;
  }

  get droppedFrames(): number {
    return this.dropped;
  }

  /** Queues a frame. Returns false if it was dropped because the buffer is full. */
  append(frame: Int16Array): boolean {
    if (this.isClosed) {
      throw new Error('SpoolWriter is closed');
    }
    if (this.pending.length >= this.maxPendingFrames) {
      this.dropped++;
      return false;
    }
    this.pending.push(frame);
    return true;
  }

  /**
   * Writes and fsyncs everything queued. If a write fails part-way, the unwritten bytes are
   * kept and retried first on the next flush, so nothing is lost or written twice.
   *
   * @throws the underlying I/O error (for example disk full).
   */
  flush(): void {
    if (this.pending.length === 0 && this.unwritten.length === 0) {
      return;
    }
    const total = this.pending.reduce((n, f) => n + f.length, 0);
    const samples = new Int16Array(total);
    let offset = 0;
    for (const frame of this.pending) {
      samples.set(frame, offset);
      offset += frame.length;
    }
    this.pending = [];
    const bytes = concat(this.unwritten, pcmToBytes(samples));
    let done = 0;
    try {
      while (done < bytes.length) {
        done += writeSync(this.fd, bytes, done, bytes.length - done);
      }
      fsyncSync(this.fd);
      this.unwritten = new Uint8Array(0);
    } catch (error) {
      this.unwritten = bytes.slice(done);
      throw error;
    } finally {
      this.written += done;
    }
  }

  /** Flushes and closes. Safe to call twice. */
  close(): void {
    if (this.isClosed) {
      return;
    }
    try {
      this.flush();
    } finally {
      this.isClosed = true;
      closeSync(this.fd);
    }
  }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length === 0) {
    return b;
  }
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}
