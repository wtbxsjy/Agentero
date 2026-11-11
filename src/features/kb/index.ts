/**
 * Knowledge-base integration (kb-template wiki + kb-rag retrieval).
 * Self-contained: upstream files only import from here. Touch points are
 * listed in KB_PATCHES.md at the repo root.
 */

export { KbPanel } from "./kb-panel";
export { KbRailSwitch, useKbRailView } from "./rail-switch";
export {
	SOURCE_STYLE,
	type SourceKind,
	sourceKindOfVaultPath,
	toVaultRel,
} from "./sources";
