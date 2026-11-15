import { ShieldAlertIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { kbText } from "./i18n";

/**
 * Permission prompt banner for agent writes into a knowledge base's wiki/
 * (the Rust side asks for these even in auto mode).
 */
export function KbWikiWriteWarning({ paths }: { paths?: string[] }) {
	useTranslation();
	if (!paths?.length) return null;
	const tx = kbText();
	return (
		<div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
			<ShieldAlertIcon className="mt-0.5 size-4 shrink-0 text-amber-600" />
			<div className="flex flex-col gap-1">
				<span className="font-medium">{tx.wikiWriteTitle}</span>
				<span className="text-muted-foreground">{tx.wikiWriteHint}</span>
			</div>
		</div>
	);
}
