/**
 * Types of the exports of lattice-transport.mjs that TypeScript callers use. The gated
 * fetch in lattice-gated-fetch.ts takes its name lookup and its frame seal from the
 * transport, so the two never hold a second copy. Add a declaration here when a
 * TypeScript caller needs another export of the transport.
 */

import type { EgressLookup } from "../../egress-address/lib/egress-address.mjs";

/** The answer of aep-lattice-log build-frame. */
export type TransportSealedFrame = { frame: Record<string, unknown> } & Partial<
  Record<"signer_public_hex" | "signerPublicHex", string>
>;

/** The config file and the binary of a frame seal. Each falls back to the default. */
export type BuildFrameOptions = Partial<Record<"configPath" | "latticeLogBin", string | undefined>>;

/** The egress address check, with the name lookup of the transport when lookup is undefined. */
export declare function assertUrlNotSsrf(urlInput: string | URL): void;
export declare function assertUrlNotSsrf(urlInput: string | URL, lookup: EgressLookup | undefined): void;
export declare function assertUrlNotSsrf(
  urlInput: string | URL,
  lookup: EgressLookup | undefined,
  env: NodeJS.ProcessEnv,
): void;

/** AEP_LATTICE_LOG_BIN, AEP_LATTICE_LOG_CLI, a repository build or the installed binary. */
export declare function resolveLatticeLogBin(): string;
export declare function resolveLatticeLogBin(env: NodeJS.ProcessEnv): string;

/** Seal an event as a lattice frame with aep-lattice-log build-frame. */
export declare function buildLatticeFrame(event: Record<string, unknown>): TransportSealedFrame;
export declare function buildLatticeFrame(
  event: Record<string, unknown>,
  opts: BuildFrameOptions,
): TransportSealedFrame;
