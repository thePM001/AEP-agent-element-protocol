-------------------------------- MODULE AEP --------------------------------
EXTENDS Integers, Sequences, FiniteSets

CONSTANTS ElementIDs, Prefixes, ZBands

VARIABLES scene, registry

TypeInvariant ==
  /\ \A id \in DOMAIN scene :
       /\ scene[id].z \in Int
       /\ scene[id].parent \in DOMAIN scene \cup {"null"}
       \* Layout is either anchors, spatial_rule or absolute
       /\ \/ "anchors" \in DOMAIN scene[id]
          \/ "spatial_rule" \in DOMAIN scene[id]
          \/ ("x" \in DOMAIN scene[id] /\ "y" \in DOMAIN scene[id])

\* --- INVARIANT 1: z-band correctness ---
ZBandInvariant ==
  \A id \in DOMAIN scene :
    LET prefix == SubSeq(id, 1, 2)
        band   == ZBands[prefix]
    IN  scene[id].z >= band[1] /\ scene[id].z <= band[2]

\* --- INVARIANT 2: no orphan elements ---
NoOrphans ==
  \A id \in DOMAIN scene :
    scene[id].parent = "null"    \* root shell
    \/ scene[id].parent \in DOMAIN scene

\* --- INVARIANT 3: topological containment (anchors resolve) ---
TopologicalContainment ==
  \A id \in DOMAIN scene :
    \* All anchor targets must reference existing elements
    ("anchors" \in DOMAIN scene[id]) =>
      \A dir \in DOMAIN scene[id].anchors :
        LET targetId == scene[id].anchors[dir].elementId
        IN  targetId \in DOMAIN scene \cup {"viewport"}

\* --- INVARIANT 4: spatial rule children exist ---
SpatialRuleValid ==
  \A id \in DOMAIN scene :
    ("spatial_rule" \in DOMAIN scene[id]) =>
      \A child \in scene[id].children :
        child \in DOMAIN scene

\* --- INVARIANT 5: modals always above grids ---
ModalAboveGrid ==
  \A m \in DOMAIN scene : \A g \in DOMAIN scene :
    (SubSeq(m, 1, 2) = "MD" /\ SubSeq(g, 1, 2) = "CZ")
    => scene[m].z > scene[g].z

\* --- INVARIANT 6: unique IDs (enforced by DOMAIN, but stated for clarity) ---
UniqueIDs == Cardinality(DOMAIN scene) = Cardinality(DOMAIN scene)

\* --- INVARIANT 7: skin bindings resolve ---
SkinBindingsResolve ==
  \A id \in DOMAIN registry :
    registry[id].skin_binding \in DOMAIN theme.component_styles

\* --- Combined safety property ---
SafetyInvariant ==
  /\ TypeInvariant
  /\ ZBandInvariant
  /\ NoOrphans
  /\ TopologicalContainment
  /\ SpatialRuleValid
  /\ ModalAboveGrid
  /\ SkinBindingsResolve

=============================================================================
