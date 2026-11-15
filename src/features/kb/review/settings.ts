/**
 * Per-machine inbox settings (localStorage, like the kb-rag URL): the Rscript
 * to run kb_merge.R with and the name recorded as `decided_by`.
 */

const KEY = "agentero-kb-review-settings";

export type ReviewSettings = {
	/** Rscript path; empty = `Rscript` on PATH. */
	rscript: string;
	/** `--by` for kb_merge.R; empty = git user.name. */
	decider: string;
	/** Last base the inbox showed, by absolute dir. */
	lastBase: string;
};

const DEFAULTS: ReviewSettings = { rscript: "", decider: "", lastBase: "" };

export function reviewSettings(): ReviewSettings {
	try {
		const raw = localStorage.getItem(KEY);
		if (!raw) return { ...DEFAULTS };
		return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<ReviewSettings>) };
	} catch {
		return { ...DEFAULTS };
	}
}

export function saveReviewSettings(patch: Partial<ReviewSettings>): void {
	try {
		localStorage.setItem(
			KEY,
			JSON.stringify({ ...reviewSettings(), ...patch }),
		);
	} catch {
		// storage unavailable: settings stay per-session defaults
	}
}
