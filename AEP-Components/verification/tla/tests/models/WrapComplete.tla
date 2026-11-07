---- MODULE WrapComplete ----
EXTENDS Integers
VARIABLES scene, actionPaths, writtenPolicy, dockChannels, wrap
TypeOK ==
  /\ scene \in BOOLEAN
  /\ actionPaths \in BOOLEAN
  /\ writtenPolicy \in BOOLEAN
  /\ dockChannels \in BOOLEAN
  /\ wrap \in BOOLEAN
AllPresent ==
  /\ scene
  /\ actionPaths
  /\ writtenPolicy
  /\ dockChannels
WrapOK == wrap <=> AllPresent
Init ==
  /\ scene = TRUE
  /\ actionPaths = TRUE
  /\ writtenPolicy = TRUE
  /\ dockChannels = TRUE
  /\ wrap = TRUE
DropScene ==
  /\ scene = TRUE
  /\ scene' = FALSE
  /\ wrap' = FALSE
  /\ UNCHANGED <<actionPaths, writtenPolicy, dockChannels>>
DropActionPaths ==
  /\ actionPaths = TRUE
  /\ actionPaths' = FALSE
  /\ wrap' = FALSE
  /\ UNCHANGED <<scene, writtenPolicy, dockChannels>>
DropWrittenPolicy ==
  /\ writtenPolicy = TRUE
  /\ writtenPolicy' = FALSE
  /\ wrap' = FALSE
  /\ UNCHANGED <<scene, actionPaths, dockChannels>>
DropDockChannels ==
  /\ dockChannels = TRUE
  /\ dockChannels' = FALSE
  /\ wrap' = FALSE
  /\ UNCHANGED <<scene, actionPaths, writtenPolicy>>
Keep == UNCHANGED <<scene, actionPaths, writtenPolicy, dockChannels, wrap>>
Next ==
  \/ DropScene
  \/ DropActionPaths
  \/ DropWrittenPolicy
  \/ DropDockChannels
  \/ Keep
Spec == Init /\ [][Next]_<<scene, actionPaths, writtenPolicy, dockChannels, wrap>>
DropKeepWrap ==
  /\ scene = TRUE
  /\ scene' = FALSE
  /\ wrap' = TRUE
  /\ UNCHANGED <<actionPaths, writtenPolicy, dockChannels>>
InvHolds == WrapOK
====
