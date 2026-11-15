/**
 * Q&A over a knowledge base (kb-template `POST /ask`, P4) and the compile
 * plan (`kb_compile.R --dry-run --json`): response shapes and the pure parts
 * (answer segmentation, plan selection), kept free of React for tests.
 */

import type { Evidence } from "../review/model";

export type AskLevel = "keyword" | "hybrid" | "multihop";
export const ASK_LEVELS: readonly AskLevel[] = [
	"keyword",
	"hybrid",
	"multihop",
];

export type AskCitation = {
	n: number;
	page_id: string;
	title: string;
	/** Base-relative path of the wiki page. */
	path: string;
	para: number;
	hop: number;
	evidence: Evidence[];
	page_sources: string[];
};

export type RetrievedPage = {
	id: string;
	title: string;
	path: string;
	score: number;
	hop: number;
	via: string | null;
	relation: string;
	page_type?: string;
};

export type AskResult = {
	kb_dir: string;
	question: string;
	answer: string;
	confidence: string;
	insufficient: boolean;
	unparsed?: boolean;
	citations: AskCitation[];
	invalid_citations: number[];
	sources: string[];
	retrieval: {
		level: string;
		params: Record<string, unknown>;
		trace: Record<string, unknown>;
		pages: RetrievedPage[];
		passages: unknown[];
	};
	created_by: {
		tool: string;
		model: string;
		provider: string;
		prompt_hash: string;
		profile_hash: string | null;
	};
	elapsed_ms?: { retrieve: number; llm: number };
	/** Proposal draft for `kb_merge.R --submit` (new_page under wiki/queries/). */
	draft: Record<string, unknown> & { target?: string };
};

/** A segment of the answer text: plain text, or a `[n]` citation marker. */
export type AnswerPart =
	| { kind: "text"; text: string }
	| { kind: "cite"; n: number; citation: AskCitation | null };

/** Split `answer` on `[n]` / `[n, m]` markers (the prompt's citation form). */
export function segmentAnswer(
	answer: string,
	citations: AskCitation[],
): AnswerPart[] {
	const byN = new Map(citations.map((c) => [c.n, c]));
	const out: AnswerPart[] = [];
	const re = /\[(\d+(?:\s*[,，、]\s*\d+)*)\]/g;
	let last = 0;
	for (let m = re.exec(answer); m; m = re.exec(answer)) {
		if (m.index > last)
			out.push({ kind: "text", text: answer.slice(last, m.index) });
		for (const n of m[1].split(/[,，、]/).map((x) => Number(x.trim())))
			out.push({ kind: "cite", n, citation: byN.get(n) ?? null });
		last = m.index + m[0].length;
	}
	if (last < answer.length)
		out.push({ kind: "text", text: answer.slice(last) });
	return out;
}

/** How a retrieved page was reached, for the trace list ("seed", "← a"). */
export function pageReach(p: RetrievedPage): string {
	if (p.relation === "seed" || !p.via) return "seed";
	return `${p.relation} ← ${p.via}`;
}

/** `kb_merge.R --submit --json` output. */
export type SubmitResult = {
	ok: boolean;
	error?: string;
	id?: string;
	kind?: string;
	target?: string;
	risk?: string;
	/** Routing preview: `auto` would merge without review under `rule`. */
	route?: {
		mode: "auto" | "inbox";
		rule?: string | null;
		why?: string | null;
	} | null;
};

/** Last JSON object line of a script's stdout (R may print notes first). */
export function lastJson<T>(stdout: string): T | null {
	const lines = stdout.trim().split("\n").reverse();
	for (const line of lines) {
		const t = line.trim();
		if (!t.startsWith("{")) continue;
		try {
			return JSON.parse(t) as T;
		} catch {
			// keep looking
		}
	}
	try {
		return JSON.parse(stdout) as T;
	} catch {
		return null;
	}
}

export type PlanItem = {
	id: string;
	title: string;
	source_type: string | null;
	status: string | null;
	value_gate: string | null;
	path: string;
	est_tokens: number | null;
};

export type CompilePlan = {
	queue: PlanItem[];
	undecided: number;
	budget: { pages: number; tokens: number } | null;
	provider: string;
	model: string | null;
	concurrency: number;
};

/** Parse `kb_compile.R --dry-run --json`; tolerant of R's scalar/array quirks. */
export function parseCompilePlan(stdout: string): CompilePlan | null {
	const raw = lastJson<Record<string, unknown>>(stdout);
	if (!raw || !Array.isArray(raw.queue)) return null;
	const one = (v: unknown) => (Array.isArray(v) ? v[0] : v);
	const str = (v: unknown) => {
		const x = one(v);
		return x == null || x === "" ? null : String(x);
	};
	const num = (v: unknown) => {
		const raw = one(v);
		if (raw == null || raw === "" || typeof raw === "boolean") return null;
		const x = Number(raw);
		return Number.isFinite(x) ? x : null;
	};
	const queue = (raw.queue as Record<string, unknown>[]).map((q) => ({
		id: String(one(q.id) ?? ""),
		title: str(q.title) ?? "",
		source_type: str(q.source_type),
		status: str(q.status),
		value_gate: str(q.value_gate),
		path: str(q.path) ?? "",
		est_tokens: num(q.est_tokens),
	}));
	const b = raw.budget as Record<string, unknown> | undefined;
	return {
		queue: queue.filter((q) => q.id),
		undecided: num(raw.undecided) ?? 0,
		budget:
			b && num(b.pages) != null
				? { pages: num(b.pages) ?? 0, tokens: num(b.tokens) ?? 0 }
				: null,
		provider: str(raw.provider) ?? "",
		model: str(raw.model),
		concurrency: num(raw.concurrency) ?? 1,
	};
}

/** Totals of the ticked sources, and whether they exceed the run budget. */
export function planSelection(
	plan: CompilePlan,
	picked: ReadonlySet<string>,
): { ids: string[]; tokens: number; overBudget: boolean } {
	const items = plan.queue.filter((q) => picked.has(q.id));
	const tokens = items.reduce((t, q) => t + (q.est_tokens ?? 0), 0);
	const overBudget =
		!!plan.budget &&
		(items.length > plan.budget.pages ||
			(plan.budget.tokens > 0 && tokens > plan.budget.tokens));
	return { ids: items.map((q) => q.id), tokens, overBudget };
}

/** Default ticks: the queue in order, up to the per-run source budget. */
export function defaultPicks(plan: CompilePlan): Set<string> {
	const n = plan.budget?.pages ?? plan.queue.length;
	return new Set(plan.queue.slice(0, n).map((q) => q.id));
}
