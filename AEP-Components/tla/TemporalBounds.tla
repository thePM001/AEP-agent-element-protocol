---- MODULE TemporalBounds ----
\* The time checks of the dock path of the kernel. The enqueue step reads the
\* kernel clock when the frame arrives and refuses a stamp more than MaxDrift
\* ahead of it or more than MaxAge behind it. A frame inside that window goes
\* to Admit, whose time walls measure against the checked stamp and close for
\* a frame with no usable stamp or with a missing causal parent. The constants
\* are MAX_DRIFT_MS and MAX_AGE_MS of aep-base-node-pulse and a test of the
\* crate aep-tla-verify holds the configuration to them.
EXTENDS Integers
CONSTANTS MaxDrift, MaxAge
ASSUME MaxDrift \in Nat /\ MaxAge \in Nat /\ MaxDrift > 0 /\ MaxAge > 0
\* Offset is the stamp of the agent minus the kernel clock at arrival. Every
\* check compares the offset with MaxDrift or with MaxAge, so the values on
\* each side of both bounds and around zero stand for the whole range.
Offsets == {-(MaxAge + 1), -MaxAge, -1, 0, 1, MaxDrift, MaxDrift + 1}
\* "none" is an absent or zero stamp, "negative" a stamp below zero.
StampKinds == {"none", "negative", "valid"}
Walls == {"none", "temporal:future_skew", "temporal:stale_event",
          "temporal:drift_exceeded", "temporal:causal_parent_missing", "pass"}
VARIABLES phase, stamp, offset, causalMissing, verdict, wall
vars == <<phase, stamp, offset, causalMissing, verdict, wall>>
TypeOK ==
  /\ phase \in {"idle", "arrived", "queued", "decided"}
  /\ stamp \in StampKinds
  /\ offset \in Offsets
  /\ causalMissing \in BOOLEAN
  /\ verdict \in {"none", "allow", "deny"}
  /\ wall \in Walls
Init ==
  /\ phase = "idle"
  /\ stamp = "none"
  /\ offset = 0
  /\ causalMissing = FALSE
  /\ verdict = "none"
  /\ wall = "none"
Arrive(s, o, c) ==
  /\ phase = "idle"
  /\ phase' = "arrived"
  /\ stamp' = s
  /\ offset' = IF s = "valid" THEN o ELSE 0
  /\ causalMissing' = c
  /\ verdict' = "none"
  /\ wall' = "none"
Refuse(w) ==
  /\ phase' = "decided"
  /\ verdict' = "deny"
  /\ wall' = w
  /\ UNCHANGED <<stamp, offset, causalMissing>>
\* Enqueue: the window around the kernel clock. Only a valid stamp is checked
\* here, every other frame goes on to Admit.
Enqueue ==
  /\ phase = "arrived"
  /\ IF stamp = "valid" /\ offset > MaxDrift
       THEN Refuse("temporal:future_skew")
     ELSE IF stamp = "valid" /\ -offset > MaxAge
       THEN Refuse("temporal:stale_event")
     ELSE /\ phase' = "queued"
          /\ UNCHANGED <<stamp, offset, causalMissing, verdict, wall>>
\* Admit: the time walls read the checked stamp as the event time, so the
\* transit of a valid stamp is not drift. A frame without a usable stamp
\* closes the drift wall.
AdmitTime ==
  /\ phase = "queued"
  /\ IF stamp # "valid"
       THEN Refuse("temporal:drift_exceeded")
     ELSE IF causalMissing
       THEN Refuse("temporal:causal_parent_missing")
     ELSE /\ phase' = "decided"
          /\ verdict' = "allow"
          /\ wall' = "pass"
          /\ UNCHANGED <<stamp, offset, causalMissing>>
Release ==
  /\ phase = "decided"
  /\ phase' = "idle"
  /\ verdict' = "none"
  /\ wall' = "none"
  /\ UNCHANGED <<stamp, offset, causalMissing>>
Next ==
  \/ \E s \in StampKinds, o \in Offsets, c \in BOOLEAN: Arrive(s, o, c)
  \/ Enqueue
  \/ AdmitTime
  \/ Release
Spec == Init /\ [][Next]_vars /\ WF_vars(Next)
InWindow == stamp = "valid" /\ offset <= MaxDrift /\ -offset <= MaxAge
\* Safety: an allowed frame carries a valid stamp inside the window and every
\* causal parent. A decided frame outside that is denied.
AllowInWindow == verdict = "allow" => (InWindow /\ ~causalMissing)
OutsideDenied ==
  (phase = "decided" /\ ~(InWindow /\ ~causalMissing)) => verdict = "deny"
FutureSkewBound == verdict = "allow" => offset <= MaxDrift
\* Liveness under weak fairness: every arrived frame is decided.
FrameDecided == (phase = "arrived") ~> (phase = "decided")
DockReturns == []<>(phase = "idle")
====
