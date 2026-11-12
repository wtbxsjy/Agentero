//! Application data directories following the [XDG Base Directory
//! Specification](https://specifications.freedesktop.org/basedir-spec/latest/).
//!
//! | Kind | Env | Default (Unix) | Contents |
//! |------|-----|----------------|----------|
//! | config | `$XDG_CONFIG_HOME` | `~/.config` | `agentero/settings.json`, `agents.json`, `plugins.json` |
//! | cache | `$XDG_CACHE_HOME` | `~/.cache` | remote work mirrors, PDF blobs |
//! | data | `$XDG_DATA_HOME` | `~/.local/share` | `usage.sqlite` (device-local activity), `feeds.sqlite` |
//! | state | `$XDG_STATE_HOME` | `~/.local/state` | reserved |
//!
//! On Windows and iOS, when XDG env vars are unset, falls back to the platform
//! dirs crate (Windows: `config` → `%APPDATA%`, `cache` → `%LOCALAPPDATA%`;
//! iOS: `Library/Application Support` / `Library/Caches` — the container root
//! itself is not writable, so `~/.config` would fail with EPERM).

use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

/// Resolve XDG config home (`$XDG_CONFIG_HOME` or platform default).
pub fn xdg_config_home() -> PathBuf {
    if let Some(p) = env_dir("XDG_CONFIG_HOME") {
        return p;
    }
    #[cfg(any(windows, target_os = "ios"))]
    {
        dirs::config_dir().unwrap_or_else(|| PathBuf::from("."))
    }
    #[cfg(not(any(windows, target_os = "ios")))]
    {
        home_dir().join(".config")
    }
}

/// Resolve XDG cache home (`$XDG_CACHE_HOME` or platform default).
pub fn xdg_cache_home() -> PathBuf {
    if let Some(p) = env_dir("XDG_CACHE_HOME") {
        return p;
    }
    #[cfg(any(windows, target_os = "ios"))]
    {
        dirs::cache_dir().unwrap_or_else(|| PathBuf::from("."))
    }
    #[cfg(not(any(windows, target_os = "ios")))]
    {
        home_dir().join(".cache")
    }
}

/// `$XDG_CONFIG_HOME/agentero` (created on demand by callers).
pub fn agentero_config_dir() -> PathBuf {
    xdg_config_home().join("agentero")
}

/// Resolve XDG data home (`$XDG_DATA_HOME` or platform default).
pub fn xdg_data_home() -> PathBuf {
    if let Some(p) = env_dir("XDG_DATA_HOME") {
        return p;
    }
    #[cfg(any(windows, target_os = "ios"))]
    {
        dirs::data_dir().unwrap_or_else(|| PathBuf::from("."))
    }
    #[cfg(not(any(windows, target_os = "ios")))]
    {
        home_dir().join(".local").join("share")
    }
}

/// `$XDG_CACHE_HOME/agentero` (created on demand by callers).
pub fn agentero_cache_dir() -> PathBuf {
    xdg_cache_home().join("agentero")
}

/// `$XDG_DATA_HOME/agentero` (created on demand by callers).
pub fn agentero_data_dir() -> PathBuf {
    xdg_data_home().join("agentero")
}

/// Device-local activity log: `…/agentero/usage.sqlite`.
pub fn usage_db_path() -> PathBuf {
    agentero_data_dir().join("usage.sqlite")
}

/// Plaza feed subscriptions + item cache: `…/agentero/feeds.sqlite`.
pub fn feeds_db_path() -> PathBuf {
    agentero_data_dir().join("feeds.sqlite")
}

