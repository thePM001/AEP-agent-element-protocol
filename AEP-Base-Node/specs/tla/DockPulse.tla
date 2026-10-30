---- MODULE DockPulse ----
EXTENDS Integers
VARIABLES phase, sealed, frozen, waited, collected, applied
Phases == {"idle", "seal", "freeze", "wait", "collect", "apply", "done"}
TypeOK ==
  /\ phase \in Phases
  /\ sealed \in BOOLEAN
  /\ frozen \in BOOLEAN
  /\ waited \in BOOLEAN
  /\ collected \in BOOLEAN
  /\ applied \in BOOLEAN
Init ==
  /\ phase = "idle"
  /\ sealed = FALSE
  /\ frozen = FALSE
  /\ waited = FALSE
  /\ collected = FALSE
  /\ applied = FALSE
DoSeal ==
  /\ phase = "idle"
  /\ phase' = "seal"
  /\ sealed' = TRUE
  /\ UNCHANGED <<frozen, waited, collected, applied>>
DoFreeze ==
  /\ phase = "seal"
  /\ sealed = TRUE
  /\ phase' = "freeze"
  /\ frozen' = TRUE
  /\ UNCHANGED <<sealed, waited, collected, applied>>
DoWait ==
  /\ phase = "freeze"
  /\ frozen = TRUE
  /\ phase' = "wait"
  /\ waited' = TRUE
  /\ UNCHANGED <<sealed, frozen, collected, applied>>
DoCollect ==
  /\ phase = "wait"
  /\ waited = TRUE
  /\ phase' = "collect"
  /\ collected' = TRUE
  /\ UNCHANGED <<sealed, frozen, waited, applied>>
DoApply ==
  /\ phase = "collect"
  /\ collected = TRUE
  /\ phase' = "apply"
  /\ applied' = TRUE
  /\ UNCHANGED <<sealed, frozen, waited, collected>>
DoDone ==
  /\ phase = "apply"
  /\ applied = TRUE
  /\ phase' = "done"
  /\ UNCHANGED <<sealed, frozen, waited, collected, applied>>
Step ==
  \/ DoSeal
  \/ DoFreeze
  \/ DoWait
  \/ DoCollect
  \/ DoApply
  \/ DoDone
Spec == Init /\ [][Step]_<<phase, sealed, frozen, waited, collected, applied>>
OrderInv ==
  /\ frozen => sealed
  /\ waited => frozen
  /\ collected => waited
  /\ applied => collected
ApplyGuard ==
  /\ applied => sealed
  /\ applied => frozen
  /\ applied => waited
  /\ applied => collected
====
