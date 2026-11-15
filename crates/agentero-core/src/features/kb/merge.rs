//! Run kb-template's R scripts inside a knowledge base: `R/kb_merge.R`
//! (review / route / submit), `R/kb_audit.R` (spot checks of auto-merges),
//! `R/kb_dedupe.R` (duplicate entities → `merge_entity` proposals) and
//! `R/kb_compile.R` (compile plan and runs of ticked sources).
//!
//! Where the script comes from: with the kb-template setting, the script is
//! `<kb-template>/R/<script>` (bases no longer carry the code; kb-template P4),
//! run with the base as working directory and `KB_TEMPLATE` set. Without it,
//! the base's own `R/<script>` (a forwarder written by `kb_init --scripts
//! shared`, or an older full copy).
//!
//! Only a fixed set of actions is exposed (no free-form argv), and every id is
//! validated, so the front end cannot be used to run arbitrary R.
//!
//! Rscript can be native or inside WSL (Windows): the Rscript setting
//! `wsl`, `wsl:<distro>` or `wsl:<distro>:<path to Rscript>` runs
//! `wsl.exe [-d distro] --cd <linux path> -e env KB_HOME=… Rscript …`, with the
//! base path translated (`C:\x` → `/mnt/c/x`, `\\wsl$\D\home\x` → `/home/x`).

use super::{check_id, read_config};
use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;

/// One async lock per base: writes from this app (accept, route, audit marks,
/// merge proposals) run one at a time, so two clicks never race on git.
/// kb-template's own `proposals/.lock` covers other processes (a compile
/// that routes afterwards, the CLI).
static BASE_LOCKS: LazyLock<Mutex<HashMap<PathBuf, Arc<tokio::sync::Mutex<()>>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn base_lock(kb_dir: &Path) -> Arc<tokio::sync::Mutex<()>> {
    let key = std::fs::canonicalize(kb_dir).unwrap_or_else(|_| kb_dir.to_path_buf());
    let mut map = BASE_LOCKS.lock().unwrap_or_else(|e| e.into_inner());
    map.entry(key).or_default().clone()
}

/// Run `fut` holding the base's write lock when `writes` is set.
async fn serialized<T>(
    kb_dir: &Path,
    writes: bool,
    fut: impl std::future::Future<Output = T>,
) -> T {
    if !writes {
        return fut.await;
    }
    let lock = base_lock(kb_dir);
    let _guard = lock.lock().await;
    fut.await
}

#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(tag = "action", rename_all = "camelCase")]
pub enum MergeRequest {
    /// `--list --json`: pending proposals with `fresh` (base hash still matches)
    /// and a `route` preview (auto rule or why it needs a human).
    List,
    /// `--show ID`: rationale, evidence and the unified diff as the merger sees it.
    Show { id: String },
    /// `--accept ID…`
    Accept { ids: Vec<String> },
    /// `--reject ID… --reason R [--reason-code C] [--duplicate-of PAGE]`
    #[serde(rename_all = "camelCase")]
    Reject {
        ids: Vec<String>,
        reason: String,
        reason_code: Option<String>,
        duplicate_of: Option<String>,
    },
    /// `--check`: move proposals whose target changed to stale.
    Check,
    /// `--route [--dry-run]`: auto-merge low-risk proposals, tag the rest for the inbox.
    #[serde(rename_all = "camelCase")]
    Route { dry_run: bool },
    /// `--reasons --json`: rejection reason categories from the domain profile.
    Reasons,
    /// `--submit FILE --json`: register a draft (a Q&A answer saved as a
    /// proposal) as a pending proposal. `draft` is the JSON text; the merger
    /// computes id, hashes and risk.
    Submit { draft: String },
}

/// `R/kb_compile.R`: the plan card lists the queue, the reviewer ticks
/// sources, and only those are compiled.
#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(tag = "action", rename_all = "camelCase")]
pub enum CompileRequest {
    /// `--dry-run --json`: queue (value_gate keep, status raw/stale), budget,
    /// rough token estimates, provider and model.
    Plan,
    /// `--ids A,B,C`: compile exactly these raw records into proposals.
    Run { ids: Vec<String> },
}

/// Spot-check verdict for an auto-merged proposal.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum AuditVerdict {
    Ok,
    Wrong,
}

#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(tag = "action", rename_all = "camelCase")]
pub enum AuditRequest {
    /// `--list --json`: the spot-check queue.
    List,
    /// `--show ID`: the auto-merge commit (git show).
    Show { id: String },
    /// `--sample --json`: sample new auto-merges into the queue.
    Sample,
    /// `--ok ID` / `--wrong ID [--revert]`, with an optional `--note`.
    Mark {
        id: String,
        verdict: AuditVerdict,
        note: Option<String>,
        revert: bool,
    },
    /// `--report --json`: per-rule error rates and disabled rules.
    Report,
}

