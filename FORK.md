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

P0 removed modules in two steps. Step 1 hid them at their UI entry points with compile-time
switches in `src/lib/surfaces.ts`. Step 2 deleted them one module per commit (front-end
directories, Rust commands, `bindings.ts` types, settings, i18n). Step 2 is complete and
`surfaces.ts` is gone.

Deleted in step 2:

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
- **Mobile pairing and the mobile apps** (switch removed): the desktop Bridge host and relay,
  Settings → Remote access, the iOS/Android client shell (`src/components/mobile/`,
  `src/lib/bridge/`, `mobile` i18n), the `src-tauri/gen/apple` and `gen/android` projects and
  their configs, the iOS TestFlight workflow and scripts, and the Android CI/release jobs. The
  mobile clients only worked through pairing, so they went with it. `isMobileApp()` and the
  `cfg(target_os = "ios" | "android")` gates are left in place; they are inert on desktop.
- **Remote vaults** (switch removed): SSH/SFTP vaults (`integration/remote/`, core `remote.rs`,
  the `remote_*` and `remote_agent_*` commands, the openssh dependency), the remote branches in
  import, trash, Zotero, jobs and the Connector, the "Open remote" dialog and recent remotes, the
  remote Agent settings pane (scan, probe and install over SSH), and the `remote:<sessionId>`
  pseudo-path handling across the front end. Kept so upstream agent fixes still cherry-pick: the
  `RemoteAgentHosts` / `RemoteAgentLaunch` traits, now backed by an empty `NoRemoteHosts`, the
  core `VaultFs` abstraction, and the `agentero-delegate` code. The delegate hub is no longer
  started, so ACP sessions do not get the delegate tools.
- **Zhihu** (switch removed): the built-in Zhihu agent (core `features::zhihu`, the desktop
  adapter and `zhihu_*` commands, the `zhihuAccessSecret` setting, Settings → Agent row, the
  empty-state Zhihu discussions) and the "Ask on Zhihu" paper chip. With it went the whole
  built-in / chat-only agent path (`is_builtin_template`, `isChatOnlyAgentTemplate` and the
  public paper-metadata block it sent instead of file paths). Saved registries drop the
  `builtin-zhihu` row on load through `REMOVED_TEMPLATE_IDS`.
- **Word citations** (switch removed): the Microsoft Word plugin prototype (`integration/word/`
  with its macOS/Windows drivers, the `word_*` commands and `word:changed` event, the Connector's
  `/integration/macWordCommand` route, the citation dialog and the Settings → Connector toggle) and
  the `hayagriva` CSL dependency it alone used.
- **In-app updater** (switch removed): `tauri-plugin-updater` / `tauri-plugin-process` and their
  JS packages and capabilities, the updater endpoint and public key in `tauri.conf.json`,
  `app_update_check`, `src/lib/update/`, the title-bar update tag, the About pane check/install
  button, the startup update toast and the post-update CLI resync, plus the release workflow's
  signing check, updater JSON upload and `rewrite-updater-json` job. New versions come from a
  rebuild.

Already hidden upstream: plugins (`src/lib/plugins/visibility.ts`) and account / cloud writing
(`src/features/account/visibility.ts`).

Still open after step 2:

- The `agentero://` deep-link scheme is shared with the official app and is hard-coded in Rust
  and TS; change it together with the account code that uses it.
- Settings → About still points at upstream: "Install CLI" downloads the official
  `agentero-cli` archive for the same version from `poco-ai/Agentero` releases, and the GitHub
  star link and Homebrew hint name the upstream repo and tap.

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
