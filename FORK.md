# Agentero KB: fork notes

This repository is a hard fork of [poco-ai/agentero](https://github.com/poco-ai/agentero) (MIT),
being turned into a dedicated domain wiki / knowledge-base builder on top of
[kb-template](https://github.com/wtbxsjy/kb-template). We no longer merge `upstream/main`;
fixes to the modules we keep (PDF reader, Markdown editor, ACP agent panel, library/import,
MCP/CLI) are cherry-picked by hand.

## Build

```bash
pnpm install
pnpm tauri build
```

`src-tauri/tauri.conf.json` carries the fork identity directly: product name `Agentero KB`,
identifier `com.wtbxsjy.agentero.kb` (installs beside the official app; same identifier the old
`tauri.kb.conf.json` overlay used, so existing settings carry over), and no updater artifacts.

## Dropped modules (P0)

P0 removes modules in two steps. Step 1 hides them at their UI entry points with the
compile-time switches in `src/lib/surfaces.ts`. Step 2 deletes them one module per PR (front-end
directories, Rust commands, `bindings.ts` types, settings, i18n).

| Switch | Module | Step 1 entry points hidden |
|---|---|---|
| `zhihu` | Zhihu agent and paper action | Settings → Agent row, paper info "Zhihu" chip |
| `remoteVault` | SSH/SFTP vaults | Welcome button, recent remotes, vault switcher entry |
| `remoteAccess` | Mobile pairing | Settings → Remote access |
| `wordCitation` | Word add-in citations | Citation dialog not mounted |
| `updater` | In-app updater (points at official releases) | Update check reports unsupported |

Deleted in step 2 so far:

- **Writing / TeX** (switch removed): writing desk and cloud writing, TeX projects, LaTeX compile
  and SyncTeX, realtime-tex live preview (`rtex-core` dependency and `src-tauri/rtex/` resources),
  the `latexCompile` job kind, and their i18n namespaces. `.tex` / `.bib` files still open in the
  plain text editor with syntax highlighting.
- **Plaza** (switch removed): the Plaza sidebar node and tabs, Cool Papers / ModelScope / Papers
  with Code / Skill browsing, arXiv Daily recommendations, RSS/Atom feeds (desktop commands, core
  `feeds.sqlite` store, `agentero feed` CLI and `feed.*` ops), CCF deadlines, Plaza `@` mentions and
  the full-text scratch cache, and the `plazaEnabled` / `plazaHiddenSources` settings. Kept because
  other modules use them: `discover.arxiv` (MCP/CLI search), Papers with Code metadata enrichment,
  Cool Papers notes fetch, the arXiv proxy, and the embedding endpoint probe in Settings (moved to
  `discovery/embedding_probe.rs`). The catalog tables `embed_cache` / `discovery_runs` stay in the
  schema history but are no longer written.
- **Research tables / experiment notes** (switch removed): the `*.table.json` grid viewer and
  `::research-table` embeds, "New table" / "New experiment" and the `/` command, the core
  `research_table` module, MCP `table_query` / `table_upsert` / `table_update_cells`, the
  `agentero table` CLI, the `use_table_ops` / `experiment_locked` write guards, table hits in
  `vault_search`, and table-path rewriting in wiki renames. Existing `*.table.json` files now open
  as plain JSON.
- **Cloud sync** (switch removed): S3/R2, WebDAV and Git sync (core `features::sync`, the desktop
  scheduler and commands, `agentero sync` CLI, Settings → Sync, account cloud usage), the
  per-vault "don't download sources" sync scope (arXiv sources now always download), and the
  hiding of mirrored sync-store files (`blobs/`, `manifests/`, `HEAD`, `vault.json`) at the vault
  root.

Already hidden upstream: plugins (`src/lib/plugins/visibility.ts`) and account / cloud writing
(`src/features/account/visibility.ts`). The mobile app only ships in iOS builds.

Still open for step 2: the `agentero://` deep-link scheme is shared with the official app and is
hard-coded in Rust and TS; change it together with the pairing/account code that uses it.

## KB panel

`src/features/kb/` holds the knowledge rail (kb-rag HTTP client, source kinds, own zh/en
strings), wired in from `src/components/shell/right-sidebar.tsx`. Tests: `test/kb-sources.test.ts`.

## Design constraints

- No Tauri commands, no `bindings.ts` changes: the panel calls kb-rag's loopback HTTP mode
  (`kb-template/mcp/run.sh --http 127.0.0.1:8766`) with `fetch`. Agentero's CSP is `null`, so the
  webview can reach loopback. If upstream ever sets a CSP, add `http://127.0.0.1:*` to `connect-src`.
- Strings live in `src/features/kb/i18n.ts`, not `src/i18n/locales/`, so locale edits upstream never conflict.
- Rail view state is a separate store (`src/features/kb/store.ts`); upstream `RightSidebarTab` is untouched.
- Hits open through the public `openCitation(vaultRelPath)` action.

## Source kinds

| Kind | Vault location | Color |
|---|---|---|
| Paper | `papers/` | blue |
| Raw | `kb/<topic>/raw/` | grey |
| Wiki | `kb/<topic>/wiki_<name>/` | green |
| Evidence | `kb/<topic>/wiki_<name>/evidence/` | amber |