#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(tag = "action", rename_all = "camelCase")]
pub enum DedupeRequest {
    /// `--scan --json`: candidate duplicate pairs.
    Scan,
    /// `--merge FROM --into INTO [--reason R] --json`: one manual merge proposal.
    Merge {
        from: String,
        into: String,
        reason: Option<String>,
    },
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
const MAX_TEXT: usize = 2000;

fn bad(msg: impl Into<String>) -> AppError {
    AppError::domain("kb_bad_request", msg.into())
}

/// Free text passed as a flag value: trimmed, bounded, and never starting with
/// `-` (the R scripts read the next argv item as the value; `--x` would be
/// taken for a flag).
fn text_arg(s: &str) -> Option<String> {
    let s = s.trim().trim_start_matches('-').trim();
    if s.is_empty() {
        return None;
    }
    Some(s.chars().take(MAX_TEXT).collect())
}

/// Wiki page ids / reason codes: the characters kb-template ids use
/// (lower-case kebab, digits, CJK, `_`), no path separators.
fn check_token(kind: &str, s: &str) -> Result<(), AppError> {
    let ok = !s.is_empty()
        && s.len() <= 200
        && !s.starts_with('-')
        && s.chars()
            .all(|c| c.is_alphanumeric() || c == '-' || c == '_' || c == '.')
        && !s.contains("..");
    if ok {
        Ok(())
    } else {
        Err(bad(format!("invalid {kind}: {s}")))
    }
}

fn ids_ok(ids: &[String]) -> Result<(), AppError> {
    if ids.is_empty() || ids.len() > MAX_IDS {
        return Err(bad(format!("expected 1..={MAX_IDS} proposal ids")));
    }
    ids.iter().try_for_each(|id| check_id(id))
}

fn push_by(args: &mut Vec<String>, by: Option<&str>) {
    if let Some(by) = by.and_then(text_arg) {
        args.push("--by".into());
        args.push(by);
    }
}

impl MergeRequest {
    fn args(&self, by: Option<&str>) -> Result<Vec<String>, AppError> {
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
            Self::Reject {
                ids,
                reason,
                reason_code,
                duplicate_of,
            } => {
                ids_ok(ids)?;
                let mut a: Vec<String> = std::iter::once("--reject".to_string())
                    .chain(ids.iter().cloned())
                    .collect();
                if let Some(r) = text_arg(reason) {
                    a.push("--reason".into());
                    a.push(r);
                }
                if let Some(c) = reason_code
                    .as_deref()
                    .map(str::trim)
                    .filter(|c| !c.is_empty())
                {
                    check_token("reason code", c)?;
                    a.push("--reason-code".into());
                    a.push(c.to_string());
                }
                if let Some(d) = duplicate_of
                    .as_deref()
                    .map(str::trim)
                    .filter(|d| !d.is_empty())
                {
                    check_token("page id", d)?;
                    a.push("--duplicate-of".into());
                    a.push(d.to_string());
                }
                a
            }
            Self::Check => vec!["--check".into()],
            Self::Route { dry_run } => {
                let mut a = vec!["--route".to_string()];
                if *dry_run {
                    a.push("--dry-run".into());
                }
                a.push("--json".into());
                a
            }
            Self::Reasons => vec!["--reasons".into(), "--json".into()],
            // The draft goes through a file; run_merge fills in the path.
            Self::Submit { draft } => {
                check_draft(draft)?;
                vec!["--submit".into(), String::new(), "--json".into()]
            }
        };
        if matches!(
            self,
            Self::Accept { .. }
                | Self::Reject { .. }
                | Self::Check
                | Self::Route { dry_run: false }
        ) {
            push_by(&mut args, by);
        }
        Ok(args)
    }

    fn timeout(&self) -> Duration {
        match self {
            Self::List | Self::Show { .. } | Self::Reasons => Duration::from_secs(120),
            Self::Accept { ids } | Self::Reject { ids, .. } => {
                Duration::from_secs(120 + 10 * ids.len() as u64)
            }
            Self::Check | Self::Route { .. } => Duration::from_secs(900),
            Self::Submit { .. } => Duration::from_secs(120),
        }
    }
}

const MAX_DRAFT: usize = 1024 * 1024;

