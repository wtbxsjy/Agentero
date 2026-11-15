//! Knowledge-base review inbox (kb-template proposal channel).
//!
//! kb-template's pipeline never writes `wiki/` directly: every change lands as
//! one JSON proposal in `<kb>/proposals/pending/` (contract
//! `schema/proposal.schema.json`), and `R/kb_merge.R` is the only writer that
//! applies them. This module is the desktop side of that contract:
//!
//! - discover knowledge bases (`kb.config.yaml`) inside the open vault;
//! - read pending / decided proposals as raw JSON text (the front end parses
//!   them; keeping the text verbatim preserves key order, which the merger's
//!   `patch_hash` depends on);
//! - save a reviewer-edited proposal back into `pending/` (the merger then
//!   records it as `edited` and marks the page `human_edited`);
//! - run `kb_merge.R` for accept / reject / list / show / route, `kb_audit.R`
//!   for spot checks of auto-merged proposals and `kb_dedupe.R` for
//!   duplicate entities (`merge_entity` proposals);
//! - resolve an evidence reference (`source` raw id + `¶N` locator) to the
//!   paragraph text and, when the raw record points at a PDF, to a page rect.
//!
//! Accepting and rejecting always goes through `kb_merge.R`, never through
//! Rust: base-hash checks, raw status write-back and the one-commit-per-decision
//! audit trail live there, and duplicating them would let the two drift.

#[cfg(not(any(target_os = "ios", target_os = "android")))]
mod locate;
mod merge;

#[cfg(not(any(target_os = "ios", target_os = "android")))]
pub use locate::{locate_evidence_in_pdf, PdfEvidenceHit};
pub use merge::{
    build_command, parse_rscript, run_audit, run_dedupe, run_merge, wsl_path, AuditRequest,
    AuditVerdict, DedupeRequest, MergeOutput, MergeRequest, RscriptSpec,
};

use crate::error::AppError;
use serde::Serialize;
use std::path::{Component, Path, PathBuf};

pub const CONFIG_FILE: &str = "kb.config.yaml";
const MAX_PROPOSAL_BYTES: u64 = 8 * 1024 * 1024;
const MAX_FILE_BYTES: u64 = 16 * 1024 * 1024;

/// Directory names from `kb.config.yaml` → `paths:` (defaults match kb_init).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KbPaths {
    pub raw: String,
    pub wiki: String,
    pub proposals: String,
}

