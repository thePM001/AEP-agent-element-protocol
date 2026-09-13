# Prime Agent connector (AEP 2.8.5)

Prime Agent is an optional coding harness and it is not a default compose service. Prime talks to the lattice through UCB and runs host commands through CAW, so UCB is an attach gateway not a second evaluator and CAW is an execution companion not a second evaluator while Base Node stays the only live evaluator. Writing walls use CORRECTWRITING_EN and writing:* ids.

A task manifest is mandatory on UCB ingest, Prime cannot synthesize a manifest and Prime Refine cannot rewrite Admit walls. Enqueue is not Admit, looking similar to a past allow is not allow and an empty agent permission list refuses.

Do not add Prime as a compose service next to Base Node. Keep Prime off the public compose file, wrap Prime with CAW so host commands are not raw bash and send sealed work to Base Node docks. See AEP-User-Experience/docs/FOREIGN-ATTACH.md and AEP-User-Experience/docs/OPERATOR.md.