/// True when `path` names a vault on a network share rather than a local disk.
///
/// On Windows this is a UNC path (`\\server\share\…`, which includes
/// `\\wsl.localhost\<distro>\…` and the canonical `\\?\UNC\…` form). Vaults on
/// such shares can't host SQLite: the 9p/SMB server does not implement the
/// byte-range locks SQLite relies on, so opening the catalog fails with
/// `pragma: database is locked`. Other platforms report false — their
/// network mounts are transparent to SQLite.
pub fn is_network_vault_path(path: &Path) -> bool {
    #[cfg(windows)]
    {
        let text = path.to_string_lossy();
        // `\\?\C:\…` (verbatim local drive) is still a local disk.
        for prefix in [r"\\?\", "//?/"] {
            if let Some(rest) = text.strip_prefix(prefix) {
                return rest.starts_with("UNC\\") || rest.starts_with("UNC/");
            }
        }
        text.starts_with(r"\\") || text.starts_with("//")
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        false
    }
}

/// Stable, filesystem-safe key for a vault path (canonical, case-folded).
fn vault_state_key(vault_root: &Path) -> String {
    let identity = crate::fs::canonicalize_best_effort(vault_root)
        .to_string_lossy()
        .replace('\\', "/")
        .to_lowercase();
    let digest = Sha256::digest(identity.as_bytes());
    hex::encode(digest)[..16].to_string()
}

/// Directory holding one vault's machine-local state (`catalog.sqlite`,
/// `writing-cloud.sqlite`, …).
///
/// Local vaults keep it at `<vault>/.agentero` so the state travels with the
/// vault. Network vaults (see [`is_network_vault_path`]) move it to
/// `…/agentero/vault-state/<hash>` on the local disk — content stays on the
/// share, only the SQLite state is local. The hash keys the canonical path so
/// the same share mapped under another spelling reuses one state dir.
pub fn vault_state_dir(vault_root: &Path) -> PathBuf {
    if is_network_vault_path(vault_root) {
        agentero_data_dir()
            .join("vault-state")
            .join(vault_state_key(vault_root))
    } else {
        vault_root.join(".agentero")
    }
}

/// ONNX / other large assets: `$XDG_CACHE_HOME/agentero/models`.
pub fn agentero_models_dir() -> PathBuf {
    agentero_cache_dir().join("models")
}

/// Owned by the built-in ChatGPT tunnel supervisor:
/// `$XDG_CACHE_HOME/agentero/mcp-tunnel` (private `--profile-dir`, health url, log).
pub fn mcp_tunnel_dir() -> PathBuf {
    agentero_cache_dir().join("mcp-tunnel")
}

/// App settings file: `…/agentero/settings.json`.
pub fn settings_path() -> PathBuf {
    agentero_config_dir().join("settings.json")
}

/// Plugin manifest: `…/agentero/plugins.json`, beside [`settings_path`].
///
/// Load and store live in [`crate::plugins`]. Nothing reads this file at startup.
pub fn plugins_path() -> PathBuf {
    agentero_config_dir().join("plugins.json")
}

/// Agent registry file: `…/agentero/agents.json`.
pub fn agents_path() -> PathBuf {
    agentero_config_dir().join("agents.json")
}

/// Long-lived desktop Bridge identity and paired-device registry.
pub fn bridge_config_dir() -> PathBuf {
    agentero_config_dir().join("bridge")
}

/// Private working directory for a spawned ACP agent when no Vault is known
/// (initialize probe, warm before a Vault opens, history listing).
///
/// Never fall back to the process working directory: a macOS GUI app launched
/// by LaunchServices has `/` as its cwd, so an agent that inspects its process
/// cwd treats the whole filesystem as its workspace and enumerates `$HOME`.
/// That trips macOS TCC prompts for Music / Desktop / Downloads / iCloud Drive
/// / other apps' data (#570).
///
/// Created on demand; if the data dir is not writable, try an Agentero-only
/// subdirectory of the OS temp dir. If both locations fail, return an error
/// rather than use the process cwd or the whole temp directory.
pub fn agent_scratch_dir() -> std::io::Result<PathBuf> {
    agent_scratch_dir_in(&agentero_data_dir(), &std::env::temp_dir())
}

