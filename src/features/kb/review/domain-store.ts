/**
 * Spot checks and duplicate entities (kb-template P3), next to the inbox
 * store: `kb_audit.R` samples auto-merged proposals for a human re-check and
 * tracks each routing rule's error rate; `kb_dedupe.R` finds duplicate
 * entity pages and writes `merge_entity` proposals into the inbox.
 */

import { createStore } from "zustand/vanilla";
import { MergeFailed, runAudit, runDedupe } from "./api";
import {
	type AuditItem,
	type AuditStats,
	type DedupeCandidate,
	extractJson,
	parseAuditList,
	parseAuditStats,
	parseDedupe,
} from "./model";
import { currentBase, reload } from "./store";

export type DomainState = {
	dir: string | null;
	auditLoading: boolean;
	queue: AuditItem[];
	stats: AuditStats | null;
	auditFocus: string | null;
	/** `kb_audit.R --show` output for `auditFocus`. */
	commitText: { id: string; text: string } | null;
	auditBusy: boolean;
	dedupeLoading: boolean;
	candidates: DedupeCandidate[];
	dedupeBusy: Set<string>;
	error: string | null;
	notice: string | null;
};

export const domainStore = createStore<DomainState>(() => ({
	dir: null,
	auditLoading: false,
	queue: [],
	stats: null,
	auditFocus: null,
	commitText: null,
	auditBusy: false,
	dedupeLoading: false,
	candidates: [],
	dedupeBusy: new Set(),
	error: null,
	notice: null,
}));

const get = () => domainStore.getState();
const set = (patch: Partial<DomainState>) => domainStore.setState(patch);

function errorText(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

function sameBase(): string | null {
	const base = currentBase();
	if (!base?.hasDomain) return null;
	if (get().dir !== base.dir) {
		set({
			dir: base.dir,
			queue: [],
			stats: null,
			auditFocus: null,
			commitText: null,
			candidates: [],
			error: null,
			notice: null,
		});
	}
	return base.dir;
}

export async function loadAudit(): Promise<void> {
	const dir = sameBase();
	if (!dir) return;
	set({ auditLoading: true, error: null });
	try {
		const [list, report] = await Promise.all([
			runAudit(dir, { action: "list" }),
			runAudit(dir, { action: "report" }),
		]);
		if (get().dir !== dir) return;
		const queue = parseAuditList(list.stdout);
		const focusId = get().auditFocus;
		set({
			queue,
			stats: parseAuditStats(report.stdout),
			auditFocus:
				focusId && queue.some((q) => q.id === focusId)
					? focusId
					: (queue[0]?.id ?? null),
			auditLoading: false,
		});
		const f = get().auditFocus;
		if (f) void loadCommit(f);
	} catch (e) {
		set({ auditLoading: false, error: errorText(e) });
	}
}

export async function loadCommit(id: string): Promise<void> {
	const dir = sameBase();
	if (!dir) return;
	set({ auditFocus: id });
	if (get().commitText?.id === id) return;
	try {
		const out = await runAudit(dir, { action: "show", id });
		if (get().auditFocus === id) set({ commitText: { id, text: out.stdout } });
	} catch (e) {
		if (get().auditFocus === id)
			set({ commitText: { id, text: errorText(e) } });
	}
}

export async function sampleAudit(): Promise<void> {
	const dir = sameBase();
	if (!dir) return;
	set({ auditBusy: true, error: null });
	try {
		const out = await runAudit(dir, { action: "sample" });
		const v = extractJson(out.stdout) as { sampled?: unknown } | null;
		const n = Array.isArray(v?.sampled)
			? v.sampled.length
			: typeof v?.sampled === "string"
				? 1
				: 0;
		set({ notice: `sampled:${n}` });
	} catch (e) {
		set({ error: errorText(e) });
	}
	set({ auditBusy: false });
	await loadAudit();
}

export async function markAudit(
	id: string,
	verdict: "ok" | "wrong",
	note: string,
	revert: boolean,
): Promise<boolean> {
	const dir = sameBase();
	if (!dir) return false;
	set({ auditBusy: true, error: null });
	let ok = true;
	try {
		const out = await runAudit(
			dir,
			{ action: "mark", id, verdict, note: note.trim() || null, revert },
			{ allowFail: true },
		);
		if (out.code !== 0) {
			ok = false;
			set({
				error: (out.stdout || out.stderr)
					.trim()
					.split("\n")
					.slice(-4)
					.join("\n"),
			});
		}
	} catch (e) {
		ok = false;
		set({ error: e instanceof MergeFailed ? e.message : errorText(e) });
	}
	set({ auditBusy: false, commitText: null });
	await loadAudit();
	// A revert puts the proposal back into the inbox.
	if (revert) await reload({ force: true });
	return ok;
}

export async function loadDedupe(): Promise<void> {
	const dir = sameBase();
	if (!dir) return;
	set({ dedupeLoading: true, error: null });
	try {
		const out = await runDedupe(dir, { action: "scan" });
		if (get().dir !== dir) return;
		set({ candidates: parseDedupe(out.stdout), dedupeLoading: false });
	} catch (e) {
		set({ dedupeLoading: false, error: errorText(e) });
	}
}

/** Write a `merge_entity` proposal (it then shows up in the inbox). */
export async function proposeMerge(
	from: string,
	into: string,
	reason?: string,
): Promise<boolean> {
	const dir = sameBase();
	if (!dir) return false;
	const key = `${from}\u0000${into}`;
	set({ dedupeBusy: new Set([...get().dedupeBusy, key]), error: null });
	let ok = true;
	try {
		await runDedupe(dir, {
			action: "merge",
			from: from.trim(),
			into: into.trim(),
			reason: reason?.trim() || null,
		});
		set({ notice: `proposed:${from}` });
	} catch (e) {
		ok = false;
		set({ error: errorText(e) });
	}
	const busy = new Set(get().dedupeBusy);
	busy.delete(key);
	set({ dedupeBusy: busy });
	await Promise.all([loadDedupe(), reload()]);
	return ok;
}

export function dismissDomainMessage(): void {
	set({ error: null, notice: null });
}
