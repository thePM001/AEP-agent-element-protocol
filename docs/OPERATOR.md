# Operator path (AEP 2.8.5)

AEP 2.8.5 is a protocol library and a local kernel rather than a drop-in product that replaces a stack on first boot. The builder presents a manifest and a sealed capsule. Base Node freezes the clock at seal, waits the compiled 1000 ms pulse, runs every written wall together, records the ledger and applies only after Admit. This file is the operator path, it does not replace the root README that the operator owns and BIOSECURITY.md is not required to deploy.

Docker is the first operator path and source build is secondary for changing compiled pulse constants.

## Docker first

Copy the env example to env, set COMPOSER_LITE_SETUP_TOKEN and start the public compose file so Composer Lite listens on 8424, optional UCB listens on 8412 and Prime Agent and Polygres stay off the default compose services.

cp .env.example .env

openssl rand -hex 32

docker compose -f docker-compose.public.yml up -d --build

After the container is up, open the install wizard on loopback port 8424 and send X-AEP-Setup-Token on API calls. UCB starts when UCB=1. Set UCB=0 when foreign attach is not wanted. Default Predicate Profile is perimeter-v1. Public UCB compiles provided GAP text or JSON with the local gap-manifest-v1 compiler.

## Source build (secondary)

Install a Rust toolchain and build Base Node from the repository root when you need to rebuild compiled PULSE_MS, keeping freeze-at-seal, leaving MAX_DRIFT_MS off 1000, keeping MAX_AGE_MS longer than PULSE_MS and treating NTP LARGE_STEP as not this wait.

cargo build --release -p aep-base-node

## Kernel sequence

Base Node is the only live evaluator, enqueue is not Admit, TypeScript processEvent is not product Admit and the theme yaml file has no Admit authority. UCB is an attach gateway not a second evaluator, CAW is an execution companion not a second evaluator, Lattice Memory never admits, looking similar to a past allow is not allow and an empty agent permission list refuses.

## Glossary

Admit is the collect-all wall pass after the compiled pulse, Apply runs only after Admit allows and DenyReport is the frozen refuse body. CORRECTWRITING_EN is the public writing policy name, class is writing, wall ids are writing:* and pulse is compiled PULSE_MS 1000. Agent permission is the protocol word for who is written as allowed to act, CAW wraps host commands and is not raw bash and UCB requires a task manifest and does not synthesize one. Ingest ACK waits for collect-all Admit allow before the UCB journal is persisted.

## Operator docs

Read docs/ERROR-CATALOG.md for deny dialect and BaseNodeError. Read docs/WHAT-IS-COMPILED.md for pulse constants. Read docs/LATTICE-MEMORY.md for sqlite, memory and optional Polygres backends. Read docs/FOREIGN-ATTACH.md for manifest and session refuses. Read docs/TREE.md for Kernel, Protocol, Execution, UX and Policy. Read TARGET.md for ISA, RAM, disk, GPU, RSS and latency floors. Read examples/minimal-wrap for a documented command that returns allow true.

## Keys that look like crypto death

SealKey, DockKem and SignKey refuses are often mode and provision repairs. chmod 0600 on dock-seal.key, dock-kem and agent-sign-keys. Provision a missing sign key with aep-base-node --provision-agent-sign-key --agent-id AGENT_ID. See docs/ERROR-CATALOG.md.
