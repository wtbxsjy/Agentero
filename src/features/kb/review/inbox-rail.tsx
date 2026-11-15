import {
	AlertTriangleIcon,
	HammerIcon,
	InboxIcon,
	RefreshCwIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/core/utils";
import { KB_REVIEW_VIRTUAL_PATH } from "@/lib/paper/api";
import { openTab } from "@/lib/workspace/actions";
import { CompilePlanCard } from "../qa/compile-plan";
import { reviewText } from "./i18n";
import { Chip, RISK_STYLE } from "./proposal-detail";
import { focus, loadBases, reload, reviewStore, selectBase } from "./store";

/** Open the center review tab, optionally focused on one proposal. */
export function openKbReview(id?: string): void {
	if (id) focus(id);
	openTab(KB_REVIEW_VIRTUAL_PATH);
}

/** Pending count of the selected base, for the rail tab badge. */
export function useKbPendingCount(): number {
	return useStore(reviewStore, (s) => s.proposals.length);
}

/** Compact inbox for the right rail: what is waiting, one click to review. */
export function KbInboxRail({
	vaultPath,
	className,
}: {
	vaultPath: string | null;
	className?: string;
}) {
	useTranslation();
	const tx = reviewText();
	const bases = useStore(reviewStore, (s) => s.bases);
	const baseDir = useStore(reviewStore, (s) => s.baseDir);
	const proposals = useStore(reviewStore, (s) => s.proposals);
	const fresh = useStore(reviewStore, (s) => s.fresh);
	const loading = useStore(reviewStore, (s) => s.loading);
	const [planning, setPlanning] = useState(false);
	const base = bases.find((b) => b.dir === baseDir) ?? null;

	useEffect(() => {
		void loadBases(vaultPath).then(() => reload());
	}, [vaultPath]);

	const counts = useMemo(() => {
		const c = { high: 0, medium: 0, low: 0 };
		for (const p of proposals) c[p.risk] += 1;
		return c;
	}, [proposals]);

	if (!vaultPath) {
		return (
			<div className={cn("p-4 text-sm text-muted-foreground", className)}>
				{tx.noVault}
			</div>
		);
	}
	if (!bases.length) {
		return (
			<div className={cn("p-4 text-sm text-muted-foreground", className)}>
				{tx.noBase}
			</div>
		);
	}
	if (planning && base) {
		return (
			<CompilePlanCard
				key={base.dir}
				base={base}
				onDone={() => setPlanning(false)}
				className={className}
			/>
		);
	}
	return (
		<div className={cn("flex min-h-0 flex-col", className)}>
			<div className="flex flex-col gap-2 border-b p-3">
				<div className="flex items-center gap-2">
					{bases.length > 1 ? (
						<select
							value={baseDir ?? ""}
							onChange={(e) => void selectBase(e.target.value)}
							className="h-7 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs"
						>
							{bases.map((b) => (
								<option key={b.dir} value={b.dir}>
									{b.name} ({b.pending})
								</option>
							))}
						</select>
					) : (
						<span className="min-w-0 flex-1 truncate text-sm font-medium">
							{bases[0].name}
						</span>
					)}
					<Button
						size="icon-sm"
						variant="ghost"
						title={tx.refresh}
						onClick={() => void reload()}
					>
						{loading ? <Spinner /> : <RefreshCwIcon />}
					</Button>
				</div>
				<div className="flex items-center gap-1">
					{(["high", "medium", "low"] as const).map((r) => (
						<Chip key={r} className={RISK_STYLE[r]}>
							{tx.risk[r]} {counts[r]}
						</Chip>
					))}
					<Button
						size="xs"
						variant="ghost"
						className="ml-auto"
						title={tx.compileHint}
						onClick={() => setPlanning(true)}
					>
						<HammerIcon />
						{tx.compile}
					</Button>
					<Button size="xs" onClick={() => openKbReview()}>
						<InboxIcon />
						{tx.openInbox}
					</Button>
				</div>
			</div>
			<ScrollArea className="min-h-0 flex-1">
				<div className="flex flex-col p-2">
					{!proposals.length && !loading && (
						<div className="p-2 text-sm text-muted-foreground">{tx.empty}</div>
					)}
					{proposals.slice(0, 200).map((p) => (
						<button
							key={p.id}
							type="button"
							onClick={() => openKbReview(p.id)}
							className="flex flex-col gap-1 rounded-md px-2 py-1.5 text-left hover:bg-muted/60"
						>
							<span className="flex min-w-0 items-center gap-1.5">
								<span
									className="min-w-0 flex-1 truncate font-mono text-xs"
									title={p.target}
								>
									{p.target.split("/").slice(-1)[0]}
								</span>
								{fresh.get(p.id) === false && (
									<AlertTriangleIcon className="size-3 shrink-0 text-amber-500" />
								)}
							</span>
							<span className="flex items-center gap-1">
								<Chip className="border-border text-muted-foreground">
									{tx.kind[p.kind]}
								</Chip>
								<Chip className={RISK_STYLE[p.risk]}>{tx.risk[p.risk]}</Chip>
								{p.rationale && (
									<span className="min-w-0 truncate text-[11px] text-muted-foreground">
										{p.rationale}
									</span>
								)}
							</span>
						</button>
					))}
				</div>
			</ScrollArea>
		</div>
	);
}