impl Default for KbPaths {
    fn default() -> Self {
        Self {
            raw: "raw".into(),
            wiki: "wiki".into(),
            proposals: "proposals".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct KbBase {
    /// Absolute knowledge-base root (the folder holding `kb.config.yaml`).
    pub dir: String,
    /// `name:` from the config, else the folder name.
    pub name: String,
    pub wiki_dir: String,
    pub raw_dir: String,
    pub proposals_dir: String,
    /// `R/kb_merge.R` exists in the base (bases created before the proposal
    /// channel need their `R/` refreshed from kb-template).
    pub has_merge: bool,
    /// `R/kb_audit.R` and `R/kb_dedupe.R` exist (domain profile, routing and
    /// spot checks from kb-template P3).
    pub has_domain: bool,
    pub pending: u32,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProposalFile {
    /// File stem (`p-YYYYMMDD-HHMMSS-xxxxxx`).
    pub id: String,
    /// Absolute path of the JSON file.
    pub path: String,
    /// Raw JSON text, unparsed.
    pub text: String,
    /// Modification time, ms since epoch (0 when unknown).
    pub modified_ms: f64,
}

/// Proposal state directory.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum ProposalState {
    Pending,
    Decided,
}

impl ProposalState {
    fn dir(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Decided => "decided",
        }
    }
}

/// Unquote a YAML plain / single / double quoted scalar (no escapes beyond `''`).
fn yaml_scalar(raw: &str) -> String {
    let v = raw.trim();
    // Drop a trailing comment on plain scalars.
    let v = if !v.starts_with(['"', '\'']) {
        v.split(" #").next().unwrap_or(v).trim()
    } else {
        v
    };
    if v.len() >= 2 {
        if let Some(inner) = v.strip_prefix('"').and_then(|s| s.strip_suffix('"')) {
            return inner.replace("\\\"", "\"").replace("\\\\", "\\");
        }
        if let Some(inner) = v.strip_prefix('\'').and_then(|s| s.strip_suffix('\'')) {
            return inner.replace("''", "'");
        }
    }
    v.to_string()
}

/// Top-level `name:` and the `paths:` block of `kb.config.yaml`.
///
/// Deliberately tiny: the config is written by kb_init with a fixed shape, and
/// pulling a YAML crate in for three keys is not worth it.
pub fn parse_config(text: &str) -> (Option<String>, KbPaths) {
    let mut name = None;
    let mut paths = KbPaths::default();
    let mut in_paths = false;
    for line in text.lines() {
        let line = line.trim_end_matches('\r');
        if line.trim().is_empty() || line.trim_start().starts_with('#') {
            continue;
        }
        let indented = line.starts_with([' ', '\t']);
        if !indented {
            in_paths = false;
            if let Some(v) = line.strip_prefix("name:") {
                let v = yaml_scalar(v);
                if !v.is_empty() {
                    name = Some(v);
                }
            } else if line.trim_end() == "paths:" {
                in_paths = true;
            }
            continue;
        }
        if !in_paths {
            continue;
        }
        let Some((k, v)) = line.trim().split_once(':') else {
            continue;
        };
        let v = yaml_scalar(v);
        if v.is_empty() {
            continue;
        }
        match k.trim() {
            "raw" => paths.raw = v,
            "wiki" => paths.wiki = v,
            "proposals" => paths.proposals = v,
            _ => {}
        }
    }
    (name, paths)
}

pub fn read_config(kb_dir: &Path) -> Result<(Option<String>, KbPaths), AppError> {
    let cfg = kb_dir.join(CONFIG_FILE);
    let text = std::fs::read_to_string(&cfg).map_err(|e| {
        AppError::domain(
            "kb_not_a_base",
            format!(
                "{} is not a knowledge base ({CONFIG_FILE}: {e})",
                kb_dir.display()
            ),
        )
    })?;
    Ok(parse_config(&text))
}

/// A config-supplied directory name must stay inside the base.
fn safe_rel(rel: &str) -> Result<PathBuf, AppError> {
    let p = Path::new(rel);
    if rel.trim().is_empty()
        || p.components()
            .any(|c| !matches!(c, Component::Normal(_) | Component::CurDir))
    {
        return Err(AppError::domain(
            "kb_path_escape",
            format!("path escapes the knowledge base: {rel}"),
        ));
    }
    Ok(p.to_path_buf())
}

pub fn is_proposal_id(id: &str) -> bool {
    // p-YYYYMMDD-HHMMSS-xxxxxx
    let b = id.as_bytes();
    b.len() == 24
        && id.starts_with("p-")
        && b[2..10].iter().all(u8::is_ascii_digit)
        && b[10] == b'-'
        && b[11..17].iter().all(u8::is_ascii_digit)
        && b[17] == b'-'
        && b[18..24]
            .iter()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(c))
}

fn check_id(id: &str) -> Result<(), AppError> {
    if is_proposal_id(id) {
        Ok(())
    } else {
        Err(AppError::domain(
            "kb_bad_proposal_id",
            format!("not a proposal id: {id}"),
        ))
    }
}

fn proposals_dir(
    kb_dir: &Path,
    paths: &KbPaths,
    state: ProposalState,
) -> Result<PathBuf, AppError> {
    Ok(kb_dir.join(safe_rel(&paths.proposals)?).join(state.dir()))
}

fn count_pending(dir: &Path) -> u32 {
    std::fs::read_dir(dir)
        .map(|it| {
            it.filter_map(Result::ok)
                .filter(|e| {
                    let name = e.file_name();
                    let name = name.to_string_lossy();
                    name.starts_with("p-") && name.ends_with(".json")
                })
                .count() as u32
        })
        .unwrap_or(0)
}

fn describe_base(dir: &Path) -> Option<KbBase> {
    let (name, paths) = read_config(dir).ok()?;
    let pending = proposals_dir(dir, &paths, ProposalState::Pending)
        .map(|d| count_pending(&d))
        .unwrap_or(0);
    let name = name.unwrap_or_else(|| {
        dir.file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| dir.display().to_string())
    });
    Some(KbBase {
        dir: dir.to_string_lossy().into_owned(),
        name,
        has_merge: dir.join("R").join("kb_merge.R").is_file(),
        has_domain: dir.join("R").join("kb_audit.R").is_file()
            && dir.join("R").join("kb_dedupe.R").is_file(),
        wiki_dir: paths.wiki,
        raw_dir: paths.raw,
        proposals_dir: paths.proposals,
        pending,
    })
}

