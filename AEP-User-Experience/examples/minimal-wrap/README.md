# Minimal wrap (AEP 2.8.6)

This wrap imports the public kernel names from Base Node. Base Node is the only live evaluator and the wrap is not a second evaluator. An empty agent permission list refuses. The compiled pulse is 1000 ms. Writing walls use the CORRECTWRITING_EN rule name and the writing class ids.

From the repository root, run the wrap with cargo against AEP-User-Experience/examples/minimal-wrap/Cargo.toml. The run first prints the allow decision for the documented agent and then the sealed payload roundtrip result, so the reader can see that sealing and opening agree. It then prints the compiled pulse in milliseconds and the deny report for the denied path, which carries the error line, the closed wall count and the closed set key. The last line prints the writing wall id together with its class.

Isolation lives in CAW. The walls in this example are kernel results about the envelope and a wall pass on its own is not process governance. The host process is confined only when a CAW session wraps it, so there is no shell without a CAW session and a reader who copies the allow line into a bare shell has the paperwork rather than the confinement. CAW is the layer that confines the command, Base Node is the layer that admits the envelope.

UCB is not used here, enqueue is not Admit and the TypeScript process event is not product Admit.
