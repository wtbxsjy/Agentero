/**
 * Review inbox (P2): pending kb-template proposals, side-by-side diffs, plan
 * cards per pipeline run, evidence → PDF highlight, batch accept / reject via
 * `R/kb_merge.R`. The center view is lazy-loaded by `doc-view.tsx`.
 */

export { KbInboxRail, openKbReview, useKbPendingCount } from "./inbox-rail";
export { KbReviewView } from "./review-view";