/// Knowledge bases of a vault: the vault itself when it is a base, then every
/// `<vault>/kb/<topic>/` (the layout from kb-template/templates/agentero).
pub fn list_bases(vault: &Path) -> Vec<KbBase> {
    let mut out = Vec::new();
    if let Some(b) = describe_base(vault) {
        out.push(b);
    }
    let kb_root = vault.join("kb");
    if let Ok(entries) = std::fs::read_dir(&kb_root) {
        let mut dirs: Vec<PathBuf> = entries
            .filter_map(Result::ok)
            .map(|e| e.path())
            .filter(|p| p.is_dir() && p.join(CONFIG_FILE).is_file())
            .collect();
        dirs.sort();
        out.extend(dirs.iter().filter_map(|d| describe_base(d)));
    }
    out
}

/// Describe one base by its root (for bases outside the vault).
pub fn describe(kb_dir: &Path) -> Result<KbBase, AppError> {
    read_config(kb_dir)?;
    describe_base(kb_dir).ok_or_else(|| AppError::message("unreadable knowledge base"))
}

fn modified_ms(meta: &std::fs::Metadata) -> f64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0)
}

/// Proposal files in one state directory, oldest id first (ids sort by time).
/// `limit` keeps a long `decided/` history cheap: the newest `limit` are kept.
pub fn read_proposals(
    kb_dir: &Path,
    state: ProposalState,
    limit: Option<usize>,
) -> Result<Vec<ProposalFile>, AppError> {
    let (_, paths) = read_config(kb_dir)?;
    let dir = proposals_dir(kb_dir, &paths, state)?;
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Ok(Vec::new());
    };
    let mut files: Vec<(String, PathBuf)> = entries
        .filter_map(Result::ok)
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            let id = name.strip_suffix(".json")?.to_string();
            id.starts_with("p-").then(|| (id, e.path()))
        })
        .collect();
    files.sort();
    if let Some(n) = limit {
        if files.len() > n {
            files.drain(..files.len() - n);
        }
    }
    let mut out = Vec::with_capacity(files.len());
    for (id, path) in files {
        let Ok(meta) = std::fs::metadata(&path) else {
            continue;
        };
        if meta.len() > MAX_PROPOSAL_BYTES {
            continue;
        }
        let text = match std::fs::read_to_string(&path) {
            Ok(t) => t,
            Err(_) => continue,
        };
        out.push(ProposalFile {
            id,
            path: path.to_string_lossy().into_owned(),
            text,
            modified_ms: modified_ms(&meta),
        });
    }
    Ok(out)
}

