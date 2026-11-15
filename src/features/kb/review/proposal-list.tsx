import {
	AlertTriangleIcon,
	ChevronDownIcon,
	ChevronRightIcon,
	Loader2Icon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/core/utils";
import { reviewText } from "./i18n";
import {
	groupBatches,
	type Proposal,
	type ProposalBatch,
	type ProposalKind,
	type RouteInfo,
	summarizeBatch,
} from "./model";
import { Chip, RISK_STYLE } from "./proposal-detail";

const KIND_ORDER: ProposalKind[] = [
	"new_page",
	"edit_page",
	"merge_entity",
	"link",
	"gate",
];

type ListProps = {
	proposals: Proposal[];
	grouping: "batches" | "flat";
	focusedId: string | null;
	checked: ReadonlySet<string>;
	fresh: ReadonlyMap<string, boolean>;
	/** id → route (live preview or stored `route`). */
	routes: ReadonlyMap<string, RouteInfo>;
	busy: ReadonlySet<string>;
	canDecide: boolean;
	onFocus: (id: string) => void;
	onToggle: (id: string, on?: boolean) => void;
	onToggleMany: (ids: string[], on: boolean) => void;
	onAcceptMany: (ids: string[]) => void;
};

function shortTarget(target: string): string {
	const parts = target.split("/");
	return parts.length > 2 ? parts.slice(-2).join("/") : target;
}

function Row({
	p,
	focused,
	checked,
	stale,
	route,
	busy,
	onFocus,
	onToggle,
}: {
	p: Proposal;
	focused: boolean;
	checked: boolean;
	stale: boolean;
	route: RouteInfo | null;
	busy: boolean;
	onFocus: () => void;
	onToggle: (on: boolean) => void;
}) {
	const tx = reviewText();
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (focused) ref.current?.scrollIntoView({ block: "nearest" });
	}, [focused]);
	return (
		// biome-ignore lint/a11y/useSemanticElements: row holds a nested checkbox button
		<div
			ref={ref}
			role="button"
			tabIndex={-1}
			onClick={onFocus}
			onKeyDown={() => {}}
			data-focused={focused || undefined}
			className={cn(
				"flex cursor-default items-start gap-2 border-l-2 border-transparent px-2 py-1.5 hover:bg-muted/50",
				focused && "border-l-primary bg-muted",
				busy && "opacity-60",
			)}
		>
			<Checkbox
				checked={checked}
				onCheckedChange={(v) => onToggle(v === true)}
				onClick={(e) => e.stopPropagation()}
				className="mt-0.5"
			/>
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				<div className="flex min-w-0 items-center gap-1.5">
					<span
						className="min-w-0 flex-1 truncate font-mono text-xs"
						title={p.target}
					>
						{shortTarget(p.target)}
					</span>
					{busy && (
						<Loader2Icon className="size-3 animate-spin text-muted-foreground" />
					)}
					{stale && (
						<AlertTriangleIcon
							className="size-3 shrink-0 text-amber-500"
							aria-label={tx.staleShort}
						/>
					)}
				</div>
				<div className="flex min-w-0 items-center gap-1">
					<Chip className="border-border text-muted-foreground">
						{tx.kind[p.kind]}
					</Chip>
					<Chip className={RISK_STYLE[p.risk]}>{tx.risk[p.risk]}</Chip>
					{route?.mode === "auto" && (
						<Chip
							className="border-sky-500/40 text-sky-700 dark:text-sky-300"
							title={route.why ?? undefined}
						>
							{tx.routeAuto(
								tx.routeRule[route.rule ?? ""] ?? route.rule ?? "?",
							)}
						</Chip>
					)}
					{p.evidence.length > 0 && (
						<Chip className="border-amber-500/30 text-amber-700 dark:text-amber-300">
							¶{p.evidence.length}
						</Chip>
					)}
					{p.rationale && (
						<span className="min-w-0 truncate text-[11px] text-muted-foreground">
							{p.rationale}
						</span>
					)}
				</div>
			</div>
		</div>
	);
}

/**
 * Plan card: one pipeline run's change list. The reviewer ticks what to apply
 * (like mindbase `/contribute`) and can accept all low-risk items at once.
 */
