import { readFileSync } from "node:fs";
import YAML from "yaml";
import { PolicySchema, type Policy } from "./types.js";

export function loadPolicy(path: string): Policy {
  const raw = readFileSync(path, "utf-8");
  const parsed = YAML.parse(raw);
  return validatePolicy(parsed);
}

export function validatePolicy(data: unknown): Policy {
  const result = PolicySchema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid policy:\n${issues}`);
  }
  return result.data;
}
