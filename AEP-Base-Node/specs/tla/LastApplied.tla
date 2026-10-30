---- MODULE LastApplied ----
EXTENDS Integers
CONSTANTS Keys, Bound
ASSUME Keys # {}
ASSUME Bound \in Int /\ Bound > 0
VARIABLES applied
TypeOK == applied \in [Keys -> 0..Bound]
Init == applied = [k \in Keys |-> 0]
Inc(k) ==
  /\ k \in Keys
  /\ applied[k] < Bound
  /\ applied' = [applied EXCEPT ![k] = applied[k] + 1]
Stay == UNCHANGED applied
Next == (\E k \in Keys: Inc(k)) \/ Stay
Spec == Init /\ [][Next]_applied
Monotonic == \A k \in Keys: applied'[k] >= applied[k]
BoundedInv == \A k \in Keys: applied[k] >= 0 /\ applied[k] <= Bound
RegressKeep ==
\E k \in Keys:
  /\ applied[k] > 0
  /\ applied' = [applied EXCEPT ![k] = applied[k] - 1]
InvHolds == TypeOK /\ BoundedInv
====
