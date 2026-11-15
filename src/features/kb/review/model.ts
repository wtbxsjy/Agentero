/**
 * Proposal model for the review inbox. Mirrors kb-template
 * `schema/proposal.schema.json` (schema_version 1); unknown fields are kept
 * in `raw` so an edit round-trips everything the merger wrote.
 */

export type ProposalKind =
	| "new_page"
	| "edit_page"
	| "link"
	| "gate"
	| "merge_entity";

export type ProposalStatus =
	| "pending"
	| "accepted"
	| "edited"
	| "rejected"
	| "stale";

export type Level = "low" | "medium" | "high";

export type Evidence = {
	source: string;
	locator?: string;
	quote?: string;
};

export type ProposalPatch = {
	frontmatter?: Record<string, unknown>;
	body?: string;
	set?: Record<string, unknown>;
};

export type Proposal = {
	id: string;
	kind: ProposalKind;
	target: string;
	baseHash: string | null;
	patch: ProposalPatch;
	sourceIds: string[];
	evidence: Evidence[];
	confidence: Level | null;
	risk: Level;
	rationale: string | null;
	status: ProposalStatus;
	createdAt: string;
	tool: string;
	pass: string | null;
	model: string | null;
	decidedAt: string | null;
	decidedBy: string | null;
	reason: string | null;
	/** Absolute JSON path. */
	path: string;
	/** Parsed JSON object, key order preserved (used for edits). */
	raw: Record<string, unknown>;
};

export type ProposalParseError = {
	id: string;
	path: string;
	error: string;
};

const KINDS: readonly ProposalKind[] = [
	"new_page",
	"edit_page",
	"link",
	"gate",
	"merge_entity",
];
const LEVELS: readonly Level[] = ["low", "medium", "high"];

function str(v: unknown): string | null {
	return typeof v === "string" ? v : null;
}

function level(v: unknown): Level | null {
	return LEVELS.includes(v as Level) ? (v as Level) : null;
}

function strList(v: unknown): string[] {
	if (Array.isArray(v)) return v.filter((x) => typeof x === "string");
	return typeof v === "string" ? [v] : [];
}

function evidenceList(v: unknown): Evidence[] {
	// jsonlite writes a one-element list as an object when auto_unbox hits it.
	const list = Array.isArray(v) ? v : v && typeof v === "object" ? [v] : [];
	const out: Evidence[] = [];
	for (const e of list) {
		if (!e || typeof e !== "object") continue;
		const o = e as Record<string, unknown>;
		const source = str(o.source);
		if (!source) continue;
		out.push({
			source,
			locator: str(o.locator) ?? undefined,
			quote: str(o.quote) ?? undefined,
		});
	}
	return out;
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
	return v && typeof v === "object" && !Array.isArray(v)
		? (v as Record<string, unknown>)
		: undefined;
}

/** Parse one proposal file. Throws with a readable message on a bad shape. */
export function parseProposal(text: string, path: string): Proposal {
	const raw = JSON.parse(text) as unknown;
	const o = asRecord(raw);
	if (!o) throw new Error("not a JSON object");
	const id = str(o.id);
	if (!id) throw new Error("missing id");
	const kind = str(o.kind) as ProposalKind | null;
	if (!kind || !KINDS.includes(kind)) throw new Error(`unknown kind ${kind}`);
	const target = str(o.target);
	if (!target) throw new Error("missing target");
	const patch = asRecord(o.patch) ?? {};
	const by = asRecord(o.created_by) ?? {};
	return {
		id,
		kind,
		target,
		baseHash: str(o.base_hash),
		patch: {
			frontmatter: asRecord(patch.frontmatter),
			body: str(patch.body) ?? undefined,
			set: asRecord(patch.set),
		},
		sourceIds: strList(o.source_ids),
		evidence: evidenceList(o.evidence),
		confidence: level(o.confidence),
		risk: level(o.risk) ?? "high",
		rationale: str(o.rationale),
		status: (str(o.status) as ProposalStatus | null) ?? "pending",
		createdAt: str(o.created_at) ?? "",
		tool: str(by.tool) ?? "?",
		pass: str(by.pass),
		model: str(by.model),
		decidedAt: str(o.decided_at),
		decidedBy: str(o.decided_by),
		reason: str(o.reason),
		path,
		raw: o,
	};
}

/**
 * Serialize an edited proposal the way kb_merge.R expects: same object, same
 * key order, only `patch` replaced. The merger compares `patch_hash` to spot
 * the edit, so nothing else may change.
 */
export function serializeEdited(p: Proposal, patch: ProposalPatch): string {
	const next: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(p.raw)) {
		next[k] = k === "patch" ? mergePatch(asRecord(v) ?? {}, patch) : v;
	}
	return `${JSON.stringify(next, null, 2)}\n`;
}

function mergePatch(
	orig: Record<string, unknown>,
	patch: ProposalPatch,
): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(orig)) {
		if (k === "frontmatter" && patch.frontmatter) out[k] = patch.frontmatter;
		else if (k === "body" && patch.body !== undefined) out[k] = patch.body;
		else if (k === "set" && patch.set) out[k] = patch.set;
		else out[k] = v;
	}
	if (patch.frontmatter && !("frontmatter" in out))
		out.frontmatter = patch.frontmatter;
	if (patch.body !== undefined && !("body" in out)) out.body = patch.body;
	if (patch.set && !("set" in out)) out.set = patch.set;
	return out;
}

