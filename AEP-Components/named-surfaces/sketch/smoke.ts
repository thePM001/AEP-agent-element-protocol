// Illustrative sketch, not a normative surface: a hand-run walk through the
// policy-engine transpilers (Cedar and Rego into GAP, GAP back out).
// It is typechecked with the tree but has no tests; the transpiler tests live in policy-engine.

import { transpileCedarToGap } from "../../policy-engine/lib/policy/transpilers/cedar-to-gap.js";
import { transpileRegoToGap } from "../../policy-engine/lib/policy/transpilers/rego-to-gap.js";
import { transpileGapToCedar } from "../../policy-engine/lib/policy/transpilers/gap-to-cedar.js";
import { transpileGapToRego } from "../../policy-engine/lib/policy/transpilers/gap-to-rego.js";

function main(): void {
  let emptyCedarThrew = false;
  try {
    transpileCedarToGap("  ");
  } catch (_e) {
    emptyCedarThrew = true;
  }
  if (emptyCedarThrew === false) {
    throw new Error("empty Cedar must throw");
  }

  const cedar = 'forbid (principal == User::"alice", action == Action::"delete", resource);';
  const gapFromCedar = transpileCedarToGap(cedar);
  if (gapFromCedar.indexOf('"address"') < 0 || gapFromCedar.indexOf("pattern") < 0) {
    throw new Error("Cedar to GAP missing address pattern");
  }

  const rego = 'package aep.demo\n\ndeny[msg] {\n  input.bad == true\n  msg := sprintf("bad input", [])\n}\n';
  const gapFromRego = transpileRegoToGap(rego);
  if (gapFromRego.indexOf('"address"') < 0 || gapFromRego.indexOf("aep.demo") < 0) {
    throw new Error("Rego to GAP missing address");
  }

  const cedarBack = transpileGapToCedar(gapFromCedar);
  if (cedarBack.indexOf("forbid") < 0 && cedarBack.indexOf("permit") < 0) {
    throw new Error("GAP to Cedar missing statements");
  }

  const regoBack = transpileGapToRego(gapFromRego);
  if (regoBack.indexOf("package ") !== 0 || regoBack.indexOf("deny[msg]") < 0) {
    throw new Error("GAP to Rego missing package deny");
  }

  process.stdout.write("named-surfaces smoke ok\n");
}

try {
  main();
} catch (e) {
  process.stderr.write(String(e instanceof Error ? e.stack || e.message : e) + "\n");
  process.exit(1);
}
