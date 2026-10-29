import { join } from "node:path";
import { transpileCedarToGap } from "../policy-engine/lib/policy/transpilers/cedar-to-gap.ts";
import { transpileRegoToGap } from "../policy-engine/lib/policy/transpilers/rego-to-gap.ts";
import { transpileGapToCedar } from "../policy-engine/lib/policy/transpilers/gap-to-cedar.ts";
import { transpileGapToRego } from "../policy-engine/lib/policy/transpilers/gap-to-rego.ts";
import { forwardMcpCall } from "../proxy/lib/mcp-backend.ts";

async function main(): Promise<void> {
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

  const echoPath = join(process.cwd(), "AEP-Components/named-surfaces/mcp-echo.js");
  const mcp = await forwardMcpCall(
    { name: "echo", command: "node", args: [echoPath], transport: "stdio" },
    { name: "echo", arguments: { ping: "pong" } },
    9000
  );
  if (mcp.isError === true) {
    throw new Error("MCP stdio forward failed: " + JSON.stringify(mcp));
  }
  const text = mcp.content[0] && mcp.content[0].text ? mcp.content[0].text : "";
  if (text.indexOf("forwarded") < 0 && text.indexOf("pong") < 0) {
    throw new Error("MCP stdio result missing payload: " + text);
  }

  process.stdout.write("named-surfaces smoke ok\n");
}

main().catch((e) => {
  process.stderr.write(String(e instanceof Error ? e.stack || e.message : e) + "\n");
  process.exit(1);
});