/// A submitted draft must be a JSON object proposing a whole page; the merger
/// checks the rest (target under the wiki, schema).
fn check_draft(draft: &str) -> Result<(), AppError> {
    if draft.len() > MAX_DRAFT {
        return Err(bad("draft too large"));
    }
    let v: serde_json::Value =
        serde_json::from_str(draft).map_err(|e| bad(format!("draft is not JSON: {e}")))?;
    let kind = v.get("kind").and_then(|k| k.as_str()).unwrap_or("new_page");
    if !v.is_object() || !matches!(kind, "new_page" | "edit_page") {
        return Err(bad("draft must be a new_page / edit_page object"));
    }
    Ok(())
}

impl CompileRequest {
    fn args(&self) -> Result<Vec<String>, AppError> {
        Ok(match self {
            Self::Plan => vec!["--dry-run".into(), "--json".into()],
            Self::Run { ids } => {
                if ids.is_empty() || ids.len() > MAX_IDS {
                    return Err(bad(format!("expected 1..={MAX_IDS} raw record ids")));
                }
                for id in ids {
                    check_token("raw record id", id)?;
                    if id.contains(',') {
                        return Err(bad(format!("invalid raw record id: {id}")));
                    }
                }
                vec!["--ids".into(), ids.join(",")]
            }
        })
    }

    fn timeout(&self) -> Duration {
        match self {
            Self::Plan => Duration::from_secs(120),
            // A compile run calls the model once or more per source.
            Self::Run { ids } => Duration::from_secs(600 + 900 * ids.len() as u64),
        }
    }
}

impl AuditRequest {
    fn args(&self, by: Option<&str>) -> Result<Vec<String>, AppError> {
        let mut args: Vec<String> = match self {
            Self::List => vec!["--list".into(), "--json".into()],
            Self::Show { id } => {
                check_id(id)?;
                vec!["--show".into(), id.clone()]
            }
            Self::Sample => vec!["--sample".into(), "--json".into()],
            Self::Mark {
                id,
                verdict,
                note,
                revert,
            } => {
                check_id(id)?;
                let mut a = vec![
                    match verdict {
                        AuditVerdict::Ok => "--ok".to_string(),
                        AuditVerdict::Wrong => "--wrong".to_string(),
                    },
                    id.clone(),
                ];
                if let Some(n) = note.as_deref().and_then(text_arg) {
                    a.push("--note".into());
                    a.push(n);
                }
                if *revert && *verdict == AuditVerdict::Wrong {
                    a.push("--revert".into());
                }
                a
            }
            Self::Report => vec!["--report".into(), "--json".into()],
        };
        if matches!(self, Self::Mark { .. } | Self::Sample) {
            push_by(&mut args, by);
        }
        Ok(args)
    }
}

impl DedupeRequest {
    fn args(&self) -> Result<Vec<String>, AppError> {
        Ok(match self {
            Self::Scan => vec!["--scan".into(), "--json".into()],
            Self::Merge { from, into, reason } => {
                check_token("page id", from)?;
                check_token("page id", into)?;
                if from == into {
                    return Err(bad("cannot merge a page into itself"));
                }
                let mut a = vec![
                    "--merge".to_string(),
                    from.clone(),
                    "--into".into(),
                    into.clone(),
                ];
                if let Some(r) = reason.as_deref().and_then(text_arg) {
                    a.push("--reason".into());
                    a.push(r);
                }
                a.push("--json".into());
                a
            }
        })
    }
}

/// How to start Rscript.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RscriptSpec {
    Native(PathBuf),
    /// Inside WSL: optional distro, program inside the distro.
    Wsl {
        distro: Option<String>,
        program: String,
    },
}

/// Parse the Rscript setting: empty → `Rscript` (PATH, or the newest
/// `C:\Program Files\R\R-*` on Windows); `wsl[:distro[:program]]` → WSL;
/// anything else is a path to Rscript.
pub fn parse_rscript(configured: Option<&str>) -> RscriptSpec {
    let c = configured.map(str::trim).unwrap_or("");
    let lower = c.to_ascii_lowercase();
    if lower == "wsl" || lower.starts_with("wsl:") {
        let mut parts = c.splitn(3, ':').skip(1);
        let distro = parts
            .next()
            .map(str::trim)
            .filter(|d| !d.is_empty())
            .map(str::to_string);
        let program = parts
            .next()
            .map(str::trim)
            .filter(|p| !p.is_empty())
            .unwrap_or("Rscript")
            .to_string();
        return RscriptSpec::Wsl { distro, program };
    }
    if !c.is_empty() {
        return RscriptSpec::Native(PathBuf::from(c));
    }
    RscriptSpec::Native(default_rscript())
}