/// Overwrite a pending proposal with reviewer-edited JSON.
///
/// The text must parse, keep its `id`, and stay `pending`; the merger detects
/// the edit through `patch_hash`, so nothing else is touched here. Written via
/// a sibling temp file + rename so the merger never reads a half-written file.
pub fn write_pending_proposal(kb_dir: &Path, id: &str, text: &str) -> Result<(), AppError> {
    check_id(id)?;
    let value: serde_json::Value = serde_json::from_str(text)?;
    let obj = value
        .as_object()
        .ok_or_else(|| AppError::domain("kb_bad_proposal", "proposal must be a JSON object"))?;
    if obj.get("id").and_then(|v| v.as_str()) != Some(id) {
        return Err(AppError::domain(
            "kb_bad_proposal",
            "the proposal id cannot be changed",
        ));
    }
    if obj.get("status").and_then(|v| v.as_str()) != Some("pending") {
        return Err(AppError::domain(
            "kb_bad_proposal",
            "only pending proposals can be edited",
        ));
    }
    let (_, paths) = read_config(kb_dir)?;
    let dir = proposals_dir(kb_dir, &paths, ProposalState::Pending)?;
    let target = dir.join(format!("{id}.json"));
    if !target.is_file() {
        return Err(AppError::domain(
            "kb_proposal_gone",
            format!("{id} is no longer pending (decided or superseded meanwhile)"),
        ));
    }
    let tmp = dir.join(format!(".{id}.json.tmp"));
    let mut body = text.to_string();
    if !body.ends_with('\n') {
        body.push('\n');
    }
    std::fs::write(&tmp, body)?;
    std::fs::rename(&tmp, &target).inspect_err(|_| {
        let _ = std::fs::remove_file(&tmp);
    })?;
    Ok(())
}

/// Read a base-relative text file (a proposal target, raw record or evidence
/// page). `None` when it does not exist — a `new_page` target, typically.
pub fn read_base_file(kb_dir: &Path, rel: &str) -> Result<Option<String>, AppError> {
    let path = kb_dir.join(safe_rel(rel)?);
    let meta = match std::fs::metadata(&path) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.into()),
    };
    if !meta.is_file() {
        return Ok(None);
    }
    if meta.len() > MAX_FILE_BYTES {
        return Err(AppError::domain(
            "kb_file_too_large",
            format!("{rel} is larger than {} MB", MAX_FILE_BYTES / 1024 / 1024),
        ));
    }
    Ok(Some(
        String::from_utf8_lossy(&std::fs::read(&path)?).into_owned(),
    ))
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceTarget {
    /// Raw record id the evidence cites.
    pub source: String,
    /// Paragraph number parsed from a `¶N` locator.
    pub paragraph: Option<u32>,
    /// Page number (1-based) parsed from a `p.N` / `page=N` locator.
    pub page: Option<u32>,
    /// Paragraph text from the evidence page (anchor suffix stripped).
    pub text: Option<String>,
    /// Absolute path of `<wiki>/evidence/evidence-<source>.md` when present.
    pub evidence_path: Option<String>,
    /// Absolute raw record path.
    pub raw_path: Option<String>,
    pub raw_title: Option<String>,
    /// Absolute path of the original PDF when the raw record has one.
    pub pdf_path: Option<String>,
    /// Located rect inside `pdf_path`.
    pub pdf_hit: Option<EvidenceRect>,
}

#[derive(Debug, Clone, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceRect {
    /// 0-based page index.
    pub page_index: u32,
    /// Normalized (0–1) bbox on that page.
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
    /// Which quote matched (debugging aid shown as a tooltip).
    pub matched: String,
}

fn check_source_id(source: &str) -> Result<(), AppError> {
    if source.is_empty()
        || source.len() > 300
        || source.contains(['/', '\\', '\0'])
        || source.starts_with('.')
    {
        return Err(AppError::domain(
            "kb_bad_source",
            format!("not a raw record id: {source}"),
        ));
    }
    Ok(())
}

/// `¶12` / `^p12` / `p12` → paragraph; `p.3` / `page=3` / `S.3` → page.
pub fn parse_locator(locator: &str) -> (Option<u32>, Option<u32>) {
    let l = locator.trim();
    let digits = |s: &str| -> Option<u32> {
        let d: String = s
            .trim_start_matches([' ', '.', '=', ':'])
            .chars()
            .take_while(char::is_ascii_digit)
            .collect();
        d.parse().ok()
    };
    if let Some(rest) = l.strip_prefix('¶') {
        return (digits(rest), None);
    }
    if let Some(rest) = l.strip_prefix("^p") {
        return (digits(rest), None);
    }
    let lower = l.to_lowercase();
    for pfx in ["page=", "page ", "pp.", "p.", "页"] {
        if let Some(rest) = lower.strip_prefix(pfx) {
            return (None, digits(rest));
        }
    }
    if let Some(rest) = lower.strip_prefix('p') {
        if rest.chars().next().is_some_and(|c| c.is_ascii_digit()) {
            return (digits(rest), None);
        }
    }
    (None, None)
}

