/**
 * Review inbox state (vanilla zustand, shared by the center tab and the
 * right-rail inbox). Proposals are re-read from disk after every decision:
 * the merger may turn others stale or supersede them, and the files are the
 * source of truth.
 */

import { createStore } from "zustand/vanilla";
import { notifyError } from "@/lib/core/notify";
import {
	type KbBase,
	listBases,
	MergeFailed,
	readProposals,
	runMerge,
	writeProposal,
} from "./api";
import {
	compareForReview,
	type Level,
	type Proposal,
	type ProposalKind,
	type ProposalParseError,
	type ProposalPatch,
	parseFreshList,
	parseMergeReport,
	parseProposal,
	parseReasons,
	parseRoutePreview,
	parseRouteRun,
	type RejectReason,
	type RouteInfo,
	serializeEdited,
} from "./model";
import { reviewSettings, saveReviewSettings } from "./settings";

export type ReviewFilter = {
	risk: Level | "all";
	/** Routing: would auto-merge / needs a human. */
	route: "all" | "auto" | "inbox";
	kind: ProposalKind | "all";
	tool: string | "all";
	text: string;
};

export type DecisionLog = {
	at: number;
	action: "accept" | "reject" | "check" | "route";
	results: {
		id: string;
		status: string;
		commit: string | null;
		msg: string | null;
	}[];
	error?: string;
};

export type ReviewState = {
	vaultPath: string | null;
	bases: KbBase[];
	baseDir: string | null;
	loading: boolean;
	error: string | null;
	proposals: Proposal[];
	broken: ProposalParseError[];
	/** id → base hash still matches (from `kb_merge.R --list --json`). */
	fresh: Map<string, boolean>;
	freshLoading: boolean;
	focusedId: string | null;
	checked: Set<string>;
	filter: ReviewFilter;
	grouping: "batches" | "flat";
	/** Proposal ids with a merge in flight. */
	busy: Set<string>;
	lastDecision: DecisionLog | null;
	/** Bumped after each reload so views drop cached target reads. */
	revision: number;
	/** id → route preview from `kb_merge.R --list --json` (what `--route` would do). */
	routes: Map<string, RouteInfo>;
	/** `kb_merge.R --route` in flight. */
	routing: boolean;
	/** Rejection reasons of the selected base (domain profile), null until loaded. */
	reasons: { dir: string; list: RejectReason[] } | null;
	/** Center view: proposal inbox, spot checks of auto-merges, duplicate entities. */
	view: "inbox" | "audit" | "dedupe";
};

export const EMPTY_FILTER: ReviewFilter = {
	risk: "all",
	route: "all",
	kind: "all",
	tool: "all",
	text: "",
};

export const reviewStore = createStore<ReviewState>(() => ({
	vaultPath: null,
	bases: [],
	baseDir: null,
	loading: false,
	error: null,
	proposals: [],
	broken: [],
	fresh: new Map(),
	freshLoading: false,
	focusedId: null,
	checked: new Set(),
	filter: EMPTY_FILTER,
	grouping: "batches",
	busy: new Set(),
	lastDecision: null,
	revision: 0,
	routes: new Map(),
	routing: false,
	reasons: null,
	view: "inbox",
}));

const get = () => reviewStore.getState();
const set = (patch: Partial<ReviewState>) => reviewStore.setState(patch);

export function currentBase(): KbBase | null {
	const s = get();
	return s.bases.find((b) => b.dir === s.baseDir) ?? null;
}

/** Discover the vault's knowledge bases; keeps the selected one when present. */
export async function loadBases(vaultPath: string | null): Promise<void> {
	if (!vaultPath) {
		set({ vaultPath: null, bases: [], baseDir: null, proposals: [] });
		return;
	}
	const sameVault = get().vaultPath === vaultPath;
	set({ vaultPath });
	try {
		const bases = await listBases(vaultPath);
		const prev = sameVault ? get().baseDir : null;
		const remembered = reviewSettings().lastBase;
		const pick =
			bases.find((b) => b.dir === prev) ??
			bases.find((b) => b.dir === remembered) ??
			[...bases].sort((a, b) => b.pending - a.pending)[0] ??
			null;
		set({ bases, baseDir: pick?.dir ?? null });
	} catch (e) {
		set({ bases: [], baseDir: null, error: errorText(e) });
	}
}

export async function selectBase(dir: string): Promise<void> {
	if (get().baseDir === dir) return;
	saveReviewSettings({ lastBase: dir });
	set({
		baseDir: dir,
		proposals: [],
		broken: [],
		fresh: new Map(),
		routes: new Map(),
		reasons: null,
		focusedId: null,
		checked: new Set(),
		filter: EMPTY_FILTER,
	});
	await reload();
}

