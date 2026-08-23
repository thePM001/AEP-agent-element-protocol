//! AEP protocol helpers ported from the retired interpreter SDK.
//! @PAD: aep-sdk-aep
//! @GCDE: gaplune.code.v1

pub mod memory;
pub mod resolver;

pub use memory::{cosine_similarity, InMemoryFabric, MemoryEntry};
pub use resolver::{BasicResolver, ResolveRequest, ResolveResult};