function BatchCard({
	batch,
	props,
}: {
	batch: ProposalBatch;
	props: ListProps;
}) {
	const tx = reviewText();
	const [open, setOpen] = useState(true);
	const sum = summarizeBatch(batch, props.fresh);
	const ids = batch.proposals.map((p) => p.id);
	const nChecked = ids.filter((id) => props.checked.has(id)).length;
	const lowRisk = batch.proposals.filter(
		(p) => p.risk === "low" && props.fresh.get(p.id) !== false,
	);
	return (
		<div className="overflow-hidden rounded-lg border">
			<div className="flex flex-col gap-1 bg-muted/40 px-2 py-1.5">
				<div className="flex items-center gap-1.5">
					<button
						type="button"
						onClick={() => setOpen((v) => !v)}
						className="text-muted-foreground"
						aria-label={open ? "collapse" : "expand"}
					>
						{open ? (
							<ChevronDownIcon className="size-3.5" />
						) : (
							<ChevronRightIcon className="size-3.5" />
						)}
					</button>
					<Checkbox
						checked={
							nChecked === ids.length
								? true
								: nChecked
									? "indeterminate"
									: false
						}
						onCheckedChange={(v) => props.onToggleMany(ids, v === true)}
					/>
					<span className="min-w-0 flex-1 truncate text-xs font-medium">
						{batch.tool}
						{batch.pass ? ` / ${batch.pass}` : ""}
						<span className="ml-1.5 font-normal text-muted-foreground">
							{batch.startedAt.replace("T", " ").slice(0, 16)}
						</span>
					</span>
					<span className="text-xs tabular-nums text-muted-foreground">
						{batch.proposals.length}
					</span>
				</div>
				<div className="flex flex-wrap items-center gap-1 pl-5">
					{KIND_ORDER.filter((k) => sum.byKind[k]).map((k) => (
						<Chip key={k} className="border-border text-muted-foreground">
							{tx.kind[k]} {sum.byKind[k]}
						</Chip>
					))}
					{(["high", "medium", "low"] as const)
						.filter((r) => sum.byRisk[r])
						.map((r) => (
							<Chip key={r} className={RISK_STYLE[r]}>
								{tx.risk[r]} {sum.byRisk[r]}
							</Chip>
						))}
					{sum.sources > 0 && (
						<span className="text-[11px] text-muted-foreground">
							{tx.batchSources(sum.sources)}
						</span>
					)}
					{sum.stale > 0 && (
						<span className="text-[11px] text-amber-600">
							{tx.batchStale(sum.stale)}
						</span>
					)}
					{lowRisk.length > 0 && props.canDecide && (
						<Button
							size="xs"
							variant="outline"
							className="ml-auto"
							onClick={() => props.onAcceptMany(lowRisk.map((p) => p.id))}
						>
							{tx.acceptLowRisk(lowRisk.length)}
						</Button>
					)}
				</div>
			</div>
			{open && (
				<div className="divide-y">
					{batch.proposals.map((p) => (
						<Row
							key={p.id}
							p={p}
							focused={props.focusedId === p.id}
							checked={props.checked.has(p.id)}
							stale={props.fresh.get(p.id) === false}
							route={props.routes.get(p.id) ?? p.route}
							busy={props.busy.has(p.id)}
							onFocus={() => props.onFocus(p.id)}
							onToggle={(on) => props.onToggle(p.id, on)}
						/>
					))}
				</div>
			)}
		</div>
	);
}

/** Batches keep review order inside each card. */
export function orderedForKeys(
	proposals: Proposal[],
	grouping: "batches" | "flat",
): Proposal[] {
	if (grouping === "flat") return proposals;
	const order = new Map(proposals.map((p, i) => [p.id, i]));
	return groupBatches(proposals).flatMap((b) =>
		[...b.proposals].sort(
			(x, y) => (order.get(x.id) ?? 0) - (order.get(y.id) ?? 0),
		),
	);
}

export function ProposalList(props: ListProps) {
	const batches = useMemo(() => {
		if (props.grouping === "flat") return null;
		const order = new Map(props.proposals.map((p, i) => [p.id, i]));
		return groupBatches(props.proposals).map((b) => ({
			...b,
			proposals: [...b.proposals].sort(
				(x, y) => (order.get(x.id) ?? 0) - (order.get(y.id) ?? 0),
			),
		}));
	}, [props.proposals, props.grouping]);
	if (batches) {
		return (
			<div className="flex flex-col gap-2 p-2">
				{batches.map((b) => (
					<BatchCard key={b.key} batch={b} props={props} />
				))}
			</div>
		);
	}
	return (
		<div className="divide-y">
			{props.proposals.map((p) => (
				<Row
					key={p.id}
					p={p}
					focused={props.focusedId === p.id}
					checked={props.checked.has(p.id)}
					stale={props.fresh.get(p.id) === false}
					route={props.routes.get(p.id) ?? p.route}
					busy={props.busy.has(p.id)}
					onFocus={() => props.onFocus(p.id)}
					onToggle={(on) => props.onToggle(p.id, on)}
				/>
			))}
		</div>
	);
}
