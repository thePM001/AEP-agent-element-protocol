# Display API

Governed display API data for AEP 2.8.6. This folder holds the catalog and the grant wall that the Base Node display dock reads. The dock itself is kernel code at `AEP-Base-Node/AEP-Crate/src/dock_display.rs`.

## What the surface is

A frontend binds the display API and reads a JSON projection. Every request is one sealed lattice channel frame, so the agent identity, the session, the freshness window, the replay guard and the collect-all Admit pass run before any read. HTTP JSON and the JSON line protocol are both served on the display dock, with TLS and client certificates on port 28429 and a unix socket at the display suffix.

## Files

| File | Role |
|------|------|
| `lattice.yaml` | The display catalog. It carries the display action vocabulary and the named views, sources and sectors |
| `display-grants.gap` | The grant wall. One grant names one agent, one source and one sector. An empty list is refused |
| `source.alpha.json` | Locator file for the named source `source.alpha`. It carries the JSON of each named sector |
| `source.beta.json` | Locator file for the named source `source.beta` |
| `display-client.manifest.json` | Task manifest for the default client agent. The image entrypoint installs it into the manifest directory |

## Pre-staging

Base Node holds the pre-staging area in kernel state, keyed by a named source and a named sector. At boot the dock reads each locator and loads the JSON of every named sector of that source, so several sections of one store stage side by side with no client payload. A granted client may also ingest into one pair as a second path. The staged rows persist under the AEP data dir, the catalog maps each view to one pair and a projection reads that pair back after Admit.

## Named catalog

The packaged catalog maps two views, `view.alpha` and `view.beta`, onto the two sectors of `source.alpha`. An operator grows the surface by adding one locator file for a new source and one grant for a new agent or pair. An unknown view, an unknown source and an unknown sector are refused at the miss.

## Actions

| Action | Role |
|--------|------|
| `display-api:source:ingest` | Load JSON into the pre-staging pair |
| `display-api:sector:stage` | Stage a named sector |
| `display-api:view:request` | Request a named view |
| `display-api:view:project` | Project a named view after Admit |
| `display-api:catalog:list` | List the loaded views, sources and sectors for a granted agent |

## Grants and permissions

The grant wall binds an agent to a source and sector pair. The packaged wall gives the default client agent both sectors of the packaged source and it gives the fixture agent one pair. The action grant for the display family lives with the packaged GAP policies, because the kernel control hub reads its permission rows from the gap reference tree.

## Clients and tests

The reference clients live beside the lattice channel clients at `AEP-Components/lattice-channels/client/display-api/`. The TypeScript client and the Python client each ship a seal path, so a frontend author writes no seal code. Each client carries a live TLS JSON test and the folder carries a staging demonstration that proves several sectors of one source in one run.

## Operator document

The operator document is at `AEP-User-Experience/docs/DISPLAY-API.md`. It names the bind path, the two wires, the actions, the catalog, the grants and the independent check.
