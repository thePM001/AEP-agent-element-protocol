---- MODULE TemporalBounds ----
EXTENDS Integers
CONSTANTS MaxDrift, MaxFuture, MaxStale
ASSUME MaxDrift = 50
ASSUME MaxFuture = 500
ASSUME MaxStale = 5000
VARIABLES hasAgentTime, drift, agentTime, bridgeTime, causalMissing, admit
TypeOK ==
  /\ hasAgentTime \in BOOLEAN
  /\ drift \in Int
  /\ agentTime \in Int
  /\ bridgeTime \in Int
  /\ causalMissing \in BOOLEAN
  /\ admit \in BOOLEAN
  /\ drift >= 0
  /\ agentTime >= 0
  /\ bridgeTime >= 0
NoTimestamps == hasAgentTime = FALSE
DriftExceeded == hasAgentTime /\ drift > MaxDrift
FutureStamp == hasAgentTime /\ agentTime > bridgeTime + MaxFuture
StaleEvent ==
  /\ hasAgentTime
  /\ bridgeTime > agentTime
  /\ (bridgeTime - agentTime) > MaxStale
Closed ==
  \/ NoTimestamps
  \/ DriftExceeded
  \/ FutureStamp
  \/ StaleEvent
  \/ causalMissing
AdmitOK == admit <=> ~Closed
SoftWarn ==
  /\ hasAgentTime
  /\ drift > (MaxDrift \div 2)
  /\ drift <= MaxDrift
  /\ admit = TRUE
Init ==
  /\ hasAgentTime = TRUE
  /\ drift = 0
  /\ agentTime = 0
  /\ bridgeTime = 0
  /\ causalMissing = FALSE
  /\ admit = TRUE
SkewRefuse ==
  /\ hasAgentTime = TRUE
  /\ drift' = MaxDrift + 1
  /\ admit' = FALSE
  /\ UNCHANGED <<hasAgentTime, agentTime, bridgeTime, causalMissing>>
FutureRefuse ==
  /\ hasAgentTime = TRUE
  /\ agentTime' = bridgeTime + MaxFuture + 1
  /\ admit' = FALSE
  /\ UNCHANGED <<hasAgentTime, drift, bridgeTime, causalMissing>>
StaleRefuse ==
  /\ hasAgentTime = TRUE
  /\ bridgeTime' = agentTime + MaxStale + 1
  /\ admit' = FALSE
  /\ UNCHANGED <<hasAgentTime, drift, agentTime, causalMissing>>
CausalRefuse ==
  /\ causalMissing = FALSE
  /\ causalMissing' = TRUE
  /\ admit' = FALSE
  /\ UNCHANGED <<hasAgentTime, drift, agentTime, bridgeTime>>
NoTimeRefuse ==
  /\ hasAgentTime = TRUE
  /\ hasAgentTime' = FALSE
  /\ admit' = FALSE
  /\ UNCHANGED <<drift, agentTime, bridgeTime, causalMissing>>
Keep == UNCHANGED <<hasAgentTime, drift, agentTime, bridgeTime, causalMissing, admit>>
Next ==
  \/ SkewRefuse
  \/ FutureRefuse
  \/ StaleRefuse
  \/ CausalRefuse
  \/ NoTimeRefuse
  \/ Keep
Spec == Init /\ [][Next]_<<hasAgentTime, drift, agentTime, bridgeTime, causalMissing, admit>>
SkewKeepAdmit ==
  /\ hasAgentTime = TRUE
  /\ drift' = MaxDrift + 1
  /\ admit' = TRUE
  /\ UNCHANGED <<hasAgentTime, agentTime, bridgeTime, causalMissing>>
InvHolds == AdmitOK
====