fn agent_scratch_dir_in(data_dir: &Path, temp_dir: &Path) -> std::io::Result<PathBuf> {
    let dir = data_dir.join("agent-cwd");
    match std::fs::create_dir_all(&dir) {
        Ok(()) => Ok(dir),
        Err(primary_error) => {
            let fallback = temp_dir.join("agentero").join("agent-cwd");
            std::fs::create_dir_all(&fallback).map_err(|fallback_error| {
                std::io::Error::new(
                    fallback_error.kind(),
                    format!(
                        "cannot create agent scratch directory at {} ({primary_error}) or {} ({fallback_error})",
                        dir.display(),
                        fallback.display(),
                    ),
                )
            })?;
            Ok(fallback)
        }
    }
}

/// Pre-XDG path used by older builds (`dirs::config_dir()/agentero`).
/// On Linux this often equals the XDG path; on macOS it was
/// `~/Library/Application Support/agentero`.
pub fn legacy_config_dir() -> Option<PathBuf> {
    dirs::config_dir().map(|p| p.join("agentero"))
}

/// If `target` is missing but a legacy file exists, copy it once (best-effort).
pub fn migrate_legacy_file(file_name: &str, target: &std::path::Path) {
    if target.exists() {
        return;
    }
    let Some(legacy_dir) = legacy_config_dir() else {
        return;
    };
    // Same directory as the new path — nothing to migrate.
    if legacy_dir == agentero_config_dir() {
        return;
    }
    let src = legacy_dir.join(file_name);
    if !src.is_file() {
        return;
    }
    if let Some(parent) = target.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    match std::fs::copy(&src, target) {
        Ok(_) => {
            log::info!(
                target: "agentero::paths",
                "migrated {file_name} from {} → {}",
                src.display(),
                target.display()
            );
        }
        Err(e) => {
            log::warn!(
                target: "agentero::paths",
                "failed to migrate {file_name} from {}: {e}",
                src.display()
            );
        }
    }
}

fn env_dir(key: &str) -> Option<PathBuf> {
    std::env::var_os(key)
        .filter(|v| !v.is_empty())
        .map(PathBuf::from)
}

