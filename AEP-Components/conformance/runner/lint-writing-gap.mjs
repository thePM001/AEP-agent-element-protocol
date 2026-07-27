#!/usr/bin/env node
/**
 * CLI entry for writing.gap documentation lint (CC-16).
 * Usage: node AEP-Components/conformance/runner/lint-writing-gap.mjs [repo-root]
 */

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  formatWritingGapReport,
  lintWritingGapTree,
} from "../lib/writing-gap-lint.mjs";

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const root = resolve(process.argv[2] ?? defaultRoot);

const { violations, scanned } = lintWritingGapTree(root);
console.log(`writing.gap lint: scanned ${scanned} files under ${root}`);
console.log(formatWritingGapReport(violations));
process.exit(violations.length > 0 ? 1 : 0);