/** Types of egress-address.mjs for the TypeScript callers. */

export type AddressClass =
  | "public"
  | "loopback"
  | "unspecified"
  | "private"
  | "shared"
  | "link_local"
  | "reserved";

export type EgressDenyKind = "invalid" | "scheme" | "userinfo" | "name" | "address" | "lookup" | "no_address";

export interface EgressPolicy {
  allowLoopback: boolean;
  allowPrivate: boolean;
}

export interface EgressTarget {
  url: URL;
  host: string;
  port: number;
  literal: string | null;
}

export type EgressLookup = (host: string) => string[];

export declare const ADDRESS_CLASSES: readonly AddressClass[];
export declare const V4_RANGES: readonly (readonly [number, number, AddressClass])[];
export declare const V6_RANGES: readonly (readonly [bigint, number, AddressClass])[];

export declare class EgressDeny extends Error {
  constructor(kind: EgressDenyKind, message: string);
  constructor(kind: EgressDenyKind, message: string, addressClass: AddressClass);
  readonly kind: EgressDenyKind;
  readonly addressClass: AddressClass | undefined;
}

export declare function parseIpv4(text: string): number | null;
export declare function parseIpv6(text: string): bigint | null;
export declare function classifyV4(addr: number): AddressClass;
export declare function classifyV6(addr: bigint): AddressClass;
export declare function classifyAddress(text: string): AddressClass | null;
export declare function egressPolicyFromEnv(): EgressPolicy;
export declare function egressPolicyFromEnv(env: NodeJS.ProcessEnv): EgressPolicy;
export declare function policyAllows(policy: EgressPolicy, cls: AddressClass): boolean;
export declare function nameClass(host: string): AddressClass | null;
export declare function checkUrl(urlInput: string | URL, policy: EgressPolicy): EgressTarget;
export declare function checkResolved(addrs: string[], policy: EgressPolicy): string[];
export declare function assertUrlEgress(urlInput: string | URL, lookup: EgressLookup, policy: EgressPolicy): string[];

export declare const GATEWAY_ACTION_PATH: "gateway:outbound_http";
export declare function assertLatticeUrl(urlInput: string | URL, lookup: EgressLookup): string[];
export declare function assertLatticeUrl(
  urlInput: string | URL,
  lookup: EgressLookup,
  env: NodeJS.ProcessEnv,
): string[];
