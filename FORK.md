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
- **Plugin host** (hidden upstream by `pluginsSurfaceEnabled`): the `agentero-plugin-host` crate
  and its QuickJS worker sidecar (`externalBin`, `plugin-worker:stage` scripts, CI staging),
  `integration/plugins` with the `plugin_*` commands and `plugins:*` events, `src/lib/plugins/`,
  Settings → Plugins and the dev-plugin palette commands. Extensions go through skills + MCP.
- **Account / sign-in** (hidden upstream by `accountSurfaceEnabled`): `tauri-plugin-better-auth`
  and the better-auth JS packages, `app/account.rs`, `src/features/account/`, Settings → Account,
  the `account` i18n namespace and the Better Auth UI attribution in `THIRD_PARTY.md`. The app
  has no sign-in; model providers are configured with local keys.

Still open after step 2:

- The `agentero://` deep-link scheme is shared with the official app and is hard-coded in Rust
  and TS. After the account removal only the CLI `open` / `ui` hand-off uses it.
- Settings → About still points at upstream: "Install CLI" downloads the official
  `agentero-cli` archive for the same version from `poco-ai/Agentero` releases, and the GitHub
  star link and Homebrew hint name the upstream repo and tap.

## KB panel

`src/features/kb/` holds the knowledge rail (kb-rag HTTP client, source kinds, own zh/en
strings), wired in from `src/components/shell/right-sidebar.tsx`. Tests: `test/kb-sources.test.ts`.

## Review inbox (P2)

The HITL core: kb-template's pipeline (`kb_compile.R`, `kb_link.R`) writes every wiki change as a
proposal JSON in `<kb>/proposals/pending/` (contract `schema/proposal.schema.json`), and
`R/kb_merge.R` is the only writer of `wiki/`. The inbox is the desktop front end of that contract.

- **Where**: a center tab (virtual path `agentero:kb-review`, kind `kb-review`) with the list on
  the left and the detail on the right, plus an "Inbox" tab next to search in the KB rail that
  shows what is waiting and opens the center tab. Front end in `src/features/kb/review/`.
- **Plan cards**: proposals are grouped by pipeline run (same `created_by.tool` + `pass`, created
  within 10 minutes of each other). Each card summarizes kinds, risk and sources, can be ticked as a
  whole, and offers "accept all low-risk" (skipping proposals already known to be stale).
- **Diff**: field-by-field frontmatter comparison plus a side-by-side body diff (Myers, with
  word / CJK-character highlights and folded context), computed in the webview. A second view
  shows `kb_merge.R --show`, the merger's exact output.
- **Evidence**: each `{source, locator}` resolves (Rust) to the paragraph text from
  `<wiki>/evidence/evidence-<id>.md` (or the raw body, numbered like `kb_number_paragraphs`), then
  to the raw record's `source_path` PDF, where the PDFium text locator finds the paragraph. Clicking
  opens the paper / PDF tab and flashes the paragraph rect; without a PDF it falls back to the
  evidence page block anchor `#^pN`.
- **Decisions**: accept, reject (with a preset or free-text reason) and edit (the patch is
  rewritten in the pending JSON; the merger records it as `edited` and marks the page
  `human_edited`). All decisions run `Rscript R/kb_merge.R` inside the base, so base-hash checks,
  raw status write-back and one-commit-per-decision stay in one place. "Close stale" runs
  `--check`. Freshness (`--list --json`) marks proposals whose target changed.
- **Keys** (center tab): `j`/`k` move, `x` select, `Shift+A` select all, `a` accept, `e` edit, `r`
  reject, `1`–`9` open evidence N, `o` open the target page, `Esc` clear / leave edit.
- **Settings** (per machine, localStorage): Rscript path (default `Rscript` on PATH; on Windows the
  newest `C:\Program Files\R\R-*\bin\Rscript.exe`), reviewer name for `--by`.
- **Rust**: `crates/agentero-core/src/features/kb/` (config parsing, proposal IO, evidence
  resolution, the `kb_merge.R` runner with a fixed action set) and the `kb_*` commands in
  `src-tauri/src/features/kb/commands.rs`.
- **Needs**: R with kb-template's packages, and either the kb-template folder setting (P4) or a
  base whose `R/` has the proposal channel. Without either the inbox is read-only.
- Tests: `test/kb-review.test.ts`, `cargo test -p agentero-core features::kb`.

## Domain profile and routing (P3)

