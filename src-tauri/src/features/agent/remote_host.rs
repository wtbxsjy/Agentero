//! Launch-target seam for agents.
//!
//! Upstream runs agents on an SSH host for remote vaults through these traits.
//! This fork removed remote vaults; the app registers [`NoRemoteHosts`], so
//! every target resolves to the local machine. The seam is kept so the agent
//! code stays close to upstream for cherry-picks.

use crate::core::error::AppError;
use crate::features::vault::CreateVaultResult;
use async_trait::async_trait;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// One active remote vault session as seen by the agent feature.
///
/// Covers both backends: real SSH/SFTP sessions and `local-sim` (dev/tests
/// without SSH, where the agent runs locally with the mirrored work root).
#[async_trait]
pub trait RemoteAgentLaunch: Send + Sync {
    /// True when the agent process must run on the remote host over SSH.
    fn is_ssh(&self) -> bool;
    /// True for the local-sim backend (`kind == "local-sim"`).
    fn is_local_sim(&self) -> bool;
    /// Raw session host (SSH destination when [`Self::is_ssh`]).
    fn host(&self) -> &str;
    /// Path passed to ACP `new_session` / Codex as cwd (remote absolute path).
    fn agent_cwd(&self) -> PathBuf;
    /// Ephemeral local work root (catalog mirror + optional skill mirror).
    fn work_root(&self) -> &Path;
    /// SSH destination already used for this session's SFTP connection
    /// (`user@host` or an `~/.ssh/config` alias). Local-sim returns its host marker.
    fn ssh_destination(&self) -> String {
        self.host().to_string()
    }

    /// Build `(program, args)` that launches `command args` on the remote host
    /// over SSH stdio (`ssh … 'cd vault && exec agent'`), mirroring proxy /
    /// Codex-UA env keys from `env` into the remote process.
    fn ssh_stdio(
        &self,
        command: &str,
        args: &[String],
        env: &HashMap<String, String>,
    ) -> Result<(PathBuf, Vec<String>), AppError>;
    /// Locate a binary on the remote host (login-shell PATH); local `which`
    /// for the local-sim backend.
    async fn which(&self, bin: &str) -> Result<Option<String>, AppError>;
    /// Pull `.agents/skills/*/SKILL.md` into the local work root so the Host
    /// can inject skills.
    async fn materialize_skills(&self) -> Result<(), AppError>;
    /// Seed or safely upgrade bundled skills (and optional onboarding notes
    /// for `locale`) in the remote vault.
    async fn ensure_vault_skills(
        &self,
        locale: Option<&str>,
    ) -> Result<CreateVaultResult, AppError>;
}

/// Lookup for active remote sessions behind `remote:<sessionId>` vault handles.
#[async_trait]
pub trait RemoteAgentHosts: Send + Sync {
    /// If `vault_path` is `remote:<sessionId>`, resolve the launch target;
    /// else `None` (local vault).
    async fn resolve_target(
        &self,
        vault_path: Option<&str>,
    ) -> Result<Option<Arc<dyn RemoteAgentLaunch>>, AppError>;
    /// Look up an active session by id.
    async fn get_session(&self, session_id: &str) -> Result<Arc<dyn RemoteAgentLaunch>, AppError>;
    /// Connected remote vaults a local agent may delegate work to.
    async fn list_targets(&self) -> Result<Vec<RemoteTargetInfo>, AppError>;
}

/// One open remote vault, as the delegate tool is allowed to see it.
#[derive(Debug, Clone)]
pub struct RemoteTargetInfo {
    pub session_id: String,
    /// `user@host` or ssh config alias. Local-sim stores the local-sim host marker;
    /// callers display `remote_path` instead.
    pub destination: String,
    pub remote_path: String,
    pub local_sim: bool,
}

/// The only [`RemoteAgentHosts`] in this fork: no remote vaults exist.
pub struct NoRemoteHosts;

#[async_trait]
impl RemoteAgentHosts for NoRemoteHosts {
    async fn resolve_target(
        &self,
        _vault_path: Option<&str>,
    ) -> Result<Option<Arc<dyn RemoteAgentLaunch>>, AppError> {
        Ok(None)
    }

    async fn get_session(&self, _session_id: &str) -> Result<Arc<dyn RemoteAgentLaunch>, AppError> {
        Err(AppError::message("remote vaults are not supported"))
    }

    async fn list_targets(&self) -> Result<Vec<RemoteTargetInfo>, AppError> {
        Ok(Vec::new())
    }
}
