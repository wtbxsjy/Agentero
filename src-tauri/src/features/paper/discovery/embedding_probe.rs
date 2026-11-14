//! Liveness probe for the user's embedding endpoint (Settings → Agent).
//!
//! The endpoint itself backs semantic features such as citing-paper ranking.

use crate::core::error::{map_err, ApiResult, AppError};
use crate::core::http;
use crate::features::paper::discovery::embeddings;
use crate::features::system::settings::AppSettingsStore;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::{AppHandle, Manager};

/// Shorter than a real embed because the probe only needs the response shape.
const PROBE_TIMEOUT: Duration = Duration::from_secs(15);

/// Marker error the UI turns into "configure an embedding model first".
pub const ERR_NO_EMBEDDING: &str = "recommend.no_embedding";
/// Marker error the UI turns into "embedding endpoint is unreachable".
pub const ERR_PROBE_FAILED: &str = "recommend.probe_failed";

/// Single token sent for a liveness probe — cheap, and any real embedding
/// provider must accept an input of this length.
const PROBE_INPUT: &str = "hi";

#[derive(Debug, Clone, Serialize, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProbeEmbeddingResult {
    /// Dimensionality reported by the embedding endpoint for the probe input.
    pub dim: usize,
    /// Wall-clock latency of the probe request in milliseconds.
    pub latency_ms: u64,
}

#[derive(Debug, Default, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ProbeEmbeddingArgs {
    /// Override the stored base URL. Empty / missing keeps the stored value.
    #[serde(default)]
    pub base_url: Option<String>,
    /// Override the stored API key. Empty / missing keeps the stored value.
    /// The Host's `*` mask is also treated as "use the stored secret".
    #[serde(default)]
    pub api_key: Option<String>,
    /// Override the stored model. Empty / missing keeps the stored value.
    #[serde(default)]
    pub model: Option<String>,
}

/// Liveness probe: POST one tiny input, confirm the endpoint actually serves
/// `/embeddings`, and report the returned dimensionality + latency.
///
/// Returns `AppError::message(ERR_PROBE_FAILED)` for any failure so the
/// settings pane can show the endpoint as unreachable.
pub async fn probe_embedding_endpoint(
    base_url: &str,
    api_key: Option<&str>,
    model: &str,
) -> Result<ProbeEmbeddingResult, AppError> {
    let endpoint = embeddings::resolve_endpoint(base_url);
    if endpoint.is_empty() {
        return Err(AppError::message(format!(
            "{ERR_PROBE_FAILED}: empty base URL"
        )));
    }
    let client = http::client_builder()
        .timeout(PROBE_TIMEOUT)
        .build()
        .map_err(|e| AppError::message(format!("{ERR_PROBE_FAILED}: {e}")))?;
    let inputs = [PROBE_INPUT.to_string()];
    let started = std::time::Instant::now();
    let vectors = embeddings::embed_batch(&client, &endpoint, api_key, model, &inputs)
        .await
        .map_err(|e| AppError::message(format!("{ERR_PROBE_FAILED}: {e}")))?;
    let dim = vectors.first().map(Vec::len).unwrap_or(0);
    if dim == 0 {
        return Err(AppError::message(format!(
            "{ERR_PROBE_FAILED}: response has no embedding"
        )));
    }
    Ok(ProbeEmbeddingResult {
        dim,
        latency_ms: started.elapsed().as_millis() as u64,
    })
}

/// Liveness check for the user's configured embedding endpoint.
///
/// Reads the stored embedding config; the optional args let the caller
/// (typically the Agent settings pane) probe a draft that has not been
/// committed yet. Returns `ERR_NO_EMBEDDING` when nothing is configured so
/// the UI can route the user to the settings page.
#[tauri::command]
#[specta::specta]
pub async fn probe_embedding(
    app: AppHandle,
    args: ProbeEmbeddingArgs,
) -> ApiResult<ProbeEmbeddingResult> {
    // Read managed state before awaiting: the guard must not cross an await.
    let settings = app.state::<AppSettingsStore>();
    let uses_builtin = settings.embedding_is_builtin();
    let stored = settings.embedding_config();
    let (base_url, api_key, model) = match stored {
        Some(triple) => triple,
        None => return ApiResult::err(AppError::message(ERR_NO_EMBEDDING)),
    };
    // The built-in key is shared, not the caller's, so an override would let
    // any webview redirect it to an arbitrary host.
    let (resolved_base, resolved_key, resolved_model) = if uses_builtin {
        (base_url, api_key, model)
    } else {
        let override_base = args
            .base_url
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty());
        let override_key = args
            .api_key
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty() && !s.chars().all(|c| c == '*'));
        let override_model = args
            .model
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty());
        (
            override_base.unwrap_or(&base_url).to_string(),
            override_key.map(|s| s.to_string()).or(api_key),
            override_model.unwrap_or(&model).to_string(),
        )
    };
    if resolved_base.trim().is_empty() || resolved_model.trim().is_empty() {
        return ApiResult::err(AppError::message(ERR_NO_EMBEDDING));
    }
    match probe_embedding_endpoint(&resolved_base, resolved_key.as_deref(), &resolved_model).await {
        Ok(result) => ApiResult::ok(result),
        Err(e) => map_err(e),
    }
}
