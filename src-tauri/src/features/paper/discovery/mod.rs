//! Paper discovery helpers: Cool Papers notes, PwC enrichment, keyword
//! discovery, embeddings, and the arXiv reader proxy.

#[cfg(feature = "desktop")]
pub mod coolpapers;
pub use agentero_core::features::paper::discovery::discover;
pub use agentero_core::features::paper::discovery::embeddings;
#[cfg(feature = "desktop")]
pub mod embedding_probe;
#[cfg(feature = "desktop")]
pub mod proxy;
pub mod pwc;
