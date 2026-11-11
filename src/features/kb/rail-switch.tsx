import { BotIcon, LibraryBigIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";
import { cn } from "@/lib/core/utils";
import { kbText } from "./i18n";
import { type KbRailView, kbRailStore, setKbRailView } from "./store";

export function useKbRailView(): KbRailView {
	return useStore(kbRailStore, (s) => s.view);
}

/** Two-segment switch at the top of the right rail: Agent | Knowledge. */
export function KbRailSwitch() {
	useTranslation();
	const tx = kbText();
	const view = useKbRailView();
	const items: { id: KbRailView; label: string; Icon: typeof BotIcon }[] = [
		{ id: "agent", label: tx.agentTab, Icon: BotIcon },
		{ id: "kb", label: tx.tab, Icon: LibraryBigIcon },
	];
	return (
		<div className="flex shrink-0 gap-1 border-b px-2 py-1.5">
			{items.map(({ id, label, Icon }) => (
				<button
					key={id}
					type="button"
					onClick={() => setKbRailView(id)}
					className={cn(
						"inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-xs",
						view === id
							? "bg-muted text-foreground"
							: "text-muted-foreground hover:bg-muted/60",
					)}
				>
					<Icon className="size-3.5" />
					{label}
				</button>
			))}
		</div>
	);
}
