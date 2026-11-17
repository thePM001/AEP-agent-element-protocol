address:
  domain: dev.aep.caw
  id: toolsets.v1

pattern: |
  Named program lists for CAW sessions. A sandbox holds only the programs of its toolset.

action:
  type: structured
  schema: CawToolsetSet
  structured_generation: false
  content: |
    Materialize the core-tools, coding-tools and rust-draft-tools program lists.

weight: 1.0

composition:
  type: atomic

metadata:
  provenance: "aep.2.8.seed"
  version: "1.0.0"
  stability: stable
  agent_permission:
    - agent_id: coding-agent
      action: compile
    - agent_id: coding-agent
      action: write
  wrap: caw
  action_path_prefix: caw
  aspect: objective

types:
  CawToolsetSet:
    format: json
    fields:
      records: array

extensions:
  aep:
    subprotocols:
      caw:
        validator: caw
        actions: [policy_compile]

---
kind: aep.caw.toolset
name: core-tools
description: Shell and file tools
programs:
  - name: sh
    source: /usr/bin/sh
  - name: env
    source: /usr/bin/env
  - name: cat
    source: /usr/bin/cat
  - name: ls
    source: /usr/bin/ls
  - name: cp
    source: /usr/bin/cp
  - name: mv
    source: /usr/bin/mv
  - name: mkdir
    source: /usr/bin/mkdir
  - name: rm
    source: /usr/bin/rm
  - name: grep
    source: /usr/bin/grep
  - name: sed
    source: /usr/bin/sed
  - name: head
    source: /usr/bin/head
  - name: tail
    source: /usr/bin/tail
  - name: find
    source: /usr/bin/find
  - name: sort
    source: /usr/bin/sort
  - name: wc
    source: /usr/bin/wc
---
kind: aep.caw.toolset
name: coding-tools
description: Shell and file tools plus git, diff, patch and tar
programs:
  - name: sh
    source: /usr/bin/sh
  - name: env
    source: /usr/bin/env
  - name: cat
    source: /usr/bin/cat
  - name: ls
    source: /usr/bin/ls
  - name: cp
    source: /usr/bin/cp
  - name: mv
    source: /usr/bin/mv
  - name: mkdir
    source: /usr/bin/mkdir
  - name: rm
    source: /usr/bin/rm
  - name: grep
    source: /usr/bin/grep
  - name: sed
    source: /usr/bin/sed
  - name: head
    source: /usr/bin/head
  - name: tail
    source: /usr/bin/tail
  - name: find
    source: /usr/bin/find
  - name: sort
    source: /usr/bin/sort
  - name: wc
    source: /usr/bin/wc
  - name: git
    source: /usr/bin/git
  - name: diff
    source: /usr/bin/diff
  - name: patch
    source: /usr/bin/patch
  - name: tar
    source: /usr/bin/tar
---
kind: aep.caw.toolset
name: rust-draft-tools
description: Shell and file tools, the C linker and a Rust toolchain for a coding agent in an EDE draft
programs:
  - name: sh
    source: /usr/bin/sh
  - name: env
    source: /usr/bin/env
  - name: cat
    source: /usr/bin/cat
  - name: ls
    source: /usr/bin/ls
  - name: cp
    source: /usr/bin/cp
  - name: mv
    source: /usr/bin/mv
  - name: mkdir
    source: /usr/bin/mkdir
  - name: rm
    source: /usr/bin/rm
  - name: grep
    source: /usr/bin/grep
  - name: sed
    source: /usr/bin/sed
  - name: head
    source: /usr/bin/head
  - name: tail
    source: /usr/bin/tail
  - name: find
    source: /usr/bin/find
  - name: sort
    source: /usr/bin/sort
  - name: wc
    source: /usr/bin/wc
  - name: cc
    source: /usr/bin/cc
  - name: ld
    source: /usr/bin/ld
  - name: as
    source: /usr/bin/as
trees:
  - name: rust-toolchain
    source: "${RUST_TOOLCHAIN}"
    path: /usr/local/rust
    bin: bin
  - name: compiler-support
    source: /usr/lib/gcc
    path: /usr/lib/gcc
  - name: compiler-programs
    source: /usr/libexec/gcc
    path: /usr/libexec/gcc
  - name: host-libraries
    source: /usr/lib/x86_64-linux-gnu
    path: /usr/lib/x86_64-linux-gnu
