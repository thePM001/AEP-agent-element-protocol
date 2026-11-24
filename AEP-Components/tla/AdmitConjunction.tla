---- MODULE AdmitConjunction ----
\* Admit is one collect-all pass. Each frame runs every named wall and is
\* admitted only when every wall holds. Once a frame arrives it reaches a
\* verdict and the gate takes the next frame.
EXTENDS FiniteSets
CONSTANTS Walls
ASSUME Walls # {} /\ IsFiniteSet(Walls)
VARIABLES phase, holds, checked, verdict
vars == <<phase, holds, checked, verdict>>
Phases == {"idle", "collect", "decided"}
Verdicts == {"none", "allow", "deny"}
TypeOK ==
  /\ phase \in Phases
  /\ holds \in SUBSET Walls
  /\ checked \in SUBSET Walls
  /\ verdict \in Verdicts
Init ==
  /\ phase = "idle"
  /\ holds = {}
  /\ checked = {}
  /\ verdict = "none"
\* A frame arrives. Which walls hold for it is the choice of the environment,
\* so the model covers every subset of the walls.
Arrive(h) ==
  /\ phase = "idle"
  /\ holds' = h
  /\ checked' = {}
  /\ verdict' = "none"
  /\ phase' = "collect"
\* Collect all: a closed wall never stops the pass, every wall is read.
Check(w) ==
  /\ phase = "collect"
  /\ w \notin checked
  /\ checked' = checked \cup {w}
  /\ UNCHANGED <<phase, holds, verdict>>
Decide ==
  /\ phase = "collect"
  /\ checked = Walls
  /\ verdict' = IF holds = Walls THEN "allow" ELSE "deny"
  /\ phase' = "decided"
  /\ UNCHANGED <<holds, checked>>
Release ==
  /\ phase = "decided"
  /\ phase' = "idle"
  /\ verdict' = "none"
  /\ UNCHANGED <<holds, checked>>
Next ==
  \/ \E h \in SUBSET Walls: Arrive(h)
  \/ \E w \in Walls: Check(w)
  \/ Decide
  \/ Release
Spec == Init /\ [][Next]_vars /\ WF_vars(Next)
\* Safety: allow is the conjunction of every wall and the pass reads them all.
AllowIsConjunction == verdict = "allow" => holds = Walls
DenyHasClosedWall == verdict = "deny" => holds # Walls
CollectAll == verdict # "none" => checked = Walls
\* Liveness under weak fairness: every arrived frame is decided and the gate
\* always comes back for the next frame.
FrameDecided == (phase = "collect") ~> (verdict # "none")
GateReturns == []<>(phase = "idle")
====
