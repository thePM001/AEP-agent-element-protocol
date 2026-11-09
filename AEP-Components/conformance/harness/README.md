# AEP conformance harness

Node harness for the vitest checks of the public conformance battery. `package.json` declares the harness toolchain and the lock file pins it. Install with `npm ci` from this folder. Nothing here is published to a registry.

`vitest.config.mjs` runs the files in `../tests` that end in `.test.mjs`. A test whose name starts with a check id such as `CC-17` counts toward that check when `run.sh` accounts for the run. The kernel binaries come from the release build unless `AEP_LATTICE_LOG_BIN` and `AEP_MEMORY_CLI` name them. run.sh provisions the kernel fixtures the checks sign with and names their folder in `AEP_CONFORMANCE_FIXTURES`.

Part of the AEP 2.9 release line.
