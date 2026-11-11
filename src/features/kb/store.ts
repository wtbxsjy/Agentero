import { createStore } from "zustand/vanilla";

/** Which view the right rail shows. Kept here so upstream `RightSidebarTab` stays untouched. */
export type KbRailView = "agent" | "kb";

export const kbRailStore = createStore<{ view: KbRailView }>(() => ({
	view: "agent",
}));

export function setKbRailView(view: KbRailView): void {
	kbRailStore.setState({ view });
}
