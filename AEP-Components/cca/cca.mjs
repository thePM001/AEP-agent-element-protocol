#!/usr/bin/env node
/**
 * CCA CLI - Central Setup Agent
 */

import { expandHome, defaultPaths } from "../wizard/lib/paths.mjs";
import { probeEnvironment } from "./lib/environment-probe.mjs";
import { buildRegistryContext } from "./lib/registry-context.mjs";
import { generatePlanFromIntent } from "./lib/plan-generator.mjs";
import { executeImplementationPlan, loadActivePlan, writeActivePlan } from "./lib/plan-executor.mjs";
import { validatePlanAgainstRegistry } from "./lib/plan-schema.mjs";
import { runCcaChat } from "./lib/chat.mjs";
import { loadGapContext, formatGapForPrompt } from "./lib/gap-context.mjs";

function parseArgs(argv) {
  const cmd = argv[0] ?? "help";
  const intentIdx = argv.indexOf("--intent");
  return {
    cmd,
    intent: intentIdx >= 0 ? argv.slice(intentIdx + 1).join(" ").trim() : null,
    execute: argv.includes("--execute"),
    dataDir: argv.find((a) => a.startsWith("--data-dir="))?.split("=")[1],
    nonInteractive: argv.includes("--non-interactive"),
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const paths = defaultPaths();
  const dataDir = expandHome(opts.dataDir ?? paths.dataDir);

  switch (opts.cmd) {
    case "probe": {
      const env = await probeEnvironment(process.env);
      console.log(JSON.stringify(env, null, 2));
      return;
    }
    case "context": {
      const ctx = await buildRegistryContext(dataDir, process.env);
      console.log(JSON.stringify(ctx, null, 2));
      return;
    }
    case "gap": {
      const gap = loadGapContext();
      console.log(formatGapForPrompt(gap));
      return;
    }
    case "plan": {
      if (!opts.intent) {
        console.error("Usage: aep-cca plan --intent \"your deployment description\" [--execute]");
        process.exit(1);
      }
      const { plan, validation } = await generatePlanFromIntent(opts.intent, dataDir, process.env);
      writeActivePlan(dataDir, plan);
      console.log(JSON.stringify({ plan, validation }, null, 2));
      if (opts.execute) {
        const result = await executeImplementationPlan(plan, { dataDir });
        console.log(JSON.stringify({ executed: true, report: result.report }, null, 2));
      }
      return;
    }
    case "execute": {
      const plan = loadActivePlan(dataDir);
      if (!plan) {
        console.error("No active plan. Run: aep-cca plan --intent \"...\"");
        process.exit(1);
      }
      const result = await executeImplementationPlan(plan, { dataDir });
      console.log(JSON.stringify(result.report, null, 2));
      return;
    }
    case "validate": {
      const plan = loadActivePlan(dataDir);
      if (!plan) {
        console.error("No active plan.");
        process.exit(1);
      }
      const ctx = await buildRegistryContext(dataDir, process.env);
      const validation = validatePlanAgainstRegistry(plan, ctx.components, ctx.environment);
      console.log(JSON.stringify(validation, null, 2));
      process.exit(validation.valid ? 0 : 1);
      return;
    }
    case "chat": {
      if (!opts.intent) {
        console.error("Usage: aep-cca chat --intent \"your message\"");
        process.exit(1);
      }
      const result = await runCcaChat(dataDir, { message: opts.intent });
      console.log(result.reply);
      if (result.plan) writeActivePlan(dataDir, result.plan);
      return;
    }
    default:
      console.log(`CCA - Central Setup Agent

Commands:
  aep-cca probe              Environment hardware profile
  aep-cca context            Full registry knowledge bundle (includes gap)
  aep-cca gap                GAP language summary for agents
  aep-cca plan --intent ".."  Generate ImplementationPlan [--execute]
  aep-cca execute            Execute active plan
  aep-cca validate           Validate active plan
  aep-cca chat --intent ".." Interactive planning chat
`);
  }
}

main().catch((err) => {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
});