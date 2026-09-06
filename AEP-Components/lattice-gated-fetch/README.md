# @PAD: aep-lattice-gated-fetch-readme-v1
# @GCDE: gaplune.policy.v1
After dock allow lattice-gated-fetch must not fall through to ordinary fetch. Dock executes bound HTTP and returns http. Clients consume dock http. Crate aep-lattice-gated-fetch fails if docking.rs or a twin still falls through.