/// Paragraph `n` of an evidence page: the block ending in ` ^p<n>`.
pub fn evidence_paragraph(page: &str, n: u32) -> Option<String> {
    let anchor = format!("^p{n}");
    let body = page.replace("\r\n", "\n");
    for para in body.split("\n\n") {
        let t = para.trim_end();
        if let Some(head) = t.strip_suffix(&anchor) {
            if head.is_empty() || head.ends_with([' ', '\n', '\t']) {
                let text = head.trim().to_string();
                return (!text.is_empty()).then_some(text);
            }
        }
    }
    None
}

/// Paragraph `n` straight from a raw record body, numbered exactly like
/// kb-template's `kb_number_paragraphs` / `kb_para_citable` (fallback for
/// bases whose evidence pages have not been generated yet).
pub fn raw_paragraph(raw_text: &str, n: u32) -> Option<String> {
    let body = crate::features::markdown::frontmatter::split_off_frontmatter(raw_text).1;
    let body = strip_inline_images(&body.replace("\r\n", "\n"));
    let paras: Vec<&str> = split_paragraphs(&body);
    if paras.len() < 3 {
        return None;
    }
    let mut num = 0u32;
    for p in paras {
        if !para_citable(p) {
            continue;
        }
        num += 1;
        if num == n {
            return Some(p.trim().to_string());
        }
    }
    None
}

/// R's `strsplit(body, "\n\n+")`.
fn split_paragraphs(body: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let mut rest = body;
    while let Some(i) = rest.find("\n\n") {
        out.push(&rest[..i]);
        rest = rest[i..].trim_start_matches('\n');
    }
    out.push(rest);
    out
}

/// kb_para_citable: not a heading, image line, table separator or blank.
fn para_citable(p: &str) -> bool {
    let heading = {
        let hashes = p.chars().take_while(|c| *c == '#').count();
        (1..=6).contains(&hashes) && p[hashes..].chars().next().is_some_and(char::is_whitespace)
    };
    let image = p.starts_with("![");
    let table_sep = p.starts_with('|')
        && p.len() > 2
        && p.lines().next().is_some_and(|first| {
            // ^\|[-| ]+\| : after the first '|', a run of '-', '|', ' '
            // holding a '|' that has at least one run character before it.
            first[1..]
                .chars()
                .take_while(|c| matches!(c, '-' | '|' | ' '))
                .skip(1)
                .any(|c| c == '|')
        });
    !(heading || image || table_sep || p.trim().is_empty())
}

/// kb_evidence's `.clean_body`: drop MinerU inline images `![..](images/..)`.
fn strip_inline_images(body: &str) -> String {
    let mut out = String::with_capacity(body.len());
    let mut rest = body;
    while let Some(i) = rest.find("![") {
        out.push_str(&rest[..i]);
        let tail = &rest[i..];
        let parsed = tail.find("](images/").and_then(|close| {
            // the alt text must not contain ']'
            if tail[2..close].contains(']') {
                return None;
            }
            tail[close..].find(')').map(|end| close + end + 1)
        });
        match parsed {
            Some(len) => rest = &tail[len..],
            None => {
                out.push_str("![");
                rest = &tail[2..];
            }
        }
    }
    out.push_str(rest);
    out
}

struct RawRecord {
    path: PathBuf,
    title: Option<String>,
    source_path: Option<String>,
    text: String,
}

