------------------------------ MODULE AEP_Memory ------------------------------
EXTENDS AEP, Sequences, TLC

VARIABLES memory_fabric

MemoryEntry == [
  element_id : DOMAIN scene,
  result     : {"accepted", "rejected"},
  errors     : Seq(STRING),
  timestamp  : Nat
]

MemoryAppendOnly ==
  \A i \in 1..Len(memory_fabric) :
    \A j \in 1..Len(memory_fabric') :
      j <= Len(memory_fabric) => memory_fabric'[j] = memory_fabric[j]

MemoryDoesNotAffectDecision ==
  \A proposal \in O :
    LET resultWithMemory    == Validate(proposal, scene, registry, memory_fabric)
        resultWithoutMemory == Validate(proposal, scene, registry, <<>>)
    IN resultWithMemory.valid = resultWithoutMemory.valid

MemoryAcceptedAreValid ==
  \A i \in 1..Len(memory_fabric) :
    memory_fabric[i].result = "accepted" =>
      SafetyInvariant

===============================================================================
