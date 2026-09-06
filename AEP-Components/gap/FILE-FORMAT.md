@PAD: gap-285-p9-file-format-v1.
@GCDE: gaplune.policy.v1.

# GAP file format for AEP 2.8.5 collect-all Admit

This note tells operators how live GAP files are written and how collect-all Admit reads them after a sealed capsule.

- Keep `.gap` as GAP source and UTF-8.
- YAML 1.2 source remains valid GAP source.
- Live kernel policies may be JSON-encoded GAP instruction objects because the kernel reads the instruction object not the skin.
- Live evaluation seals a lattice-channel capsule, uses freeze-at-seal and waits 1000 ms.
- After freeze-at-seal the path is collect-all Admit then Apply.
- After the wait the client collects by capsule hash as collect-all Admit then Applies the allowed action.
- Live AEP 2.8.5 EPSCOM trust bundle mode is sha256-structure.
- Optional proof algorithms may still name Ed25519 or ML-DSA-65.
- The signatures loader denies an ML-DSA claim on sha256-structure.
- Signed proof is not the default live AEP 2.8.5 attach.
- Who-may is agent_may.
- Empty grants close an agent action when the grant list is empty.
- trust_ring is a documentary label on classic v1 and v1.2.
- Rank rings are not the Admit floor.
- Rank use warns then denies while who-may stays agent_may.
- Writing and security are always-on stems and they evaluate on every action path.
- Other GAP walls bind to a wrap or an action path prefix.
- A finance wrap GAP item does not close an inventory wrap ping.
- A non-always-on GAP with empty wrap does not fold onto every event.
- One instruction per document.
- Multi-instruction families use YAML multi-document syntax with `---` separators.
- Locator: http://100.118.184.18:3003/thePM001/NLA-AEP-v2.8-open-source/src/branch/main/AEP-Components/gap/FILE-FORMAT.md
