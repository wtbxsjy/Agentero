//! `paper_coolpapers_notes` — papers.cool Kimi analysis into NOTES.md.

use crate::app::command_util::try_vault_ok;
use crate::core::error::ApiResult;
use crate::core::log_util::{trunc, OpTimer};
use serde::Deserialize;

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CoolPapersNotesArgs {
    pub vault_path: String,
    /// Vault-relative paper folder.
    pub path: String,
    /// Catalog id. Venue imports store the Cool Papers row id (`38818@AAAI`).
    #[serde(default)]
    pub catalog_id: Option<String>,
    /// Catalog `source_url`; papers.cool links resolve without a search.
    #[serde(default)]
    pub source_url: Option<String>,
    /// Preferred resolver for arXiv rows; used after catalog id / source url.
    #[serde(default)]
    pub arxiv_id: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
}

/// Append the papers.cool Kimi analysis for one paper to its NOTES.md.
///
/// Resolves by Cool Papers URL / venue catalog id, then arXiv id, then title.
/// A paper that cannot be resolved returns `found: false` and writes nothing.
#[tauri::command]
#[specta::specta]
pub async fn paper_coolpapers_notes(
    args: CoolPapersNotesArgs,
) -> Result<ApiResult<super::CoolPapersNotes>, String> {
    let op = OpTimer::start_with(
        "paper_coolpapers_notes",
        format!(
            "path={} id={} arxiv={}",
            trunc(&args.path, 120),
            args.catalog_id.as_deref().unwrap_or("-"),
            args.arxiv_id.as_deref().unwrap_or("-")
        ),
    );
    let vault = try_vault_ok!(&args.vault_path, op);
    let result = super::fetch_notes(super::FetchNotesRequest {
        vault: &vault,
        paper_rel: &args.path,
        catalog_id: args.catalog_id.as_deref(),
        source_url: args.source_url.as_deref(),
        arxiv_id: args.arxiv_id.as_deref(),
        title: args.title.as_deref(),
    })
    .await;
    Ok(op.finish_result(result))
}
