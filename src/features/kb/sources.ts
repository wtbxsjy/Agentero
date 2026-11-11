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

function norm(p: string): string {
	return p.replace(/\\/g, "/").replace(/\/+$/, "");
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
	// kb/<topic>/<raw>|<wiki_显示名>/…; kb_init names the wiki dir `wiki_<name>`.
	if (parts[0] === "kb" && parts.length > 2) {
		if (parts[2] === "raw") return "raw";
		if (parts[2].startsWith("wiki"))
			return parts[3] === "evidence" ? "evidence" : "wiki";
	}
	return "other";
}