fn default_rscript() -> PathBuf {
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

/// Windows path of a knowledge base → (path inside WSL, distro named by a
/// `\\wsl$\<distro>\…` / `\\wsl.localhost\<distro>\…` UNC path).
/// Already-POSIX paths pass through.
pub fn wsl_path(win: &str) -> Result<(String, Option<String>), AppError> {
    let s = win.trim();
    if s.starts_with('/') {
        return Ok((s.to_string(), None));
    }
    let norm = s.replace('/', "\\");
    // \\?\C:\x (verbatim) → C:\x
    let norm = norm
        .strip_prefix("\\\\?\\")
        .map(str::to_string)
        .unwrap_or(norm);
    let lower = norm.to_ascii_lowercase();
    for prefix in ["\\\\wsl$\\", "\\\\wsl.localhost\\"] {
        if lower.starts_with(prefix) {
            let rest = &norm[prefix.len()..];
            let mut it = rest.splitn(2, '\\');
            let distro = it.next().unwrap_or("").to_string();
            let tail = it.next().unwrap_or("").replace('\\', "/");
            if distro.is_empty() {
                break;
            }
            return Ok((format!("/{}", tail.trim_end_matches('/')), Some(distro)));
        }
    }
    let b = norm.as_bytes();
    if b.len() >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':' {
        let drive = (b[0] as char).to_ascii_lowercase();
        let tail = norm[2..].replace('\\', "/");
        let tail = tail.trim_end_matches('/');
        return Ok((
            format!(
                "/mnt/{drive}{}",
                if tail.starts_with('/') || tail.is_empty() {
                    tail.to_string()
                } else {
                    format!("/{tail}")
                }
            ),
            None,
        ));
    }
    Err(AppError::domain(
        "kb_wsl_path",
        format!("cannot map {s} into WSL: use a drive path (C:\\…) or \\\\wsl$\\<distro>\\…"),
    ))
}

/// Program, argv and extra environment for one script run.
pub type ScriptCommand = (PathBuf, Vec<String>, Vec<(String, String)>);

/// Where the script runs from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ScriptSource {
    /// The base's own `R/<script>` (forwarder or full copy), relative to the base.
    Base,
    /// `<kb-template>/R/<script>`. A path starting with `/` under WSL is a
    /// Linux path inside the distro and is used as is.
    Template(String),
}

/// Pick the script: the kb-template setting wins when set (and must have the
/// script), else the base's `R/`.
pub fn resolve_script(
    kb_dir: &Path,
    spec: &RscriptSpec,
    template: Option<&str>,
    script: &str,
) -> Result<ScriptSource, AppError> {
    if let Some(t) = template.map(str::trim).filter(|t| !t.is_empty()) {
        let linux_in_wsl = matches!(spec, RscriptSpec::Wsl { .. }) && t.starts_with('/');
        if linux_in_wsl || Path::new(t).join("R").join(script).is_file() {
            return Ok(ScriptSource::Template(t.to_string()));
        }
        return Err(AppError::domain(
            "kb_template_missing",
            format!(
                "{t} has no R/{script}: point the kb-template setting at a kb-template checkout (git pull it for new scripts)"
            ),
        ));
    }
    if kb_dir.join("R").join(script).is_file() {
        return Ok(ScriptSource::Base);
    }
    let code = if script == "kb_merge.R" {
        "kb_merge_missing"
    } else {
        "kb_script_missing"
    };
    Err(AppError::domain(
        code,
        format!(
            "{} has no R/{script}: set the kb-template folder in the review inbox settings",
            kb_dir.display()
        ),
    ))
}

/// Program + argv for one script run. Separate from spawning so it is testable.
pub fn build_command(
    spec: &RscriptSpec,
    kb_dir: &Path,
    source: &ScriptSource,
    script: &str,
    args: &[String],
) -> Result<ScriptCommand, AppError> {
    match spec {
        RscriptSpec::Native(p) => {
            let mut envs = vec![("KB_HOME".into(), kb_dir.to_string_lossy().into_owned())];
            let script_path = match source {
                ScriptSource::Base => Path::new("R").join(script),
                ScriptSource::Template(t) => {
                    envs.push(("KB_TEMPLATE".into(), t.clone()));
                    Path::new(t).join("R").join(script)
                }
            };
            let mut argv = vec![script_path.to_string_lossy().into_owned()];
            argv.extend(args.iter().cloned());
            Ok((p.clone(), argv, envs))
        }
        RscriptSpec::Wsl { distro, program } => {
            let (linux, unc_distro) = wsl_path(&kb_dir.to_string_lossy())?;
            let distro = distro.clone().or(unc_distro);
            let mut argv = Vec::new();
            if let Some(d) = distro {
                argv.push("-d".into());
                argv.push(d);
            }
            argv.extend([
                "--cd".to_string(),
                linux.clone(),
                "-e".into(),
                "env".into(),
                format!("KB_HOME={linux}"),
                "LANG=C.UTF-8".into(),
                "LC_ALL=C.UTF-8".into(),
            ]);
            let script_path = match source {
                ScriptSource::Base => format!("R/{script}"),
                ScriptSource::Template(t) => {
                    let tl = if t.starts_with('/') {
                        t.trim_end_matches('/').to_string()
                    } else {
                        wsl_path(t)?.0
                    };
                    argv.push(format!("KB_TEMPLATE={tl}"));
                    format!("{tl}/R/{script}")
                }
            };
            argv.push(program.clone());
            argv.push(script_path);
            argv.extend(args.iter().cloned());
            Ok((PathBuf::from("wsl.exe"), argv, Vec::new()))
        }
    }
}

