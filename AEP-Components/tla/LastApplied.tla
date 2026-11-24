---- MODULE LastApplied ----
\* The book of the pulse that answers a collect. A digest is held until its
\* pulse settles it, then its answer sits in the bounded last applied book
\* until it expires or a newer answer evicts the oldest one. Settle moves a
\* digest from held to the book in one step, so a collect never finds a held
\* digest nowhere. Digest names are reused for fresh digests once an answer
\* is gone, which stands for the unbounded stream of digests of a live node.
EXTENDS Naturals, Sequences, FiniteSets
CONSTANTS Digests, Cap
ASSUME IsFiniteSet(Digests) /\ Digests # {} /\ Cap \in Nat /\ Cap > 0
VARIABLES st, order
vars == <<st, order>>
States == {"new", "held", "settled", "gone"}
Range(s) == {s[i] : i \in 1..Len(s)}
TypeOK ==
  /\ st \in [Digests -> States]
  /\ order \in Seq(Digests)
Init ==
  /\ st = [d \in Digests |-> "new"]
  /\ order = <<>>
Enqueue(d) ==
  /\ st[d] = "new"
  /\ st' = [st EXCEPT ![d] = "held"]
  /\ UNCHANGED order
\* Settle: the answer enters the book. A full book evicts its oldest answer.
Settle(d) ==
  /\ st[d] = "held"
  /\ IF Len(order) >= Cap
       THEN /\ st' = [st EXCEPT ![Head(order)] = "gone", ![d] = "settled"]
            /\ order' = Append(Tail(order), d)
       ELSE /\ st' = [st EXCEPT ![d] = "settled"]
            /\ order' = Append(order, d)
Expire(d) ==
  /\ st[d] = "settled"
  /\ st' = [st EXCEPT ![d] = "gone"]
  /\ order' = SelectSeq(order, LAMBDA x: x # d)
Recycle(d) ==
  /\ st[d] = "gone"
  /\ st' = [st EXCEPT ![d] = "new"]
  /\ UNCHANGED order
Next == \E d \in Digests:
  \/ Enqueue(d)
  \/ Settle(d)
  \/ Expire(d)
  \/ Recycle(d)
Spec == Init /\ [][Next]_vars /\ \A d \in Digests: WF_vars(Settle(d))
\* Safety: the book is bounded, it holds each settled digest exactly once and
\* nothing else.
BookBounded == Len(order) <= Cap
BookExact ==
  /\ Range(order) = {d \in Digests : st[d] = "settled"}
  /\ Len(order) = Cardinality(Range(order))
\* A held digest leaves only into the book, never into nowhere.
HeldSettlesOnly ==
  [][\A d \in Digests: st[d] = "held" => st'[d] \in {"held", "settled"}]_vars
\* Liveness under weak fairness of Settle: every held digest gets an answer.
HeldAnswered == \A d \in Digests: (st[d] = "held") ~> (st[d] = "settled")
====
