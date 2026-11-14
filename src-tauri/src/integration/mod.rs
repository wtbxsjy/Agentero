//! External integrations: bridge, connector, MCP, remote vault, cloud sync.
//! These depend on the desktop runtime and are not available to the headless CLI.

#[cfg(feature = "desktop")]
#[cfg(feature = "desktop")]
pub mod connector;
#[cfg(feature = "desktop")]
pub mod context_mcp;
#[cfg(feature = "desktop")]
pub mod delegate_mcp;
#[cfg(feature = "desktop")]
pub mod mcp;
#[cfg(feature = "desktop")]
#[cfg(all(
    feature = "desktop",
    not(any(target_os = "ios", target_os = "android"))
))]
pub mod plugins;
#[cfg(feature = "desktop")]

#[cfg(feature = "desktop")]
pub mod word;
