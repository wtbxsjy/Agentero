/**
 * Tauri commands for the review inbox (`src-tauri/src/features/kb`).
 * Accept / reject always go through kb-template's `R/kb_merge.R`.
 */

import type {
	AuditRequest,
	CompileRequest,
	DedupeRequest,
	EvidenceTarget,
	KbBase,
	MergeOutput,
	MergeRequest,
	ProposalFile,
} from "@/lib/core/bindings";
import { commands } from "@/lib/core/bindings";
import { callApi } from "@/lib/core/ipc";
import { reviewSettings, withTemplate } from "./settings";

export type {
	AuditRequest,
	CompileRequest,
	DedupeRequest,
	EvidenceTarget,
	KbBase,
	MergeOutput,
};

export async function listBases(vaultPath: string): Promise<KbBase[]> {
	const bases = await callApi(() => commands.kbListBases(vaultPath));
	return withTemplate(bases, reviewSettings().template);
}

export async function describeBase(kbDir: string): Promise<KbBase> {
	const base = await callApi(() => commands.kbDescribeBase(kbDir));
	return withTemplate([base], reviewSettings().template)[0];
}

export function readProposals(
	kbDir: string,
	state: "pending" | "decided",
	limit?: number,
): Promise<ProposalFile[]> {
	return callApi(() => commands.kbReadProposals(kbDir, state, limit ?? null));
}

export function writeProposal(
	kbDir: string,
	id: string,
	text: string,
): Promise<boolean> {
	return callApi(() => commands.kbWriteProposal(kbDir, id, text));
}

export function readBaseFile(
	kbDir: string,
	rel: string,
): Promise<string | null> {
	return callApi(() => commands.kbReadFile(kbDir, rel));
}

export class MergeFailed extends Error {
	constructor(
		message: string,
		readonly output: MergeOutput,
	) {
		super(message);
	}
}

/** Run kb_merge.R; a non-zero exit becomes `MergeFailed` unless `allowFail`. */
export async function runMerge(
	kbDir: string,
	request: MergeRequest,
	opts: { allowFail?: boolean } = {},
): Promise<MergeOutput> {
	const s = reviewSettings();
	const out = await callApi(() =>
		commands.kbMerge(
			kbDir,
			s.rscript || null,
			s.template || null,
			s.decider || null,
			request,
		),
	);
	if (out.code !== 0 && !opts.allowFail)
		throw new MergeFailed(failTail(out), out);
	return out;
}

function failTail(out: MergeOutput): string {
	const tail = (out.stderr || out.stdout).trim().split("\n").slice(-6);
	return tail.join("\n") || `exit ${out.code}`;
}

/** Run kb_audit.R (spot checks of auto-merged proposals). */
export async function runAudit(
	kbDir: string,
	request: AuditRequest,
	opts: { allowFail?: boolean } = {},
): Promise<MergeOutput> {
	const s = reviewSettings();
	const out = await callApi(() =>
		commands.kbAudit(
			kbDir,
			s.rscript || null,
			s.template || null,
			s.decider || null,
			request,
		),
	);
	if (out.code !== 0 && !opts.allowFail)
		throw new MergeFailed(failTail(out), out);
	return out;
}

/** Run kb_dedupe.R (duplicate scan, manual merge proposal). */
export async function runDedupe(
	kbDir: string,
	request: DedupeRequest,
): Promise<MergeOutput> {
	const s = reviewSettings();
	const out = await callApi(() =>
		commands.kbDedupe(kbDir, s.rscript || null, s.template || null, request),
	);
	if (out.code !== 0) throw new MergeFailed(failTail(out), out);
	return out;
}

/** Run kb_compile.R: the compile plan, or a run of the ticked raw records. */
export async function runCompile(
	kbDir: string,
	request: CompileRequest,
): Promise<MergeOutput> {
	const s = reviewSettings();
	const out = await callApi(() =>
		commands.kbCompile(kbDir, s.rscript || null, s.template || null, request),
	);
	if (out.code !== 0) throw new MergeFailed(failTail(out), out);
	return out;
}

export function resolveEvidence(
	kbDir: string,
	source: string,
	locator?: string,
	quote?: string,
): Promise<EvidenceTarget> {
	return callApi(() =>
		commands.kbResolveEvidence(kbDir, source, locator ?? null, quote ?? null),
	);
}
