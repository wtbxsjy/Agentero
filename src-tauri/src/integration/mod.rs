//! External integrations: connector, MCP.
//! These depend on the desktop runtime and are not available to the headless CLI.

#[cfg(feature = "desktop")]
pub mod connector;
#[cfg(feature = "desktop")]
pub mod context_mcp;
#[cfg(feature = "desktop")]
pub mod delegate_mcp;
#[cfg(feature = "desktop")]
pub mod mcp;
