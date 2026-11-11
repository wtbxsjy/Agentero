# KB integration patch set

This fork carries a small, isolated integration with
[kb-template](https://github.com/wtbxsjy/kb-template) (compiled wiki + kb-rag retrieval).
`main` mirrors upstream `poco-ai/agentero`; the integration lives on its own branch and is
rebased onto `main` after each upstream pull.

```bash
git remote add upstream https://github.com/poco-ai/agentero   # once
git fetch upstream && git checkout main && git merge --ff-only upstream/main
git checkout <kb-branch> && git rebase main
pnpm typecheck && pnpm deps:check && npx vitest run test/kb-sources.test.ts
```

## New files (no upstream conflicts possible)

| Path | Role |
|---|---|
| `src/features/kb/` | Knowledge rail panel, kb-rag HTTP client, source kinds, own zh/en strings |
| `test/kb-sources.test.ts` | Vault-path mapping and source classification |
| `KB_PATCHES.md` | This file |

## Upstream touch points (check these on every rebase)

| File | Change |
|---|---|
| `src/components/shell/right-sidebar.tsx` | Import from `@/features/kb`; wrap the rail in a column with `KbRailSwitch`; hide the Agent panel and render `KbPanel` when the rail view is `kb` |

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
