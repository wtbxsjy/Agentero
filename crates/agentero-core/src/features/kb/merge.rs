//! Run kb-template's `R/kb_merge.R` inside a knowledge base.
//!
//! Only a fixed set of actions is exposed (no free-form argv), and every id is
//! validated, so the front end cannot be used to run arbitrary R.

use super::{check_id, read_config};
use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::Duration;

#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(tag = "action", rename_all = "camelCase")]
pub enum MergeRequest {
    /// `--list --json`: pending proposals with `fresh` (base hash still matches).
    List,
    /// `--show ID`: rationale, evidence and the unified diff as the merger sees it.
    Show { id: String },
    /// `--accept ID…`
    Accept { ids: Vec<String> },
    /// `--reject ID… --reason R`
    Reject { ids: Vec<String>, reason: String },
    /// `--check`: move proposals whose target changed to stale.
    Check,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct MergeOutput {
    /// Process exit code (-1 when killed by a signal).
    pub code: i32,
    pub stdout: String,
    pub stderr: String,
    /// The Rscript program that ran, for error messages.
    pub program: String,
}

const MAX_IDS: usize = 500;

impl MergeRequest {
    fn args(&self, by: Option<&str>) -> Result<Vec<String>, AppError> {
        let ids_ok = |ids: &[String]| -> Result<(), AppError> {
            if ids.is_empty() || ids.len() > MAX_IDS {
                return Err(AppError::domain(
                    "kb_bad_request",
                    format!("expected 1..={MAX_IDS} proposal ids"),
                ));
            }
            ids.iter().try_for_each(|id| check_id(id))
        };
        let mut args: Vec<String> = match self {
            Self::List => vec!["--list".into(), "--json".into()],
            Self::Show { id } => {
                check_id(id)?;
                vec!["--show".into(), id.clone()]
            }
            Self::Accept { ids } => {
                ids_ok(ids)?;
                std::iter::once("--accept".to_string())
                    .chain(ids.iter().cloned())
                    .collect()
            }
            Self::Reject { ids, reason } => {
                ids_ok(ids)?;
                let reason = reason.trim();
                // kb_merge.R reads the value after --reason; a value starting
                // with "--" would be taken for the next flag.
                let reason = reason.trim_start_matches('-').trim();
                let mut a: Vec<String> = std::iter::once("--reject".to_string())
                    .chain(ids.iter().cloned())
                    .collect();
                if !reason.is_empty() {
                    a.push("--reason".into());
                    a.push(reason.to_string());
                }
                a
            }
            Self::Check => vec!["--check".into()],
        };
        if let Some(by) = by.map(str::trim).filter(|b| !b.is_empty()) {
            if matches!(
                self,
                Self::Accept { .. } | Self::Reject { .. } | Self::Check
            ) {
                args.push("--by".into());
                args.push(by.trim_start_matches('-').to_string());
            }
        }
        Ok(args)
    }

