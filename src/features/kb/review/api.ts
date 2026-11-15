/**
 * Tauri commands for the review inbox (`src-tauri/src/features/kb`).
 * Accept / reject always go through kb-template's `R/kb_merge.R`.
 */

import type {
	EvidenceTarget,
	KbBase,
	MergeOutput,
	MergeRequest,
	ProposalFile,
} from "@/lib/core/bindings";
import { commands } from "@/lib/core/bindings";
import { callApi } from "@/lib/core/ipc";
import { reviewSettings } from "./settings";

export type { EvidenceTarget, KbBase, MergeOutput };

export function listBases(vaultPath: string): Promise<KbBase[]> {
	return callApi(() => commands.kbListBases(vaultPath));
}

export function describeBase(kbDir: string): Promise<KbBase> {
	return callApi(() => commands.kbDescribeBase(kbDir));
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
		commands.kbMerge(kbDir, s.rscript || null, s.decider || null, request),
	);
	if (out.code !== 0 && !opts.allowFail) {
		const tail = (out.stderr || out.stdout).trim().split("\n").slice(-6);
		throw new MergeFailed(tail.join("\n") || `exit ${out.code}`, out);
	}
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