function errorText(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

let reloadSeq = 0;

/** Re-read pending proposals; freshness follows in the background. */
export async function reload(
	opts: { fresh?: boolean; force?: boolean } = {},
): Promise<void> {
	const dir = get().baseDir;
	if (!dir) return;
	const seq = ++reloadSeq;
	set({ loading: true, error: null });
	try {
		const files = await readProposals(dir, "pending");
		if (seq !== reloadSeq || get().baseDir !== dir) return;
		const proposals: Proposal[] = [];
		const broken: ProposalParseError[] = [];
		for (const f of files) {
			try {
				proposals.push(parseProposal(f.text, f.path));
			} catch (e) {
				broken.push({ id: f.id, path: f.path, error: errorText(e) });
			}
		}
		proposals.sort(compareForReview);
		const ids = new Set(proposals.map((p) => p.id));
		const s = get();
		const checked = new Set([...s.checked].filter((id) => ids.has(id)));
		const focusedId =
			s.focusedId && ids.has(s.focusedId)
				? s.focusedId
				: (proposals[0]?.id ?? null);
		set({
			proposals,
			broken,
			checked,
			focusedId,
			loading: false,
			revision: s.revision + 1,
			bases: s.bases.map((b) =>
				b.dir === dir ? { ...b, pending: proposals.length } : b,
			),
		});
		if (opts.fresh !== false) void refreshFreshness({ force: opts.force });
	} catch (e) {
		if (seq !== reloadSeq) return;
		set({ loading: false, error: errorText(e) });
	}
}

let freshSeq = 0;
let freshAt = 0;
let freshKey = "";

/** `kb_merge.R --list --json`: which proposals would turn stale on accept. */
export async function refreshFreshness(
	opts: { force?: boolean } = {},
): Promise<void> {
	const base = currentBase();
	if (!base?.hasMerge || !get().proposals.length) {
		set({ fresh: new Map(), routes: new Map(), freshLoading: false });
		return;
	}
	// Each run starts R (~1 s); skip when nothing changed in the last minute.
	const key = `${base.dir}\u0000${get()
		.proposals.map((p) => p.id)
		.join(",")}`;
	if (opts.force !== true && key === freshKey && Date.now() - freshAt < 60_000)
		return;
	const seq = ++freshSeq;
	set({ freshLoading: true });
	try {
		const out = await runMerge(base.dir, { action: "list" });
		if (seq !== freshSeq) return;
		freshKey = key;
		freshAt = Date.now();
		set({
			fresh: parseFreshList(out.stdout),
			routes: parseRoutePreview(out.stdout),
			freshLoading: false,
		});
	} catch {
		// Freshness is advisory: without R the inbox still works read-only.
		if (seq === freshSeq) set({ freshLoading: false });
	}
}

/** Rejection reason categories for the selected base (once per base). */
export async function loadReasons(): Promise<void> {
	const base = currentBase();
	if (!base?.hasMerge || get().reasons?.dir === base.dir) return;
	if (!base.hasDomain) {
		set({ reasons: { dir: base.dir, list: [] } });
		return;
	}
	try {
		const out = await runMerge(base.dir, { action: "reasons" });
		set({ reasons: { dir: base.dir, list: parseReasons(out.stdout) } });
	} catch {
		// Older kb_merge.R or no R: the dialog falls back to built-in presets.
		set({ reasons: { dir: base.dir, list: [] } });
	}
}

export function setView(view: ReviewState["view"]): void {
	set({ view });
}

/** Effective route of a proposal: the live preview, else what `--route` stored. */
export function routeOf(
	p: Proposal,
	routes: ReadonlyMap<string, RouteInfo>,
): RouteInfo | null {
	return routes.get(p.id) ?? p.route;
}

export function focus(id: string | null): void {
	set({ focusedId: id });
}

export function toggleChecked(id: string, on?: boolean): void {
	const checked = new Set(get().checked);
	const want = on ?? !checked.has(id);
	if (want) checked.add(id);
	else checked.delete(id);
	set({ checked });
}

export function setChecked(ids: Iterable<string>, on: boolean): void {
	const checked = new Set(get().checked);
	for (const id of ids) {
		if (on) checked.add(id);
		else checked.delete(id);
	}
	set({ checked });
}

export function clearChecked(): void {
	set({ checked: new Set() });
}

export function setFilter(patch: Partial<ReviewFilter>): void {
	set({ filter: { ...get().filter, ...patch } });
}

export function setGrouping(grouping: ReviewState["grouping"]): void {
	set({ grouping });
}

export function filterProposals(
	proposals: readonly Proposal[],
	filter: ReviewFilter,
	routes: ReadonlyMap<string, RouteInfo> = new Map(),
): Proposal[] {
	const q = filter.text.trim().toLowerCase();
	return proposals.filter(
		(p) =>
			(filter.risk === "all" || p.risk === filter.risk) &&
			(filter.route === "all" ||
				(routeOf(p, routes)?.mode ?? "inbox") === filter.route) &&
			(filter.kind === "all" || p.kind === filter.kind) &&
			(filter.tool === "all" || p.tool === filter.tool) &&
			(!q ||
				p.target.toLowerCase().includes(q) ||
				p.id.includes(q) ||
				(p.rationale ?? "").toLowerCase().includes(q) ||
				p.sourceIds.some((s) => s.toLowerCase().includes(q))),
	);
}

/** Next focus after `ids` leave the list: the item after the last one. */
function nextFocus(ids: readonly string[]): string | null {
	const s = get();
	const visible = filterProposals(s.proposals, s.filter, s.routes);
	const gone = new Set(ids);
	const lastIdx = Math.max(
		...ids.map((id) => visible.findIndex((p) => p.id === id)),
	);
	const after = visible.slice(lastIdx + 1).find((p) => !gone.has(p.id));
	const before = [...visible.slice(0, Math.max(lastIdx, 0))]
		.reverse()
		.find((p) => !gone.has(p.id));
	return after?.id ?? before?.id ?? null;
}

export type RejectInput = {
	reason: string;
	code: string | null;
	duplicateOf: string | null;
};

async function decide(
	action: "accept" | "reject",
	ids: string[],
	why?: RejectInput,
): Promise<DecisionLog | null> {
	const base = currentBase();
	if (!base || !ids.length) return null;
	const s = get();
	const busy = new Set(s.busy);
	for (const id of ids) busy.add(id);
	const focusAfter = ids.includes(s.focusedId ?? "")
		? nextFocus(ids)
		: s.focusedId;
	set({ busy });
	let log: DecisionLog;
	try {
		const out = await runMerge(
			base.dir,
			action === "accept"
				? { action: "accept", ids }
				: {
						action: "reject",
						ids,
						reason: why?.reason ?? "",
						reasonCode: why?.code ?? null,
						duplicateOf: why?.duplicateOf ?? null,
					},
			{ allowFail: true },
		);
		const report = parseMergeReport(out.stdout);
		log = {
			at: Date.now(),
			action,
			results: ids.map((id) => ({
				id,
				...(report.get(id) ?? {
					status: out.code === 0 ? "?" : "error",
					commit: null,
					msg: null,
				}),
			})),
		};
		if (out.code !== 0 && !report.size) {
			log.error = (out.stderr || out.stdout)
				.trim()
				.split("\n")
				.slice(-6)
				.join("\n");
		}
	} catch (e) {
		log = { at: Date.now(), action, results: [], error: errorText(e) };
		if (!(e instanceof MergeFailed)) notifyError(log.error ?? "");
	}
	const after = new Set(get().busy);
	for (const id of ids) after.delete(id);
	set({ busy: after, lastDecision: log, focusedId: focusAfter });
	setChecked(ids, false);
	await reload();
	return log;
}

export function accept(ids: string[]): Promise<DecisionLog | null> {
	return decide("accept", ids);
}

export function reject(
	ids: string[],
	why: RejectInput | string,
): Promise<DecisionLog | null> {
	return decide(
		"reject",
		ids,
		typeof why === "string"
			? { reason: why, code: null, duplicateOf: null }
			: why,
	);
}

/**
 * `kb_merge.R --route`: auto-merge what the domain profile deems low risk
 * (links only, format only, merges the alias table already knows), tag the
 * rest with why it needs a human.
 */
export async function routeNow(): Promise<DecisionLog | null> {
	const base = currentBase();
	if (!base?.hasMerge || get().routing) return null;
	set({ routing: true });
	let log: DecisionLog;
	try {
		const out = await runMerge(base.dir, { action: "route", dryRun: false });
		log = {
			at: Date.now(),
			action: "route",
			results: parseRouteRun(out.stdout).map((r) => ({
				id: r.id,
				status: r.mode === "auto" ? (r.result ?? "?") : "inbox",
				commit: r.commit,
				msg:
					r.mode === "auto" &&
					r.result &&
					r.result !== "accepted" &&
					r.result !== "edited"
						? r.why
						: null,
			})),
		};
	} catch (e) {
		log = { at: Date.now(), action: "route", results: [], error: errorText(e) };
	}
	set({ routing: false, lastDecision: log });
	await reload({ force: true });
	return log;
}

/** Save a reviewer edit into the pending JSON; `andAccept` merges it right away. */
export async function saveEdit(
	p: Proposal,
	patch: ProposalPatch,
	andAccept: boolean,
): Promise<boolean> {
	const base = currentBase();
	if (!base) return false;
	try {
		await writeProposal(base.dir, p.id, serializeEdited(p, patch));
	} catch (e) {
		notifyError(errorText(e));
		return false;
	}
	if (andAccept) await accept([p.id]);
	else await reload({ fresh: false });
	return true;
}

/** `kb_merge.R --check`: close pending proposals whose target changed. */
export async function checkStale(): Promise<DecisionLog | null> {
	const base = currentBase();
	if (!base) return null;
	let log: DecisionLog;
	try {
		const out = await runMerge(base.dir, { action: "check" });
		const report = parseMergeReport(out.stdout);
		log = {
			at: Date.now(),
			action: "check",
			results: [...report].map(([id, r]) => ({ id, ...r })),
		};
	} catch (e) {
		log = { at: Date.now(), action: "check", results: [], error: errorText(e) };
	}
	set({ lastDecision: log });
	await reload();
	return log;
}

export function dismissDecision(): void {
	set({ lastDecision: null });
}
