---- MODULE DockPulse ----
\* The kernel order of one pulse on a dock: seal, freeze, wait, collect every
\* Admit wall, then Apply when Admit allows or refuse when it denies. Apply,
\* the hub permission and the ledger row come after the last deny point. A
\* pulse that starts always ends and the dock always takes the next pulse.
VARIABLES phase, sealed, frozen, waited, collected, allowed, applied, refused
vars == <<phase, sealed, frozen, waited, collected, allowed, applied, refused>>
Phases == {"idle", "seal", "freeze", "wait", "collect", "apply", "refuse", "done"}
TypeOK ==
  /\ phase \in Phases
  /\ sealed \in BOOLEAN
  /\ frozen \in BOOLEAN
  /\ waited \in BOOLEAN
  /\ collected \in BOOLEAN
  /\ allowed \in BOOLEAN
  /\ applied \in BOOLEAN
  /\ refused \in BOOLEAN
Clear ==
  /\ sealed' = FALSE
  /\ frozen' = FALSE
  /\ waited' = FALSE
  /\ collected' = FALSE
  /\ allowed' = FALSE
  /\ applied' = FALSE
  /\ refused' = FALSE
Init ==
  /\ phase = "idle"
  /\ sealed = FALSE
  /\ frozen = FALSE
  /\ waited = FALSE
  /\ collected = FALSE
  /\ allowed = FALSE
  /\ applied = FALSE
  /\ refused = FALSE
DoSeal ==
  /\ phase = "idle"
  /\ phase' = "seal"
  /\ sealed' = TRUE
  /\ UNCHANGED <<frozen, waited, collected, allowed, applied, refused>>
DoFreeze ==
  /\ phase = "seal"
  /\ phase' = "freeze"
  /\ frozen' = TRUE
  /\ UNCHANGED <<sealed, waited, collected, allowed, applied, refused>>
DoWait ==
  /\ phase = "freeze"
  /\ phase' = "wait"
  /\ waited' = TRUE
  /\ UNCHANGED <<sealed, frozen, collected, allowed, applied, refused>>
\* Collect all returns the conjunction of the walls. Either outcome is possible.
DoCollect(ok) ==
  /\ phase = "wait"
  /\ phase' = IF ok THEN "apply" ELSE "refuse"
  /\ collected' = TRUE
  /\ allowed' = ok
  /\ UNCHANGED <<sealed, frozen, waited, applied, refused>>
DoApply ==
  /\ phase = "apply"
  /\ phase' = "done"
  /\ applied' = TRUE
  /\ UNCHANGED <<sealed, frozen, waited, collected, allowed, refused>>
DoRefuse ==
  /\ phase = "refuse"
  /\ phase' = "done"
  /\ refused' = TRUE
  /\ UNCHANGED <<sealed, frozen, waited, collected, allowed, applied>>
NextPulse ==
  /\ phase = "done"
  /\ phase' = "idle"
  /\ Clear
Next ==
  \/ DoSeal
  \/ DoFreeze
  \/ DoWait
  \/ \E ok \in BOOLEAN: DoCollect(ok)
  \/ DoApply
  \/ DoRefuse
  \/ NextPulse
Spec == Init /\ [][Next]_vars /\ WF_vars(Next)
\* Safety: each step needs the one before it and Apply needs an allow.
OrderInv ==
  /\ frozen => sealed
  /\ waited => frozen
  /\ collected => waited
ApplyGuard ==
  /\ applied => collected
  /\ applied => allowed
RefuseNeverApplies ==
  /\ refused => ~applied
  /\ refused => ~allowed
\* Liveness under weak fairness: a sealed pulse ends in Apply or a refusal and
\* the dock always comes back for the next pulse.
PulseEnds == (phase = "seal") ~> (phase = "done")
DockReturns == []<>(phase = "idle")
====
