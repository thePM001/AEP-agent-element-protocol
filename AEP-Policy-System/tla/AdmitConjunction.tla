---- MODULE AdmitConjunction ----
EXTENDS Integers
CONSTANTS InvariantIds
ASSUME InvariantIds # {}
VARIABLES held, admit
TypeOK ==
  /\ held \in SUBSET InvariantIds
  /\ admit \in BOOLEAN
AllHeld == held = InvariantIds
AdmitOK == admit <=> AllHeld
Init ==
  /\ held = InvariantIds
  /\ admit = TRUE
DropAndRefuse ==
\E i \in held:
  /\ held' = held \ {i}
  /\ admit' = FALSE
Keep == UNCHANGED <<held, admit>>
Step ==
  \/ DropAndRefuse
  \/ Keep
Spec == Init /\ [][Step]_<<held, admit>>
DropKeepAdmit ==
\E i \in held:
  /\ held' = held \ {i}
  /\ admit' = TRUE
InvHolds == AdmitOK
====
