//! `kb_*` commands for the review inbox (`src/features/kb/review`).
//!
//! All file work runs on the blocking pool; `kb_merge` awaits the R process.
//! Paths are absolute knowledge-base roots chosen from `kb_list_bases`.

use crate::core::blocking::run_blocking;
use crate::core::error::{map_err, ApiResult, AppError};
use agentero_core::features::kb::{
    self, EvidenceTarget, KbBase, MergeOutput, MergeRequest, ProposalFile, ProposalState,
};
use std::path::PathBuf;

fn base_dir(kb_dir: &str) -> Result<PathBuf, AppError> {
    let p = PathBuf::from(kb_dir.trim());
    if !p.is_absolute() || !p.is_dir() {
        return Err(AppError::domain(
            "kb_not_a_base",
            format!("knowledge base folder not found: {kb_dir}"),
        ));
    }
    Ok(p)
}

fn wrap<T: serde::Serialize>(r: Result<T, AppError>) -> ApiResult<T> {
    match r {
        Ok(v) => ApiResult::ok(v),
        Err(e) => map_err(e),
    }
}

/// Knowledge bases of the open vault (`<vault>/kb/<topic>/kb.config.yaml`).
#[tauri::command]
#[specta::specta]
pub async fn kb_list_bases(vault_path: String) -> ApiResult<Vec<KbBase>> {
    run_blocking(move || {
        let vault = PathBuf::from(vault_path);
        if !vault.is_dir() {
            return ApiResult::ok(Vec::new());
        }
        ApiResult::ok(kb::list_bases(&vault))
    })
    .await
}

/// One knowledge base by root (for a base outside the vault).
#[tauri::command]
#[specta::specta]
pub async fn kb_describe_base(kb_dir: String) -> ApiResult<KbBase> {
    run_blocking(move || wrap(base_dir(&kb_dir).and_then(|d| kb::describe(&d)))).await
}

/// Proposal JSON files, verbatim. `limit` keeps the newest N (for `decided`).
#[tauri::command]
#[specta::specta]
pub async fn kb_read_proposals(
    kb_dir: String,
    state: ProposalState,
    limit: Option<u32>,
) -> ApiResult<Vec<ProposalFile>> {
    run_blocking(move || {
        wrap(
            base_dir(&kb_dir)
                .and_then(|d| kb::read_proposals(&d, state, limit.map(|n| n as usize))),
        )
    })
    .await
}

/// Save a reviewer-edited pending proposal (accepted later as `edited`).
#[tauri::command]
#[specta::specta]
pub async fn kb_write_proposal(kb_dir: String, id: String, text: String) -> ApiResult<bool> {
    run_blocking(move || {
        wrap(
            base_dir(&kb_dir)
                .and_then(|d| kb::write_pending_proposal(&d, &id, &text))
                .map(|()| true),
        )
    })
    .await
}

/// Read a base-relative text file; `null` when it does not exist.
#[tauri::command]
#[specta::specta]
pub async fn kb_read_file(kb_dir: String, rel: String) -> ApiResult<Option<String>> {
    run_blocking(move || wrap(base_dir(&kb_dir).and_then(|d| kb::read_base_file(&d, &rel)))).await
}

/// Run `R/kb_merge.R` (list / show / accept / reject / check) in the base.
#[tauri::command]
#[specta::specta]
pub async fn kb_merge(
    kb_dir: String,
    rscript: Option<String>,
    by: Option<String>,
    request: MergeRequest,
) -> ApiResult<MergeOutput> {
    let dir = match base_dir(&kb_dir) {
        Ok(d) => d,
        Err(e) => return map_err(e),
    };
    wrap(kb::run_merge(&dir, rscript.as_deref(), by.as_deref(), &request).await)
}

/// Evidence entry → paragraph text, raw record, original PDF and the rect of
/// that paragraph in the PDF (desktop PDFium).
#[tauri::command]
#[specta::specta]
pub async fn kb_resolve_evidence(
    kb_dir: String,
    source: String,
    locator: Option<String>,
    quote: Option<String>,
) -> ApiResult<EvidenceTarget> {
    run_blocking(move || {
        let dir = match base_dir(&kb_dir) {
            Ok(d) => d,
            Err(e) => return map_err(e),
        };
        #[allow(unused_mut)]
        let mut target =
            match kb::resolve_evidence(&dir, &source, locator.as_deref(), quote.as_deref()) {
                Ok(t) => t,
                Err(e) => return map_err(e),
            };
        #[cfg(not(any(target_os = "ios", target_os = "android")))]
        if let (Some(pdf), Some(text)) = (target.pdf_path.as_deref(), target.text.as_deref()) {
            target.pdf_hit =
                kb::locate_evidence_in_pdf(std::path::Path::new(pdf), text, target.page);
        }
        ApiResult::ok(target)
    })
    .await
}