/// Find the raw record whose frontmatter `id` is `source`. File names usually
/// equal the id, so that is tried first before scanning the whole raw tree.
fn find_raw(kb_dir: &Path, paths: &KbPaths, source: &str) -> Option<RawRecord> {
    let raw_dir = kb_dir.join(safe_rel(&paths.raw).ok()?);
    let read = |p: &Path| -> Option<RawRecord> {
        let text = std::fs::read_to_string(p).ok()?;
        let fm = crate::frontmatter::frontmatter_block(&text)?.to_string();
        let id = crate::frontmatter::scalar_field(&fm, "id")?;
        (id == source).then(|| RawRecord {
            path: p.to_path_buf(),
            title: crate::frontmatter::scalar_field(&fm, "title"),
            source_path: crate::frontmatter::scalar_field(&fm, "source_path"),
            text,
        })
    };
    let file_name = format!("{source}.md");
    let mut by_name = Vec::new();
    let mut others = Vec::new();
    for entry in walkdir::WalkDir::new(&raw_dir)
        .max_depth(6)
        .into_iter()
        .filter_map(Result::ok)
    {
        if !entry.file_type().is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy();
        if !name.ends_with(".md") {
            continue;
        }
        if name == file_name.as_str() {
            by_name.push(entry.into_path());
        } else {
            others.push(entry.into_path());
        }
    }
    by_name.iter().chain(others.iter()).find_map(|p| read(p))
}

/// Original PDF of a raw record: `source_path` when it is a PDF, the PDFs in
/// it when it is a folder, or a PDF next to it (MinerU output folders keep the
/// markdown beside the original).
fn resolve_pdf(kb_dir: &Path, source_path: &str) -> Option<PathBuf> {
    let sp = source_path.trim();
    if sp.is_empty() || sp.starts_with("http://") || sp.starts_with("https://") {
        return None;
    }
    let expanded = if let Some(rest) = sp.strip_prefix("~/") {
        dirs_home().map(|h| h.join(rest))?
    } else {
        PathBuf::from(sp)
    };
    let p = if expanded.is_absolute() {
        expanded
    } else {
        kb_dir.join(expanded)
    };
    let is_pdf =
        |p: &Path| p.extension().is_some_and(|e| e.eq_ignore_ascii_case("pdf")) && p.is_file();
    if is_pdf(&p) {
        return Some(p);
    }
    let first_pdf = |dir: &Path| -> Option<PathBuf> {
        let mut pdfs: Vec<PathBuf> = std::fs::read_dir(dir)
            .ok()?
            .filter_map(Result::ok)
            .map(|e| e.path())
            .filter(|p| is_pdf(p))
            .collect();
        pdfs.sort();
        pdfs.into_iter().next()
    };
    if p.is_dir() {
        return first_pdf(&p);
    }
    if p.is_file() {
        // A sibling PDF with the same stem first, then any PDF in the folder.
        if let (Some(dir), Some(stem)) = (p.parent(), p.file_stem()) {
            let same = dir.join(format!("{}.pdf", stem.to_string_lossy()));
            if is_pdf(&same) {
                return Some(same);
            }
            return first_pdf(dir);
        }
    }
    None
}

fn dirs_home() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

/// Resolve an evidence entry without touching the PDF engine. The caller adds
/// `pdf_hit` with [`locate_evidence_in_pdf`] on desktop.
pub fn resolve_evidence(
    kb_dir: &Path,
    source: &str,
    locator: Option<&str>,
    quote: Option<&str>,
) -> Result<EvidenceTarget, AppError> {
    check_source_id(source)?;
    let (_, paths) = read_config(kb_dir)?;
    let (paragraph, page) = locator.map(parse_locator).unwrap_or((None, None));

    let evidence_path = safe_rel(&paths.wiki)
        .ok()
        .map(|w| {
            kb_dir
                .join(w)
                .join("evidence")
                .join(format!("evidence-{source}.md"))
        })
        .filter(|p| p.is_file());
    let raw = find_raw(kb_dir, &paths, source);

    let mut text = quote
        .map(str::trim)
        .filter(|q| !q.is_empty())
        .map(String::from);
    if text.is_none() {
        if let Some(n) = paragraph {
            text = evidence_path
                .as_ref()
                .and_then(|p| std::fs::read_to_string(p).ok())
                .and_then(|page| evidence_paragraph(&page, n))
                .or_else(|| raw.as_ref().and_then(|r| raw_paragraph(&r.text, n)));
        }
    }
    let pdf_path = raw
        .as_ref()
        .and_then(|r| r.source_path.as_deref())
        .and_then(|sp| resolve_pdf(kb_dir, sp));

    Ok(EvidenceTarget {
        source: source.to_string(),
        paragraph,
        page,
        text,
        evidence_path: evidence_path.map(|p| p.to_string_lossy().into_owned()),
        raw_path: raw.as_ref().map(|r| r.path.to_string_lossy().into_owned()),
        raw_title: raw.and_then(|r| r.title),
        pdf_path: pdf_path.map(|p| p.to_string_lossy().into_owned()),
        pdf_hit: None,
    })
}

