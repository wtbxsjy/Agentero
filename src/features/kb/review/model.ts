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

/** Risk routing result (`route` in the proposal, or the `--list --json` preview). */
export type RouteInfo = {
	mode: "auto" | "inbox";
	/** Auto-merge rule: link / format / alias. */
	rule: string | null;
	why: string | null;
};

/** `merge_entity`: pages folded into the target. */
export type MergeInfo = {
	from: { path: string; id: string; title: string | null }[];
	aliases: string[];
	basis: string | null;
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
	reasonCode: string | null;
	duplicateOf: string | null;
	route: RouteInfo | null;
	merge: MergeInfo | null;
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

export function parseRoute(v: unknown): RouteInfo | null {
	const o = asRecord(v);
	if (!o) return null;
	const mode = o.mode === "auto" || o.mode === "inbox" ? o.mode : null;
	if (!mode) return null;
	return { mode, rule: str(o.rule), why: str(o.why) };
}

function parseMerge(v: unknown): MergeInfo | null {
	const o = asRecord(v);
	if (!o) return null;
	const list = Array.isArray(o.from) ? o.from : o.from ? [o.from] : [];
	const from: MergeInfo["from"] = [];
	for (const f of list) {
		const r = asRecord(f);
		const path = r && str(r.path);
		const id = r && str(r.id);
		if (r && path && id) from.push({ path, id, title: str(r.title) });
	}
	return { from, aliases: strList(o.aliases), basis: str(o.basis) };
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
		reasonCode: str(o.reason_code),
		duplicateOf: str(o.duplicate_of),
		route: parseRoute(o.route),
		merge: parseMerge(o.merge),
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

/** The JSON value an R script printed, ignoring log lines around it. */
export function extractJson(stdout: string): unknown {
	const starts = [stdout.indexOf("["), stdout.indexOf("{")].filter(
		(i) => i >= 0,
	);
	if (!starts.length) return null;
	const start = Math.min(...starts);
	const close = stdout[start] === "[" ? "]" : "}";
	const end = stdout.lastIndexOf(close);
	if (end < start) return null;
	try {
		return JSON.parse(stdout.slice(start, end + 1)) as unknown;
	} catch {
		return null;
	}
}

function jsonRows(stdout: string): Record<string, unknown>[] {
	const v = extractJson(stdout);
	const list = Array.isArray(v) ? v : v && typeof v === "object" ? [v] : [];
	return list.map(asRecord).filter((r): r is Record<string, unknown> => !!r);
}

/** `--list --json` output → id → fresh. Tolerates log lines around the JSON. */
export function parseFreshList(stdout: string): Map<string, boolean> {
	const out = new Map<string, boolean>();
	for (const o of jsonRows(stdout)) {
		const id = str(o.id);
		if (id && typeof o.fresh === "boolean") out.set(id, o.fresh);
	}
	return out;
}

/** `--list --json` output → id → route preview (what `--route` would do). */
export function parseRoutePreview(stdout: string): Map<string, RouteInfo> {
	const out = new Map<string, RouteInfo>();
	for (const o of jsonRows(stdout)) {
		const id = str(o.id);
		const r = parseRoute(o.route);
		if (id && r) out.set(id, r);
	}
	return out;
}

/** `--route --json` output: one row per routed proposal. */
export type RouteResult = RouteInfo & {
	id: string;
	kind: string | null;
	target: string | null;
	/** Merge outcome for auto rows: accepted / edited / stale / error. */
	result: string | null;
	commit: string | null;
};

export function parseRouteRun(stdout: string): RouteResult[] {
	const out: RouteResult[] = [];
	for (const o of jsonRows(stdout)) {
		const id = str(o.id);
		const r = parseRoute(o);
		if (!id || !r) continue;
		out.push({
			...r,
			id,
			kind: str(o.kind),
			target: str(o.target),
			result: str(o.result),
			commit: str(o.commit),
		});
	}
	return out;
}

/** A rejection reason category from the domain profile (`--reasons --json`). */
export type RejectReason = {
	code: string;
	label: string;
	labelEn: string;
	/** Where this kind of rejection feeds back: prompt / aliases / scope / profile. */
	feeds: string;
};

export function parseReasons(stdout: string): RejectReason[] {
	const out: RejectReason[] = [];
	for (const o of jsonRows(stdout)) {
		const code = str(o.code);
		if (!code) continue;
		const label = str(o.label) ?? code;
		out.push({
			code,
			label,
			labelEn: str(o.label_en) ?? label,
			feeds: str(o.feeds) ?? "prompt",
		});
	}
	return out;
}

/** One queued spot check (`kb_audit.R --list --json`). */
export type AuditItem = {
	id: string;
	kind: string | null;
	target: string | null;
	rule: string | null;
	why: string | null;
	decidedAt: string | null;
	rationale: string | null;
	commit: string | null;
};

export function parseAuditList(stdout: string): AuditItem[] {
	const out: AuditItem[] = [];
	for (const o of jsonRows(stdout)) {
		const id = str(o.id);
		if (!id) continue;
		out.push({
			id,
			kind: str(o.kind),
			target: str(o.target),
			rule: str(o.rule),
			why: str(o.why),
			decidedAt: str(o.decided_at),
			rationale: str(o.rationale),
			commit: str(o.commit),
		});
	}
	return out;
}

export type AuditRuleStats = {
	rule: string;
	autoMerged: number;
	audited: number;
	wrong: number;
	errorRate: number | null;
	upper95: number | null;
	disabled: boolean;
};

export type AuditStats = {
	rules: AuditRuleStats[];
	target: number;
	minAudited: number;
	audited: number;
	wrong: number;
	errorRate: number | null;
	queued: number;
	disabled: string[];
};

function num(v: unknown): number | null {
	return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function parseAuditStats(stdout: string): AuditStats | null {
	const o = asRecord(extractJson(stdout));
	if (!o) return null;
	const rulesRaw = Array.isArray(o.rules) ? o.rules : [];
	const rules: AuditRuleStats[] = [];
	for (const r of rulesRaw) {
		const x = asRecord(r);
		const rule = x && str(x.rule);
		if (!x || !rule) continue;
		rules.push({
			rule,
			autoMerged: num(x.auto_merged) ?? 0,
			audited: num(x.audited) ?? 0,
			wrong: num(x.wrong) ?? 0,
			errorRate: num(x.error_rate),
			upper95: num(x.upper95),
			disabled: x.disabled === true,
		});
	}
	return {
		rules,
		target: num(o.target) ?? 0.05,
		minAudited: num(o.min_audited) ?? 20,
		audited: num(o.audited) ?? 0,
		wrong: num(o.wrong) ?? 0,
		errorRate: num(o.error_rate),
		queued: num(o.queued) ?? 0,
		disabled: strList(o.disabled),
	};
}

/** A candidate duplicate pair (`kb_dedupe.R --scan --json`). */
export type DedupeCandidate = {
	from: string;
	into: string;
	basis: string;
	fromTitle: string;
	intoTitle: string;
	/** A merge proposal for `from` is already pending. */
	pending: boolean;
};

export function parseDedupe(stdout: string): DedupeCandidate[] {
	const out: DedupeCandidate[] = [];
	for (const o of jsonRows(stdout)) {
		const from = str(o.from);
		const into = str(o.into);
		if (!from || !into) continue;
		out.push({
			from,
			into,
			basis: str(o.basis) ?? "?",
			fromTitle: str(o.from_title) ?? from,
			intoTitle: str(o.into_title) ?? into,
			pending: o.pending === true,
		});
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
