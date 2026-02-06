/**
 * Where bytes live.
 *
 * A narrow port, because everything above it wants to be testable without a
 * disk and because the same journal has to work against a file, against memory
 * in a test, and against whatever a grading container gives it.
 *
 * Append is the only write the journal needs and the only one that can be made
 * crash safe cheaply, so it is the only one offered. There is deliberately no
 * seek, no overwrite and no delete of part of a file: a store that can only
 * append cannot corrupt what it already wrote.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface Storage {
  /** Read a whole file. An absent file reads as empty rather than throwing. */
  read(name: string): string;
  /** Add to the end of a file, creating it if it is not there. */
  append(name: string, text: string): void;
  /** Replace a file wholesale. Used for snapshots, never for the journal. */
  write(name: string, text: string): void;
  exists(name: string): boolean;
  /** Every name written so far, for a caller that needs to enumerate. */
  names(): string[];
}

/** A store that keeps everything in memory. The one tests run against. */
export class MemoryStorage implements Storage {
  private readonly files = new Map<string, string>();

  read(name: string): string {
    return this.files.get(name) ?? '';
  }

  append(name: string, text: string): void {
    this.files.set(name, (this.files.get(name) ?? '') + text);
  }

  write(name: string, text: string): void {
    this.files.set(name, text);
  }

  exists(name: string): boolean {
    return this.files.has(name);
  }

  names(): string[] {
    return [...this.files.keys()].sort();
  }
}

/**
 * A store backed by the filesystem.
 *
 * Every write is synchronous on purpose. The journal is the record of what the
 * station is about to broadcast, and an append that is still buffered when the
 * process is killed is an append that did not happen.
 */
export class FileStorage implements Storage {
  private readonly written = new Set<string>();

  constructor(private readonly root: string) {}

  private path(name: string): string {
    return `${this.root}/${name}`;
  }

  private ensureDirectory(name: string): void {
    const directory = dirname(this.path(name));
    if (!existsSync(directory)) {
      mkdirSync(directory, { recursive: true });
    }
  }

  read(name: string): string {
    const path = this.path(name);
    return existsSync(path) ? readFileSync(path, 'utf8') : '';
  }

  append(name: string, text: string): void {
    this.ensureDirectory(name);
    appendFileSync(this.path(name), text, 'utf8');
    this.written.add(name);
  }

  write(name: string, text: string): void {
    this.ensureDirectory(name);
    writeFileSync(this.path(name), text, 'utf8');
    this.written.add(name);
  }

  exists(name: string): boolean {
    return existsSync(this.path(name));
  }

  names(): string[] {
    return [...this.written].sort();
  }
}