/// How to start the scripts: the Rscript setting and the kb-template folder
/// setting (both per machine, from the review inbox settings).
#[derive(Debug, Clone, Copy, Default)]
pub struct Runner<'a> {
    pub rscript: Option<&'a str>,
    pub template: Option<&'a str>,
}

/// Run one kb-template script with the base as working directory.
async fn run_script(
    kb_dir: &Path,
    runner: Runner<'_>,
    script: &str,
    args: Vec<String>,
    timeout: Duration,
) -> Result<MergeOutput, AppError> {
    read_config(kb_dir)?;
    let spec = parse_rscript(runner.rscript);
    if matches!(spec, RscriptSpec::Wsl { .. }) && !cfg!(windows) {
        return Err(AppError::domain(
            "kb_wsl_unavailable",
            "the Rscript setting asks for WSL, which only exists on Windows",
        ));
    }
    let source = resolve_script(kb_dir, &spec, runner.template, script)?;
    let (program, argv, envs) = build_command(&spec, kb_dir, &source, script, &args)?;
    let mut cmd = tokio::process::Command::new(&program);
    // No --vanilla: users commonly point R_LIBS_USER at their package
    // library from ~/.Renviron, and kb_use_lib() reads KB_RLIB from there too.
    cmd.current_dir(kb_dir).args(&argv);
    for (k, v) in envs {
        cmd.env(k, v);
    }
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
    let out = tokio::time::timeout(timeout, crate::process::command_output(&mut cmd))
        .await
        .map_err(|_| AppError::domain("kb_merge_timeout", format!("{script} timed out")))?
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                AppError::domain(
                    "kb_rscript_missing",
                    format!(
                        "Rscript not found ({}): install R or set the Rscript path in the review inbox settings (wsl / wsl:<distro> runs it inside WSL)",
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
        program: match &spec {
            RscriptSpec::Native(p) => p.to_string_lossy().into_owned(),
            RscriptSpec::Wsl { program, .. } => format!("wsl.exe … {program}"),
        },
    })
}

/// Run one merger action (`R/kb_merge.R`).
pub async fn run_merge(
    kb_dir: &Path,
    runner: Runner<'_>,
    by: Option<&str>,
    request: &MergeRequest,
) -> Result<MergeOutput, AppError> {
    let writes = match request {
        MergeRequest::List | MergeRequest::Show { .. } | MergeRequest::Reasons => false,
        MergeRequest::Route { dry_run } => !dry_run,
        _ => true,
    };
    let mut args = request.args(by)?;
    let mut draft_file = None;
    if let MergeRequest::Submit { draft } = request {
        // Inside the base (so a WSL Rscript sees it too), next to pending/,
        // named so the merger's p-*.json listing never picks it up.
        let (_, paths) = read_config(kb_dir)?;
        let rel = format!(
            "{}/.submit-{}.json",
            paths.proposals.trim_end_matches('/'),
            uuid::Uuid::new_v4().simple()
        );
        let abs = kb_dir.join(&rel);
        if let Some(parent) = abs.parent() {
            std::fs::create_dir_all(parent).map_err(AppError::from)?;
        }
        std::fs::write(&abs, draft).map_err(AppError::from)?;
        args[1] = rel;
        draft_file = Some(abs);
    }
    let out = serialized(
        kb_dir,
        writes,
        run_script(kb_dir, runner, "kb_merge.R", args, request.timeout()),
    )
    .await;
    if let Some(f) = draft_file {
        let _ = std::fs::remove_file(f);
    }
    out
}

/// Run one spot-check action (`R/kb_audit.R`).
pub async fn run_audit(
    kb_dir: &Path,
    runner: Runner<'_>,
    by: Option<&str>,
    request: &AuditRequest,
) -> Result<MergeOutput, AppError> {
    let timeout = match request {
        AuditRequest::Mark { revert: true, .. } => Duration::from_secs(300),
        _ => Duration::from_secs(180),
    };
    let writes = matches!(request, AuditRequest::Sample | AuditRequest::Mark { .. });
    let args = request.args(by)?;
    serialized(
        kb_dir,
        writes,
        run_script(kb_dir, runner, "kb_audit.R", args, timeout),
    )
    .await
}

