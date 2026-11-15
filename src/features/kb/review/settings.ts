/**
 * Per-machine inbox settings (localStorage, like the kb-rag URL): the Rscript
 * to run kb_merge.R with, the kb-template checkout the scripts come from, and
 * the name recorded as `decided_by`.
 */

const KEY = "agentero-kb-review-settings";

export type ReviewSettings = {
	/** Rscript path; empty = `Rscript` on PATH. */
	rscript: string;
	/**
	 * kb-template checkout; empty = the base's own `R/` (forwarders written by
	 * `kb_init --scripts shared`, or an older full copy).
	 */
	template: string;
	/** `--by` for kb_merge.R; empty = git user.name. */
	decider: string;
	/** Last base the inbox showed, by absolute dir. */
	lastBase: string;
};

const DEFAULTS: ReviewSettings = {
	rscript: "",
	template: "",
	decider: "",
	lastBase: "",
};

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

/**
 * With the kb-template setting, every script comes from the checkout, so a
 * base without its own `R/` can still merge, audit and dedupe.
 */
export function withTemplate<
	B extends { hasMerge: boolean; hasDomain: boolean },
>(bases: B[], template: string): B[] {
	if (!template.trim()) return bases;
	return bases.map((b) => ({ ...b, hasMerge: true, hasDomain: true }));
}
