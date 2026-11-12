/**
 * Source kinds shown across the KB surface. One color + icon per kind so a
 * hit, a tree row or a citation chip reads the same everywhere.
 */

export type SourceKind = "paper" | "raw" | "wiki" | "evidence" | "other";

export const SOURCE_KINDS: readonly SourceKind[] = [
	"wiki",
	"evidence",
	"raw",
	"paper",
];

/** Tailwind classes; palette-level colors so every theme keeps them apart. */
export const SOURCE_STYLE: Record<SourceKind, { dot: string; chip: string }> = {
	paper: {
		dot: "bg-blue-500",
		chip: "border-blue-500/40 text-blue-700 dark:text-blue-300",
	},
	raw: {
		dot: "bg-zinc-400",
		chip: "border-zinc-400/50 text-zinc-600 dark:text-zinc-300",
	},
	wiki: {
		dot: "bg-emerald-500",
		chip: "border-emerald-500/40 text-emerald-700 dark:text-emerald-300",
	},
	evidence: {
		dot: "bg-amber-500",
		chip: "border-amber-500/40 text-amber-700 dark:text-amber-300",
	},
	other: {
		dot: "bg-muted-foreground",
		chip: "border-border text-muted-foreground",
	},
};

/**
 * Slash-normalize and fold every Windows↔WSL spelling of the same location
 * onto one key, so a hit path from kb-rag running in WSL matches the vault the
 * desktop app opened:
 *
 * - `\\?\C:\Vault` / `C:\Vault`        → `C:/Vault`
 * - `/mnt/c/Vault`                     → `C:/Vault`
 * - `\\wsl.localhost\<distro>\home\…`  → `/home/…`
 * - `\\?\UNC\wsl.localhost\<distro>\…` → `/home/…`
 */
function norm(p: string): string {
	let s = p.replace(/\\/g, "/");
	s = s.replace(/^\/\/\?\//i, ""); // \\?\ → C:/… or UNC/…
	s = s.replace(/^\/\/\?/i, "");
	s = s.replace(/^unc\//i, "");
	// \\wsl.localhost\<distro>\home\… (and the `\\wsl$\` alias)
	s = s.replace(/^\/\/wsl(?:\.localhost|\$)\/[^/]+\//i, "/");
	s = s.replace(/^wsl(?:\.localhost|\$)\/[^/]+\//i, "/");
	s = s.replace(/^\/mnt\/([a-z])(?=\/|$)/i, "$1:");
	return s.replace(/\/+$/, "");
}

/** Absolute path → vault-relative path, or null when outside the vault. */
export function toVaultRel(
	absPath: string | null,
	vaultPath: string | null,
): string | null {
	if (!absPath || !vaultPath) return null;
	const a = norm(absPath);
	const v = norm(vaultPath);
	if (a === v || !a.toLowerCase().startsWith(`${v.toLowerCase()}/`))
		return null;
	return a.slice(v.length + 1);
}

/** Classify a vault-relative path by the layout in kb-template/templates/agentero. */
export function sourceKindOfVaultPath(rel: string): SourceKind {
	const parts = norm(rel).split("/");
	if (parts[0] === "papers") return "paper";
	// kb-template nests sources as `kb/<topic>/{raw,wiki_<显示名>}/…`, but a KB
	// directory opened as the vault itself is flat (`<topic>/{raw,wiki_…}/…`).
	// Match the first marker segment anywhere below the root so both layouts
	// classify the same way; `wiki_<显示名>` keeps its evidence subfolder.
	for (let i = 0; i < parts.length; i += 1) {
		if (parts[i] === "raw") return "raw";
		if (parts[i].startsWith("wiki")) {
			return parts[i + 1] === "evidence" ? "evidence" : "wiki";
		}
	}
	return "other";
}
