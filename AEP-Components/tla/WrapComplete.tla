---- MODULE WrapComplete ----
\* A wrap succeeds only when scene, action paths, written policy and dock
\* channels are all present. Every wrap request reaches a verdict.
VARIABLES phase, present, wrap
vars == <<phase, present, wrap>>
Parts == {"scene", "actionPaths", "writtenPolicy", "dockChannels"}
TypeOK ==
  /\ phase \in {"idle", "checking", "decided"}
  /\ present \in SUBSET Parts
  /\ wrap \in {"none", "ok", "refused"}
Init ==
  /\ phase = "idle"
  /\ present = {}
  /\ wrap = "none"
\* A wrap request names some of the parts. The model covers every subset.
Request(p) ==
  /\ phase = "idle"
  /\ phase' = "checking"
  /\ present' = p
  /\ wrap' = "none"
Decide ==
  /\ phase = "checking"
  /\ phase' = "decided"
  /\ wrap' = IF present = Parts THEN "ok" ELSE "refused"
  /\ UNCHANGED present
Release ==
  /\ phase = "decided"
  /\ phase' = "idle"
  /\ wrap' = "none"
  /\ UNCHANGED present
Next ==
  \/ \E p \in SUBSET Parts: Request(p)
  \/ Decide
  \/ Release
Spec == Init /\ [][Next]_vars /\ WF_vars(Next)
\* Safety: a wrap is complete exactly when every part is present.
WrapNeedsAllParts == wrap = "ok" => present = Parts
MissingPartRefuses == wrap = "refused" => present # Parts
\* Liveness under weak fairness: every request is decided.
RequestDecided == (phase = "checking") ~> (wrap # "none")
WrapReturns == []<>(phase = "idle")
====
