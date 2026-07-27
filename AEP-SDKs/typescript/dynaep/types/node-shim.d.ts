/** Minimal Node globals for dynaep production build (no @types/node install). */
declare const process: {
  env: Record<string, string | undefined>;
  cwd(): string;
  execPath: string;
  execSync(command: string, options?: Record<string, unknown>): string | Buffer;
  hrtime: {
    (time?: [number, number]): [number, number];
    bigint(): bigint;
  };
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const require: ((id: string) => any) & { resolve(id: string): string };
declare class Buffer extends Uint8Array {
  static from(data: string, encoding?: string): Buffer;
  static alloc(size: number): Buffer;
  static isBuffer(value: unknown): boolean;
  toString(encoding?: string): string;
  readUInt32BE(offset: number): number;
}

declare module "fs" {
  export function readFileSync(path: string, encoding?: string): string;
  export function writeFileSync(path: string, data: string, encoding?: string): void;
  export function appendFileSync(path: string, data: string, encoding?: string): void;
  export function existsSync(path: string): boolean;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
  export function renameSync(oldPath: string, newPath: string): void;
  export function unlinkSync(path: string): void;
  export function readdirSync(path: string): string[];
  export function statSync(path: string): { isFile(): boolean; isDirectory(): boolean; size: number };
}

declare module "path" {
  export function join(...parts: string[]): string;
  export function resolve(...parts: string[]): string;
  export function dirname(path: string): string;
  export function basename(path: string): string;
}

declare module "dgram" {
  export function createSocket(type: string): {
    bind(port: number, host?: string): void;
    on(event: string, listener: (...args: unknown[]) => void): void;
    send(
      msg: Uint8Array,
      offset: number,
      length: number,
      port: number,
      host: string,
      callback?: (err: Error | null) => void,
    ): void;
    close(): void;
  };
}

declare module "crypto" {
  export function createHash(algorithm: string): {
    update(data: string): { digest(encoding: string): string };
  };
}

declare module "node:child_process" {
  export function execFileSync(
    file: string,
    args?: string[],
    options?: Record<string, unknown>,
  ): string | Buffer;
  export function spawnSync(
    command: string,
    args?: string[],
    options?: Record<string, unknown>,
  ): { status: number | null; stdout: Buffer | string; stderr: Buffer | string };
  export interface ChildProcess {
    stdin: { write(data: string): void } | null;
    stdout: { once(event: "data", listener: (chunk: Buffer | string) => void): void } | null;
    exitCode: number | null;
  }
  export function spawn(command: string, args?: string[]): ChildProcess;
}

declare module "node:fs" {
  export * from "fs";
}

declare module "node:path" {
  export * from "path";
}

declare module "node:os" {
  export function homedir(): string;
}

declare module "node:net" {
  export function connect(options: { path: string }): unknown;
}

declare module "node:crypto" {
  export function createHash(algorithm: string): {
    update(data: string): { digest(encoding: string): string };
  };
}

declare module "node:url" {
  export function fileURLToPath(url: string | URL): string;
}

declare module "js-yaml" {
  export function load(src: string): unknown;
}