/// Run one dedupe action (`R/kb_dedupe.R`).
pub async fn run_dedupe(
    kb_dir: &Path,
    runner: Runner<'_>,
    request: &DedupeRequest,
) -> Result<MergeOutput, AppError> {
    let writes = matches!(request, DedupeRequest::Merge { .. });
    let args = request.args()?;
    serialized(
        kb_dir,
        writes,
        run_script(
            kb_dir,
            runner,
            "kb_dedupe.R",
            args,
            Duration::from_secs(300),
        ),
    )
    .await
}

/// Compile plan or a compile run of ticked sources (`R/kb_compile.R`).
/// A run writes proposals (and raw status), so it takes the base's write lock.
pub async fn run_compile(
    kb_dir: &Path,
    runner: Runner<'_>,
    request: &CompileRequest,
) -> Result<MergeOutput, AppError> {
    let writes = matches!(request, CompileRequest::Run { .. });
    let args = request.args()?;
    serialized(
        kb_dir,
        writes,
        run_script(kb_dir, runner, "kb_compile.R", args, request.timeout()),
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    const ID: &str = "p-20261115-021000-abc123";

    #[tokio::test]
    async fn writes_to_one_base_run_one_at_a_time() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let dir = tempfile::tempdir().unwrap();
        let other = tempfile::tempdir().unwrap();
        assert!(Arc::ptr_eq(&base_lock(dir.path()), &base_lock(dir.path())));
        assert!(!Arc::ptr_eq(
            &base_lock(dir.path()),
            &base_lock(other.path())
        ));
        let live = Arc::new(AtomicUsize::new(0));
        let peak = Arc::new(AtomicUsize::new(0));
        let job = |writes: bool| {
            let (live, peak) = (live.clone(), peak.clone());
            serialized(dir.path(), writes, async move {
                let n = live.fetch_add(1, Ordering::SeqCst) + 1;
                peak.fetch_max(n, Ordering::SeqCst);
                tokio::time::sleep(Duration::from_millis(20)).await;
                live.fetch_sub(1, Ordering::SeqCst);
            })
        };
        tokio::join!(job(true), job(true), job(true));
        assert_eq!(peak.load(Ordering::SeqCst), 1);
        peak.store(0, Ordering::SeqCst);
        tokio::join!(job(false), job(false));
        assert_eq!(peak.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn builds_reject_args_with_reason_and_decider() {
        let req = MergeRequest::Reject {
            ids: vec![ID.into()],
            reason: "--来源不支持".into(),
            reason_code: Some("duplicate".into()),
            duplicate_of: Some("entity-p53".into()),
        };
        assert_eq!(
            req.args(Some("wt")).unwrap(),
            vec![
                "--reject",
                ID,
                "--reason",
                "来源不支持",
                "--reason-code",
                "duplicate",
                "--duplicate-of",
                "entity-p53",
                "--by",
                "wt"
            ]
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
        assert!(MergeRequest::Reject {
            ids: vec![ID.into()],
            reason: String::new(),
            reason_code: Some("--x".into()),
            duplicate_of: None,
        }
        .args(None)
        .is_err());
        assert!(DedupeRequest::Merge {
            from: "../a".into(),
            into: "b".into(),
            reason: None
        }
        .args()
        .is_err());
        assert!(DedupeRequest::Merge {
            from: "a".into(),
            into: "a".into(),
            reason: None
        }
        .args()
        .is_err());
    }

    #[test]
    fn list_ignores_decider_and_route_dry_run_too() {
        assert_eq!(
            MergeRequest::List.args(Some("wt")).unwrap(),
            vec!["--list", "--json"]
        );
        assert_eq!(
            MergeRequest::Route { dry_run: true }
                .args(Some("wt"))
                .unwrap(),
            vec!["--route", "--dry-run", "--json"]
        );
        assert_eq!(
            MergeRequest::Route { dry_run: false }
                .args(Some("wt"))
                .unwrap(),
            vec!["--route", "--json", "--by", "wt"]
        );
    }

    #[test]
    fn audit_mark_args() {
        let req = AuditRequest::Mark {
            id: ID.into(),
            verdict: AuditVerdict::Wrong,
            note: Some("链错了".into()),
            revert: true,
        };
        assert_eq!(
            req.args(None).unwrap(),
            vec!["--wrong", ID, "--note", "链错了", "--revert"]
        );
        // --revert only applies to a wrong verdict
        let ok = AuditRequest::Mark {
            id: ID.into(),
            verdict: AuditVerdict::Ok,
            note: None,
            revert: true,
        };
        assert_eq!(ok.args(Some("wt")).unwrap(), vec!["--ok", ID, "--by", "wt"]);
    }

    #[test]
    fn dedupe_merge_args() {
        let req = DedupeRequest::Merge {
            from: "tp53".into(),
            into: "entity-p53".into(),
            reason: Some("同一个蛋白".into()),
        };
        assert_eq!(
            req.args().unwrap(),
            vec![
                "--merge",
                "tp53",
                "--into",
                "entity-p53",
                "--reason",
                "同一个蛋白",
                "--json"
            ]
        );
    }

    #[test]
    fn parses_rscript_setting() {
        assert_eq!(
            parse_rscript(Some("/opt/R/bin/Rscript")),
            RscriptSpec::Native("/opt/R/bin/Rscript".into())
        );
        assert_eq!(
            parse_rscript(Some("wsl")),
            RscriptSpec::Wsl {
                distro: None,
                program: "Rscript".into()
            }
        );
        assert_eq!(
            parse_rscript(Some("WSL:Ubuntu-24.04")),
            RscriptSpec::Wsl {
                distro: Some("Ubuntu-24.04".into()),
                program: "Rscript".into()
            }
        );
        assert_eq!(
            parse_rscript(Some("wsl:Ubuntu:/usr/local/bin/Rscript")),
            RscriptSpec::Wsl {
                distro: Some("Ubuntu".into()),
                program: "/usr/local/bin/Rscript".into()
            }
        );
        assert_eq!(
            parse_rscript(Some("wsl::/opt/Rscript")),
            RscriptSpec::Wsl {
                distro: None,
                program: "/opt/Rscript".into()
            }
        );
    }

    #[test]
    fn maps_windows_paths_into_wsl() {
        assert_eq!(
            wsl_path("C:\\Users\\wt\\Vault\\kb\\amp").unwrap(),
            ("/mnt/c/Users/wt/Vault/kb/amp".into(), None)
        );
        assert_eq!(
            wsl_path("D:/data/kb/").unwrap(),
            ("/mnt/d/data/kb".into(), None)
        );
        assert_eq!(
            wsl_path("\\\\?\\C:\\kb").unwrap(),
            ("/mnt/c/kb".into(), None)
        );
        assert_eq!(
            wsl_path("\\\\wsl$\\Ubuntu\\home\\wt\\kb").unwrap(),
            ("/home/wt/kb".into(), Some("Ubuntu".into()))
        );
        assert_eq!(
            wsl_path("\\\\wsl.localhost\\Debian\\srv\\kb").unwrap(),
            ("/srv/kb".into(), Some("Debian".into()))
        );
        assert_eq!(
            wsl_path("/home/wt/kb").unwrap(),
            ("/home/wt/kb".into(), None)
        );
        assert!(wsl_path("\\\\server\\share\\kb").is_err());
    }

    #[test]
    fn builds_wsl_command() {
        let spec = RscriptSpec::Wsl {
            distro: None,
            program: "Rscript".into(),
        };
        let (prog, argv, envs) = build_command(
            &spec,
            Path::new("\\\\wsl$\\Ubuntu\\home\\wt\\kb"),
            &ScriptSource::Base,
            "kb_merge.R",
            &["--list".into(), "--json".into()],
        )
        .unwrap();
        assert_eq!(prog, PathBuf::from("wsl.exe"));
        assert!(envs.is_empty());
        assert_eq!(
            argv,
            vec![
                "-d",
                "Ubuntu",
                "--cd",
                "/home/wt/kb",
                "-e",
                "env",
                "KB_HOME=/home/wt/kb",
                "LANG=C.UTF-8",
                "LC_ALL=C.UTF-8",
                "Rscript",
                "R/kb_merge.R",
                "--list",
                "--json"
            ]
        );
        let (prog, argv, envs) = build_command(
            &RscriptSpec::Native("Rscript".into()),
            Path::new("/kb"),
            &ScriptSource::Base,
            "kb_audit.R",
            &["--report".into()],
        )
        .unwrap();
        assert_eq!(prog, PathBuf::from("Rscript"));
        assert_eq!(argv[1], "--report");
        assert!(argv[0].ends_with("kb_audit.R"));
        assert_eq!(envs, vec![("KB_HOME".to_string(), "/kb".to_string())]);
    }

    #[test]
    fn template_scripts_run_with_kb_template_set() {
        let (_, argv, envs) = build_command(
            &RscriptSpec::Native("Rscript".into()),
            Path::new("/kb"),
            &ScriptSource::Template("/src/kb-template".into()),
            "kb_merge.R",
            &["--list".into()],
        )
        .unwrap();
        assert_eq!(
            PathBuf::from(&argv[0]),
            Path::new("/src/kb-template").join("R").join("kb_merge.R")
        );
        assert!(envs.contains(&("KB_TEMPLATE".to_string(), "/src/kb-template".to_string())));
        let wsl = RscriptSpec::Wsl {
            distro: Some("Ubuntu".into()),
            program: "Rscript".into(),
        };
        let (_, argv, _) = build_command(
            &wsl,
            Path::new("C:\\kb\\amp"),
            &ScriptSource::Template("C:\\src\\kb-template".into()),
            "kb_compile.R",
            &["--dry-run".into()],
        )
        .unwrap();
        let tail: Vec<&str> = argv.iter().map(String::as_str).skip(9).collect();
        assert_eq!(
            tail,
            vec![
                "KB_TEMPLATE=/mnt/c/src/kb-template",
                "Rscript",
                "/mnt/c/src/kb-template/R/kb_compile.R",
                "--dry-run"
            ]
        );
        let (_, argv, _) = build_command(
            &wsl,
            Path::new("C:\\kb"),
            &ScriptSource::Template("/home/wt/kb-template/".into()),
            "kb_merge.R",
            &[],
        )
        .unwrap();
        assert_eq!(argv.last().unwrap(), "/home/wt/kb-template/R/kb_merge.R");
    }

    #[test]
    fn resolves_script_from_template_or_base() {
        let kb = tempfile::tempdir().unwrap();
        let tpl = tempfile::tempdir().unwrap();
        let native = RscriptSpec::Native("Rscript".into());
        let code = |r: Result<ScriptSource, AppError>| match r {
            Err(AppError::Domain { code, .. }) => code,
            other => panic!("expected a domain error, got {other:?}"),
        };
        assert_eq!(
            code(resolve_script(kb.path(), &native, None, "kb_merge.R")),
            "kb_merge_missing"
        );
        assert_eq!(
            code(resolve_script(kb.path(), &native, None, "kb_compile.R")),
            "kb_script_missing"
        );
        let t = tpl.path().to_string_lossy().into_owned();
        assert_eq!(
            code(resolve_script(kb.path(), &native, Some(&t), "kb_merge.R")),
            "kb_template_missing"
        );
        std::fs::create_dir_all(tpl.path().join("R")).unwrap();
        std::fs::write(tpl.path().join("R/kb_merge.R"), "").unwrap();
        assert_eq!(
            resolve_script(kb.path(), &native, Some(&t), "kb_merge.R").unwrap(),
            ScriptSource::Template(t.clone())
        );
        std::fs::create_dir_all(kb.path().join("R")).unwrap();
        std::fs::write(kb.path().join("R/kb_audit.R"), "").unwrap();
        assert_eq!(
            resolve_script(kb.path(), &native, Some("  "), "kb_audit.R").unwrap(),
            ScriptSource::Base
        );
        // A Linux path inside WSL cannot be checked from Windows: trusted.
        let wsl = RscriptSpec::Wsl {
            distro: None,
            program: "Rscript".into(),
        };
        assert_eq!(
            resolve_script(kb.path(), &wsl, Some("/opt/kb-template"), "kb_merge.R").unwrap(),
            ScriptSource::Template("/opt/kb-template".into())
        );
    }

    #[test]
    fn compile_and_submit_args() {
        assert_eq!(
            CompileRequest::Plan.args().unwrap(),
            vec!["--dry-run", "--json"]
        );
        assert_eq!(
            CompileRequest::Run {
                ids: vec!["smith-2020".into(), "lee-2019".into()]
            }
            .args()
            .unwrap(),
            vec!["--ids", "smith-2020,lee-2019"]
        );
        assert!(CompileRequest::Run { ids: vec![] }.args().is_err());
        assert!(CompileRequest::Run {
            ids: vec!["--all".into()]
        }
        .args()
        .is_err());
        assert!(CompileRequest::Run {
            ids: vec!["a,b".into()]
        }
        .args()
        .is_err());
        let ok = MergeRequest::Submit {
            draft: r#"{"kind":"new_page","target":"wiki/queries/q.md"}"#.into(),
        };
        assert_eq!(ok.args(Some("wt")).unwrap(), vec!["--submit", "", "--json"]);
        for bad_draft in ["not json", "[1]", r#"{"kind":"delete_page"}"#] {
            assert!(MergeRequest::Submit {
                draft: bad_draft.into()
            }
            .args(None)
            .is_err());
        }
    }
}
