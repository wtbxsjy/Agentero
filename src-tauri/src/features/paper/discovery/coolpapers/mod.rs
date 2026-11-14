//! Cool Papers (papers.cool) integration.
//!
//! The tauri-free note-fetch body (resolving a paper, pulling its Kimi FAQ
//! analysis, appending to `NOTES.md`) lives in
//! `agentero_core::features::paper::discovery::coolpapers` so the headless CLI
//! shares it. This crate keeps the desktop-only IPC shell in [`commands`].

#[cfg(feature = "desktop")]
pub mod commands;

pub use agentero_core::features::paper::discovery::coolpapers::{
    decode_entities, fetch_notes, http_client, CoolPapersNotes, FetchNotesRequest, ORIGIN,
    USER_AGENT,
};