    fn timeout(&self) -> Duration {
        match self {
            Self::List | Self::Show { .. } => Duration::from_secs(120),
            Self::Accept { ids } | Self::Reject { ids, .. } => {
                Duration::from_secs(120 + 10 * ids.len() as u64)
            }
            Self::Check => Duration::from_secs(600),
        }
    }
}

/// Rscript to run: the configured one, else `Rscript` on PATH, else (Windows)
/// the newest `C:\Program Files\R\R-*\bin\Rscript.exe`.
fn resolve_rscript(configured: Option<&str>) -> PathBuf {
    if let Some(c) = configured.map(str::trim).filter(|c| !c.is_empty()) {
        return PathBuf::from(c);
    }
    #[cfg(windows)]
    {
        let on_path = std::env::var_os("PATH")
            .is_some_and(|p| std::env::split_paths(&p).any(|d| d.join("Rscript.exe").is_file()));
        if !on_path {
            for base in ["C:\\Program Files\\R", "C:\\Program Files (x86)\\R"] {
                if let Ok(entries) = std::fs::read_dir(base) {
                    let mut dirs: Vec<PathBuf> = entries
                        .filter_map(Result::ok)
                        .map(|e| e.path().join("bin").join("Rscript.exe"))
                        .filter(|p| p.is_file())
                        .collect();
                    dirs.sort();
                    if let Some(last) = dirs.pop() {
                        return last;
                    }
                }
            }
        }
    }
    PathBuf::from("Rscript")
}

/// Run one merger action with the base as working directory and `KB_HOME`.
pub async fn run_merge(
    kb_dir: &Path,
    rscript: Option<&str>,
    by: Option<&str>,
    request: &MergeRequest,
) -> Result<MergeOutput, AppError> {
    read_config(kb_dir)?;
    let script = kb_dir.join("R").join("kb_merge.R");
    if !script.is_file() {
        return Err(AppError::domain(
            "kb_merge_missing",
            format!(
                "{} has no R/kb_merge.R: copy R/ from a kb-template checkout that has the proposal channel",
                kb_dir.display()
            ),
        ));
    }
    let program = resolve_rscript(rscript);
    let mut cmd = tokio::process::Command::new(&program);
    // No --vanilla: users commonly point R_LIBS_USER at their package
    // library from ~/.Renviron, and kb_use_lib() reads KB_RLIB from there too.
    cmd.current_dir(kb_dir)
        .arg(Path::new("R").join("kb_merge.R"))
        .args(request.args(by)?)
        .env("KB_HOME", kb_dir);
    // kb-template paths and messages are UTF-8 (Chinese file names are common);
    // under a C/POSIX locale R mangles them.
    #[cfg(unix)]
    {
        let utf8 = |k: &str| {
            std::env::var(k)
                .map(|v| v.to_uppercase().contains("UTF-8") || v.to_uppercase().contains("UTF8"))
                .unwrap_or(false)
        };
        if !utf8("LC_ALL") && !utf8("LANG") {
            let loc = if cfg!(target_os = "macos") {
                "en_US.UTF-8"
            } else {
                "C.UTF-8"
            };
            cmd.env("LANG", loc).env("LC_ALL", loc);
        }
    }
    crate::process::hide_console_window_tokio(&mut cmd);
    let out = tokio::time::timeout(request.timeout(), crate::process::command_output(&mut cmd))
        .await
        .map_err(|_| AppError::domain("kb_merge_timeout", "kb_merge.R timed out"))?
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                AppError::domain(
                    "kb_rscript_missing",
                    format!(
                        "Rscript not found ({}): install R or set the Rscript path in the review inbox settings",
                        program.display()
                    ),
                )
            } else {
                AppError::from(e)
            }
        })?;
    Ok(MergeOutput {
        code: out.status.code().unwrap_or(-1),
        stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
        program: program.to_string_lossy().into_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const ID: &str = "p-20261115-021000-abc123";

    #[test]
    fn builds_reject_args_with_reason_and_decider() {
        let req = MergeRequest::Reject {
            ids: vec![ID.into()],
            reason: "--来源不支持".into(),
        };
        assert_eq!(
            req.args(Some("wt")).unwrap(),
            vec!["--reject", ID, "--reason", "来源不支持", "--by", "wt"]
        );
    }

    #[test]
    fn rejects_bad_ids_and_empty_batches() {
        assert!(MergeRequest::Accept { ids: vec![] }.args(None).is_err());
        assert!(MergeRequest::Accept {
            ids: vec!["--help".into()]
        }
        .args(None)
        .is_err());
        assert!(MergeRequest::Show {
            id: "../etc".into()
        }
        .args(None)
        .is_err());
    }

    #[test]
    fn list_ignores_decider() {
        assert_eq!(
            MergeRequest::List.args(Some("wt")).unwrap(),
            vec!["--list", "--json"]
        );
    }
}