export const RISK_ORDER: Record<Level, number> = { low: 1, medium: 2, high: 3 };

/** Review order: highest risk first, then oldest first (ids sort by time). */
export function compareForReview(a: Proposal, b: Proposal): number {
	return RISK_ORDER[b.risk] - RISK_ORDER[a.risk] || a.id.localeCompare(b.id);
}

/** A run of proposals produced by one pipeline invocation (a plan card). */
export type ProposalBatch = {
	key: string;
	tool: string;
	pass: string | null;
	model: string | null;
	/** Earliest `created_at` in the batch. */
	startedAt: string;
	proposals: Proposal[];
};

function createdMs(p: Proposal): number {
	const t = Date.parse(p.createdAt);
	return Number.isNaN(t) ? 0 : t;
}

/**
 * Group proposals into batches: same tool + pass, created within `gapMs` of
 * the previous one. A kb_compile / kb_link run writes its proposals in one
 * burst, so the gap splits runs apart without needing a run id in the schema.
 */
export function groupBatches(
	proposals: readonly Proposal[],
	gapMs = 10 * 60 * 1000,
): ProposalBatch[] {
	const sorted = [...proposals].sort(
		(a, b) => createdMs(a) - createdMs(b) || a.id.localeCompare(b.id),
	);
	const open = new Map<string, { batch: ProposalBatch; lastMs: number }>();
	const batches: ProposalBatch[] = [];
	for (const p of sorted) {
		const family = `${p.tool}\u0000${p.pass ?? ""}`;
		const ms = createdMs(p);
		const cur = open.get(family);
		if (cur && ms - cur.lastMs <= gapMs) {
			cur.batch.proposals.push(p);
			cur.lastMs = ms;
			continue;
		}
		const batch: ProposalBatch = {
			key: `${family}\u0000${p.id}`,
			tool: p.tool,
			pass: p.pass,
			model: p.model,
			startedAt: p.createdAt,
			proposals: [p],
		};
		batches.push(batch);
		open.set(family, { batch, lastMs: ms });
	}
	// Newest run first: that is what the reviewer just kicked off.
	return batches.reverse();
}

export type BatchSummary = {
	byKind: Partial<Record<ProposalKind, number>>;
	byRisk: Record<Level, number>;
	sources: number;
	stale: number;
};

export function summarizeBatch(
	batch: ProposalBatch,
	fresh: ReadonlyMap<string, boolean>,
): BatchSummary {
	const byKind: Partial<Record<ProposalKind, number>> = {};
	const byRisk: Record<Level, number> = { low: 0, medium: 0, high: 0 };
	const sources = new Set<string>();
	let stale = 0;
	for (const p of batch.proposals) {
		byKind[p.kind] = (byKind[p.kind] ?? 0) + 1;
		byRisk[p.risk] += 1;
		for (const s of p.sourceIds) sources.add(s);
		if (fresh.get(p.id) === false) stale += 1;
	}
	return { byKind, byRisk, sources: sources.size, stale };
}

/** `--list --json` output → id → fresh. Tolerates log lines around the JSON. */
export function parseFreshList(stdout: string): Map<string, boolean> {
	const out = new Map<string, boolean>();
	const start = stdout.indexOf("[");
	const end = stdout.lastIndexOf("]");
	if (start < 0 || end < start) return out;
	try {
		const rows = JSON.parse(stdout.slice(start, end + 1)) as unknown;
		if (!Array.isArray(rows)) return out;
		for (const r of rows) {
			const o = asRecord(r);
			const id = o && str(o.id);
			if (id && typeof o.fresh === "boolean") out.set(id, o.fresh);
		}
	} catch {
		// R printed something unexpected: freshness stays unknown.
	}
	return out;
}

/** `kb_merge.R --accept/--reject` report lines → id → resulting status. */
export function parseMergeReport(
	stdout: string,
): Map<string, { status: string; commit: string | null; msg: string | null }> {
	const out = new Map<
		string,
		{ status: string; commit: string | null; msg: string | null }
	>();
	const lines = stdout.split(/\r?\n/);
	let last: string | null = null;
	for (const line of lines) {
		const m = line.match(
			/^\s+\S\s+(p-\d{8}-\d{6}-[0-9a-f]{6})\s+(\S+)\s.*?(?:\[([0-9a-f]+)\])?\s*$/,
		);
		if (m) {
			out.set(m[1], { status: m[2], commit: m[3] ?? null, msg: null });
			last = m[1];
			continue;
		}
		const notFound = line.match(/找不到提案\s+(p-\d{8}-\d{6}-[0-9a-f]{6})/);
		if (notFound) {
			out.set(notFound[1], {
				status: "missing",
				commit: null,
				msg: line.trim(),
			});
			last = null;
			continue;
		}
		if (last && /^\s{6}\S/.test(line)) {
			const cur = out.get(last);
			if (cur) cur.msg = cur.msg ? `${cur.msg} ${line.trim()}` : line.trim();
		}
	}
	return out;
}
