#!/usr/bin/env npx tsx
/**
 * Stdin JSON → stdout JSON bridge for Schema Builder + Policy Builder (AEP 2.8).
 */
import { readFileSync } from "node:fs";
import { SchemaBuilder } from "../../AEP-Policy-System/schema-builder/lib/schema-builder.js";
import { PolicyBuilder } from "../../AEP-Policy-System/policy-builder/lib/policy-builder.js";
import type { SchemaCandidate, InvariantManifest } from "../../AEP-Policy-System/schema-builder/lib/types.js";

type Request =
  | {
      action: "validate_schema";
      schema: SchemaCandidate;
      historicalData?: Record<string, unknown>[];
      regoRules?: string[];
    }
  | {
      action: "build_policy";
      schema: SchemaCandidate;
      domain: string;
      historicalData?: Record<string, unknown>[];
      manifest?: InvariantManifest;
    }
  | {
      action: "validate_policy";
      schema: SchemaCandidate;
      rules: string[];
      manifest?: InvariantManifest;
      historicalData?: Record<string, unknown>[];
    };

function readInput(): Request {
  const raw = readFileSync(0, "utf8").trim();
  if (!raw) throw new Error("empty stdin");
  return JSON.parse(raw) as Request;
}

function main() {
  const input = readInput();
  if (input.action === "validate_schema") {
    const builder = new SchemaBuilder();
    const result = builder.validateSchema(input.schema, {
      historicalData: input.historicalData,
      regoRules: input.regoRules,
    });
    process.stdout.write(JSON.stringify({ ok: true, result }));
    return;
  }
  if (input.action === "build_policy") {
    const builder = new PolicyBuilder();
    const built = builder.buildPolicy(input.schema, input.domain, {
      historicalData: input.historicalData,
      manifest: input.manifest,
    });
    process.stdout.write(JSON.stringify({ ok: true, result: built }));
    return;
  }
  if (input.action === "validate_policy") {
    const builder = new PolicyBuilder();
    const result = builder.validatePolicy(
      input.schema,
      input.rules,
      input.manifest,
      { historicalData: input.historicalData },
    );
    process.stdout.write(JSON.stringify({ ok: true, result }));
    return;
  }
  throw new Error(`unknown action: ${(input as { action?: string }).action}`);
}

try {
  main();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stdout.write(JSON.stringify({ ok: false, error: message }));
  process.exit(1);
}