kb-template P3 adds `<kb>/domain/profile.yaml` (entity types, required fields, vocabularies,
reject reasons, routing and audit settings) and `domain/aliases.yaml`. The inbox follows it:

- **Routing**: `kb_merge.R --list --json` carries a route preview per proposal. Rows that would
  auto-merge (links only, format only, alias-table merges) get a chip, a route filter, and the
  toolbar's "Auto-route" button runs `kb_merge.R --route`. The rest stay with the reason why.
- **Reject reasons**: the dialog offers the profile's categories (`--reasons --json`; digits
  1–9 pick one) and sends `--reason-code` / `--duplicate-of`; `kb_feedback.R` turns them into
  compile-prompt notes and alias suggestions.
- **merge_entity**: the detail shows the pages folded in and the aliases registered; accepting
  turns the folded pages into redirect stubs (`redirect_to`) in one commit, without rewriting
  links elsewhere (kb_merge.R).
- **Concurrency**: write runs (accept, reject, route, audit marks, merge proposals) are
  serialized per base in Rust; kb-template's `proposals/.lock` covers other processes, and a
  busy merger surfaces as its "合并器忙" error.
- **Spot checks** view (`kb_audit.R`): sample auto-merges per rule, read the merge commit, mark
  it ok or wrong (optionally reverting it back into the inbox), per-rule error rate with a
  Wilson upper bound against the 5% target; rules over target are disabled automatically, and
  a rule with too many unaudited auto-merges (`audit.max_unaudited`) is paused until checked.
- **Duplicates** view (`kb_dedupe.R`): scan candidates, or name two pages, and write a
  `merge_entity` proposal into the inbox.
- **WSL**: the Rscript setting accepts `wsl`, `wsl:<distro>` or `wsl:<distro>:<Rscript path>`;
  the base path is translated (`C:\…` → `/mnt/c/…`, `\\wsl$\<distro>\…` → `/…`).
- Front end: `src/features/kb/review/` (`domain-store.ts`, `audit-view.tsx`, `dedupe-view.tsx`); Rust:
  `kb_audit` / `kb_dedupe` commands. Without `R/kb_audit.R` the two views say so.

## Q&A, compile plan and shared scripts (P4)

kb-template P4 moves retrieval to Python only (`mcp/kbretrieve.py`, multi-hop along wikilinks)
and stops copying scripts into every base. The desktop side:

- **Q&A tab** in the KB rail (`src/features/kb/qa/qa-panel.tsx`): `POST /ask` on the kb-rag
  HTTP service with the base's absolute root (works without a vector index), retrieval level
  (keyword / hybrid / multi-hop) and hops. `[n]` markers in the answer and the citation list
  open the wiki page; evidence chips use the inbox's evidence jump. The retrieval trace lists the
  pages reached and how (seed, link, wikilink, backlink). kb-rag only accepts `/ask` from the
  webview or loopback pages (it calls the model).
- **Save as proposal**: the answer's `draft` goes to `kb_merge.R --submit` (`MergeRequest::submit`,
  draft written to `<proposals>/.submit-<uuid>.json` and removed afterwards); the merger computes
  id, hashes and risk, and P3 routing applies. The proposal records `prompt_hash` / `profile_hash`.
- **Compile plan card** (inbox rail → "Compile…", `qa/compile-plan.tsx`): `kb_compile.R --dry-run
  --json` lists the queue with rough token estimates and the per-run budget; ticked sources run
  with `--ids` (`kb_compile` command, holds the base write lock).
- **kb-template folder** setting (inbox settings): scripts run from `<kb-template>/R/` with
  `KB_TEMPLATE` set; without it, from the base's `R/` (forwarders from `kb_init --scripts shared`,
  or old full copies). `KbBase.sharedScripts` / `templateDir` report what the base has. Under a
  WSL Rscript a Linux path is used as is, a Windows path is translated.
- **Wiki writes by agents**: in auto permission mode, a tool call that may write (anything but
  read / search / fetch / think) with a location inside a base's wiki directory is still sent to
  the user (`kb_wiki_writes` in `src-tauri/src/features/agent/acp/interaction.rs`), and the prompt
  shows a warning (`KbWikiWriteWarning`). Restricted mode still denies; ask mode still asks.
- Tests: `test/kb-qa.test.ts`, `cargo test -p agentero-core features::kb`, `kb_wiki_tests` in
  the agentero crate.

## Design constraints

- Retrieval needs no Tauri commands: the search panel calls kb-rag's loopback HTTP mode
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