/// Strip Markdown / LaTeX decoration so a paragraph can be searched in the
/// PDF text layer, then cut search quotes from its start and end.
pub fn quote_candidates(paragraph: &str) -> Vec<String> {
    let plain = plain_text(paragraph);
    let chars: Vec<char> = plain.chars().collect();
    let take = |from: usize, n: usize| -> String {
        chars[from.min(chars.len())..(from + n).min(chars.len())]
            .iter()
            .collect::<String>()
            .trim()
            .to_string()
    };
    let mut out = Vec::new();
    let mut push = |s: String| {
        if s.chars().filter(|c| !c.is_whitespace()).count() >= 12 && !out.contains(&s) {
            out.push(s);
        }
    };
    // Whole short paragraphs first; long ones by their head, then shorter heads.
    if chars.len() <= 160 {
        push(plain.trim().to_string());
    }
    push(take(0, 120));
    push(take(0, 60));
    push(take(0, 30));
    // A head can start with a symbol the PDF renders differently; try the middle.
    if chars.len() > 80 {
        push(take(chars.len() / 2 - 20, 40));
    }
    out
}

/// Trailing quote of a paragraph (to extend the highlight to its last line).
pub fn tail_quote(paragraph: &str) -> Option<String> {
    let plain = plain_text(paragraph);
    let chars: Vec<char> = plain.chars().collect();
    if chars.len() <= 160 {
        return None;
    }
    let tail: String = chars[chars.len() - 50..].iter().collect();
    let tail = tail.trim().to_string();
    (tail.chars().filter(|c| !c.is_whitespace()).count() >= 12).then_some(tail)
}

fn plain_text(md: &str) -> String {
    let mut s = String::with_capacity(md.len());
    let mut chars = md.chars().peekable();
    let mut in_math = false;
    while let Some(c) = chars.next() {
        match c {
            '$' => {
                // Inline/display math rarely survives PDF text extraction verbatim.
                if chars.peek() == Some(&'$') {
                    chars.next();
                }
                in_math = !in_math;
                s.push(' ');
            }
            _ if in_math => {}
            '*' | '_' | '`' | '~' => {}
            '[' => {
                // [[target|label]] → label ; [label](url) → label ; [12] stays
                if chars.peek() == Some(&'[') {
                    chars.next();
                    let mut inner = String::new();
                    for d in chars.by_ref() {
                        if d == ']' {
                            break;
                        }
                        inner.push(d);
                    }
                    if chars.peek() == Some(&']') {
                        chars.next();
                    }
                    let label = inner.rsplit('|').next().unwrap_or("");
                    s.push_str(label);
                } else {
                    s.push('[');
                }
            }
            ']' if chars.peek() == Some(&'(') => {
                // drop "(url)" after a link label (the '[' was kept above)
                chars.next();
                for d in chars.by_ref() {
                    if d == ')' {
                        break;
                    }
                }
                if let Some(open) = s.rfind('[') {
                    s.remove(open);
                }
            }
            '<' => {
                // drop inline HTML tags
                let mut tag = String::new();
                let mut closed = false;
                for d in chars.by_ref() {
                    if d == '>' {
                        closed = true;
                        break;
                    }
                    tag.push(d);
                }
                if !closed {
                    s.push('<');
                    s.push_str(&tag);
                }
            }
            '\n' | '\t' => s.push(' '),
            _ => s.push(c),
        }
    }
    // Leading list / quote markers and repeated spaces.
    let collapsed = s.split_whitespace().collect::<Vec<_>>().join(" ");
    collapsed
        .trim_start_matches(['>', '-', '+', ' '])
        .trim()
        .to_string()
}

#[cfg(test)]
mod tests;