/// Fallback home directory for XDG defaults. Only used where the `~/.config`
/// convention applies (not Windows/iOS), hence the cfg gate to avoid a
/// dead-code warning on those builds.
#[cfg(not(any(windows, target_os = "ios")))]
fn home_dir() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_dir_ends_with_agentero() {
        let p = agentero_config_dir();
        assert_eq!(p.file_name().and_then(|s| s.to_str()), Some("agentero"));
    }

    #[test]
    fn settings_agents_and_plugins_share_config_dir() {
        let settings = settings_path();
        let agents = agents_path();
        let plugins = plugins_path();
        assert_eq!(settings.parent(), agents.parent());
        assert_eq!(settings.parent(), plugins.parent());
        assert_eq!(
            plugins.file_name().and_then(|s| s.to_str()),
            Some("plugins.json")
        );
    }

    #[test]
    fn cache_dir_ends_with_agentero() {
        let p = agentero_cache_dir();
        assert_eq!(p.file_name().and_then(|s| s.to_str()), Some("agentero"));
    }

    #[test]
    fn models_dir_under_cache() {
        let p = agentero_models_dir();
        assert_eq!(p.file_name().and_then(|s| s.to_str()), Some("models"));
        assert_eq!(p.parent(), Some(agentero_cache_dir().as_path()));
    }

    #[test]
    fn mcp_tunnel_dir_under_cache() {
        let p = mcp_tunnel_dir();
        assert_eq!(p.file_name().and_then(|s| s.to_str()), Some("mcp-tunnel"));
        assert_eq!(p.parent(), Some(agentero_cache_dir().as_path()));
    }

    #[test]
    fn data_dir_ends_with_agentero() {
        let p = agentero_data_dir();
        assert_eq!(p.file_name().and_then(|s| s.to_str()), Some("agentero"));
    }

    #[test]
    fn agent_scratch_dir_prefers_and_reuses_the_data_directory() {
        let root = tempfile::tempdir().unwrap();
        let data_dir = root.path().join("data");
        let temp_dir = root.path().join("temp");
        let expected = data_dir.join("agent-cwd");

        for _ in 0..2 {
            let cwd = agent_scratch_dir_in(&data_dir, &temp_dir).unwrap();
            assert_eq!(cwd, expected);
            assert!(cwd.is_dir());
        }
        assert!(!temp_dir.exists());
    }

    #[test]
    fn agent_scratch_fallback_stays_in_a_dedicated_subdirectory() {
        let root = tempfile::tempdir().unwrap();
        let blocked_data_dir = root.path().join("data-file");
        std::fs::write(&blocked_data_dir, b"not a directory").unwrap();
        let temp_dir = root.path().join("temp");
        std::fs::create_dir(&temp_dir).unwrap();

        let cwd = agent_scratch_dir_in(&blocked_data_dir, &temp_dir).unwrap();
        assert_eq!(cwd, temp_dir.join("agentero").join("agent-cwd"));
        assert!(cwd.is_dir());
    }

    #[test]
    fn agent_scratch_dir_errors_when_both_locations_are_unavailable() {
        let root = tempfile::tempdir().unwrap();
        let data_dir = root.path().join("data-file");
        let temp_dir = root.path().join("temp-file");
        std::fs::write(&data_dir, b"not a directory").unwrap();
        std::fs::write(&temp_dir, b"not a directory").unwrap();

        let error = agent_scratch_dir_in(&data_dir, &temp_dir).unwrap_err();
        let message = error.to_string();
        assert!(message.contains("cannot create agent scratch directory"));
        assert!(message.contains(&data_dir.join("agent-cwd").display().to_string()));
        assert!(message.contains(
            &temp_dir
                .join("agentero")
                .join("agent-cwd")
                .display()
                .to_string()
        ));
    }

    #[test]
    fn usage_db_under_data_dir() {
        let p = usage_db_path();
        assert_eq!(p.file_name().and_then(|s| s.to_str()), Some("usage.sqlite"));
        assert_eq!(p.parent(), Some(agentero_data_dir().as_path()));
    }

    #[test]
    fn feeds_db_under_data_dir() {
        let p = feeds_db_path();
        assert_eq!(p.file_name().and_then(|s| s.to_str()), Some("feeds.sqlite"));
        assert_eq!(p.parent(), Some(agentero_data_dir().as_path()));
    }

    #[test]
    fn local_vault_state_dir_stays_inside_the_vault() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(vault_state_dir(dir.path()), dir.path().join(".agentero"));
    }

    #[cfg(windows)]
    #[test]
    fn network_vault_state_dir_moves_to_the_local_data_dir() {
        let unc = Path::new(r"\\wsl.localhost\Ubuntu-24.04\home\u\Vault");
        assert!(is_network_vault_path(unc));
        let state = vault_state_dir(unc);
        assert!(state.starts_with(agentero_data_dir().join("vault-state")));
        // Stable across calls so reopening the vault reuses its catalog.
        assert_eq!(state, vault_state_dir(unc));
        assert_eq!(
            state.file_name().and_then(|s| s.to_str()).unwrap().len(),
            16
        );

        let verbatim = Path::new(r"\\?\UNC\wsl.localhost\Ubuntu-24.04\home\u\Vault");
        assert!(is_network_vault_path(verbatim));
    }

    #[cfg(windows)]
    #[test]
    fn local_drive_paths_are_not_network_vaults() {
        assert!(!is_network_vault_path(Path::new(r"C:\Vaults\Research")));
        assert!(!is_network_vault_path(Path::new(r"\\?\C:\Vaults\Research")));
    }
}
