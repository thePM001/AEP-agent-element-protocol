# Tree (AEP 2.8.6)

The public tree is counted by layer, not by folder count. Wall units stay internal. Canonical tree first.

## Kernel

AEP-Base-Node is the local kernel. It opens sealed capsules, freezes the clock at seal, waits the compiled 1000 ms pulse, runs every written wall together, records the ledger and applies only after Admit. Base Node is the only live evaluator.

## Protocol

AEP-Components holds protocol components such as dynAEP, lattice channels, envelope and Lattice Memory. Protocol components are not a second evaluator. TypeScript processEvent is not product Admit.

## Execution

CAW under AEP-Components/caw-framework is the execution companion. CAW is not a second evaluator and is not raw bash. Prime Agent if used is wrapped by CAW and still cannot rewrite Admit walls.

## UX

AEP-Composer-Lite and AEP-User-Experience are operator UX. Composer Lite is not Admit. The theme yaml file has no Admit authority.

## Policy

AEP-Policy-System holds GAP instructions. Public writing policy name is CORRECTWRITING_EN. Class is writing. Wall ids are writing:*. An empty agent permission list refuses.

## Docks

AEP-Docks/ucb is the optional foreign attach gateway. UCB capabilities are ingest, delegate, health, rollback, egress and compile-manifest. Default Predicate Profile is perimeter-v1. UCB is not a second evaluator.
