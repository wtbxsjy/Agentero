/**
 * Evidence jump: a proposal's `{source, locator}` → the cited paragraph in
 * the original PDF (highlighted), else the evidence page anchor, else the raw
 * record. Resolution and the PDF text search run in Rust
 * (`kb_resolve_evidence`); this module only drives the workspace.
 */

import { notifyError } from "@/lib/core/notify";
import { paperDirFromPath } from "@/lib/paper/detect";
import {
	beginPdfNavigation,
	completePdfNavigation,
} from "@/lib/pdf/pending-pdf-page";
import { vaultStore } from "@/lib/vault/store";
import { navigateWiki, openPaper, openPath } from "@/lib/workspace/actions";
import { tabIdForPath } from "@/lib/workspace/tabs";
import { toVaultRel } from "../sources";
import { type EvidenceTarget, resolveEvidence } from "./api";
import { reviewText } from "./i18n";
import type { Evidence } from "./model";

const cache = new Map<string, Promise<EvidenceTarget>>();

function key(kbDir: string, ev: Evidence): string {
	return [kbDir, ev.source, ev.locator ?? "", ev.quote ?? ""].join("\u0000");
}

/** Cached resolve (paragraph text is shown inline before any click). */
export function resolveEvidenceCached(
	kbDir: string,
	ev: Evidence,
): Promise<EvidenceTarget> {
	const k = key(kbDir, ev);
	let hit = cache.get(k);
	if (!hit) {
		hit = resolveEvidence(kbDir, ev.source, ev.locator, ev.quote);
		hit.catch(() => cache.delete(k));
		cache.set(k, hit);
		if (cache.size > 500) {
			const first = cache.keys().next().value;
			if (first !== undefined) cache.delete(first);
		}
	}
	return hit;
}

export function clearEvidenceCache(): void {
	cache.clear();
}

function normAbs(p: string): string {
	return p.replace(/\\/g, "/").replace(/\/+$/, "");
}

export type EvidenceJump =
	| "pdf"
	| "pdf-page"
	| "evidence-page"
	| "raw"
	| "none";

/** Open the best target for one evidence entry; returns where it went. */
export async function openEvidence(
	kbDir: string,
	vaultPath: string | null,
	ev: Evidence,
): Promise<EvidenceJump> {
	const tx = reviewText();
	let target: EvidenceTarget;
	try {
		target = await resolveEvidenceCached(kbDir, ev);
	} catch (e) {
		notifyError(e instanceof Error ? e.message : String(e));
		return "none";
	}

	const pdfRel = toVaultRel(target.pdfPath, vaultPath);
	if (target.pdfPath && pdfRel && vaultPath) {
		const abs = normAbs(target.pdfPath);
		const paperAbs = paperDirFromPath(abs, vaultStore.getState().paperFolders);
		const openKey = paperAbs ?? abs;
		const intent = beginPdfNavigation(tabIdForPath(openKey));
		if (paperAbs) openPaper(paperAbs);
		else openPath(abs);
		const hit = target.pdfHit;
		if (hit) {
			completePdfNavigation(intent, {
				page: hit.pageIndex + 1,
				region: {
					id: `kb-evidence-${ev.source}-${ev.locator ?? "q"}`,
					pageIndex: hit.pageIndex,
					bbox: {
						x: hit.x ?? 0,
						y: hit.y ?? 0,
						w: hit.w ?? 1,
						h: hit.h ?? 0.05,
					},
					kind: "text",
				},
			});
			return "pdf";
		}
		if (target.page) {
			completePdfNavigation(intent, { page: target.page });
			return "pdf-page";
		}
		// The PDF opened, but the paragraph text was not found in its text
		// layer (scanned page, heavy math): say so, and also show the anchor.
		completePdfNavigation(intent, { page: 1 });
		notifyError(tx.evidenceNotLocated);
		return "pdf-page";
	}

	const evRel = toVaultRel(target.evidencePath, vaultPath);
	if (evRel) {
		void navigateWiki({
			targetRaw: evRel,
			path: evRel,
			status: "resolved",
			fragment: target.paragraph
				? { kind: "block", id: `p${target.paragraph}` }
				: undefined,
		});
		return "evidence-page";
	}
	const rawRel = toVaultRel(target.rawPath, vaultPath);
	if (rawRel && vaultPath) {
		openPath(normAbs(target.rawPath ?? ""));
		return "raw";
	}
	notifyError(
		target.pdfPath || target.evidencePath || target.rawPath
			? tx.evidenceOutsideVault
			: tx.evidenceMissing(ev.source),
	);
	return "none";
}
