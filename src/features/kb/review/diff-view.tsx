import { ChevronsUpDownIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "@/lib/core/utils";
import {
	classifyUnified,
	type SideCell,
	type SideRow,
	type Span,
	unfoldedRows,
} from "./diff";
import type { FieldRow } from "./frontmatter";
import { reviewText } from "./i18n";

function Spans({ spans, side }: { spans: Span[]; side: "left" | "right" }) {
	return (
		<>
			{spans.map((s, i) => (
				<span
					// biome-ignore lint/suspicious/noArrayIndexKey: spans are positional
					key={i}
					className={cn(
						s.changed &&
							(side === "left"
								? "rounded-sm bg-red-500/25"
								: "rounded-sm bg-emerald-500/25"),
					)}
				>
					{s.text}
				</span>
			))}
		</>
	);
}

function Cell({
	cell,
	side,
	kind,
}: {
	cell: SideCell | null;
	side: "left" | "right";
	kind: "equal" | "change" | "del" | "ins";
}) {
	const tone =
		!cell || kind === "equal"
			? ""
			: side === "left"
				? "bg-red-500/10"
				: "bg-emerald-500/10";
	return (
		<>
			<div
				className={cn(
					"select-none border-r px-1.5 text-right text-muted-foreground/70 tabular-nums",
					tone,
					!cell && "bg-muted/40",
				)}
			>
				{cell?.no ?? ""}
			</div>
			<div
				className={cn(
					"min-w-0 whitespace-pre-wrap break-words px-2",
					tone,
					!cell && "bg-muted/40",
					side === "left" && "border-r",
				)}
			>
				{cell ? (
					cell.spans ? (
						<Spans spans={cell.spans} side={side} />
					) : (
						cell.text || " "
					)
				) : null}
			</div>
		</>
	);
}

/** Two-column line diff with folded context. */
export function SideBySideDiff({
	before,
	after,
	className,
}: {
	before: string;
	after: string;
	className?: string;
}) {
	const tx = reviewText();
	const [open, setOpen] = useState<Set<string>>(() => new Set());
	const { rows, added, removed } = useMemo(
		() => unfoldedRows(before, after, open),
		[before, after, open],
	);
	if (!added && !removed) {
		return (
			<div className={cn("px-3 py-2 text-xs text-muted-foreground", className)}>
				{tx.noChange}
			</div>
		);
	}
	return (
		<div className={cn("overflow-hidden rounded-md border", className)}>
			<div className="flex items-center gap-3 border-b bg-muted/40 px-2 py-1 text-xs">
				<span className="text-emerald-600 tabular-nums dark:text-emerald-400">
					+{added}
				</span>
				<span className="text-red-600 tabular-nums dark:text-red-400">
					−{removed}
				</span>
			</div>
			<div className="grid grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)] font-mono text-xs leading-5">
				{rows.map((r: SideRow, i) =>
					r.type === "fold" ? (
						<button
							key={r.key}
							type="button"
							onClick={() => setOpen((s) => new Set(s).add(r.key))}
							className="col-span-4 flex items-center gap-1.5 border-y bg-muted/30 px-2 py-0.5 text-left text-muted-foreground hover:bg-muted"
						>
							<ChevronsUpDownIcon className="size-3" />
							{tx.unfold(r.count)}
						</button>
					) : (
						<Row
							// biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
							key={i}
							row={r}
						/>
					),
				)}
			</div>
		</div>
	);
}

function Row({ row }: { row: Extract<SideRow, { type: "line" }> }) {
	return (
		<>
			<Cell cell={row.left} side="left" kind={row.kind} />
			<Cell cell={row.right} side="right" kind={row.kind} />
		</>
	);
}

/** Frontmatter field comparison: changed fields first, the rest folded. */
export function FieldTable({ rows }: { rows: FieldRow[] }) {
	const tx = reviewText();
	const [showAll, setShowAll] = useState(false);
	const changed = rows.filter((r) => r.changed);
	const same = rows.filter((r) => !r.changed);
	const shown = showAll ? [...changed, ...same] : changed;
	if (!rows.length) return null;
	return (
		<div className="overflow-hidden rounded-md border text-xs">
			<div className="grid grid-cols-[minmax(6rem,auto)_minmax(0,1fr)_minmax(0,1fr)]">
				{shown.map((r) => (
					<FieldLine key={r.key} row={r} />
				))}
			</div>
			{same.length > 0 && (
				<button
					type="button"
					onClick={() => setShowAll((v) => !v)}
					className="flex w-full items-center gap-1.5 border-t bg-muted/30 px-2 py-0.5 text-left text-muted-foreground hover:bg-muted"
				>
					<ChevronsUpDownIcon className="size-3" />
					{tx.unchangedFields(same.length)}
				</button>
			)}
		</div>
	);
}

function stripKey(block: string | null): string {
	if (block == null) return "";
	return block.replace(/^[^:]*:\s?/, "").replace(/^\n/, "");
}

function FieldLine({ row }: { row: FieldRow }) {
	const tx = reviewText();
	return (
		<>
			<div className="border-b border-r bg-muted/30 px-2 py-1 font-mono font-medium">
				{row.key}
			</div>
			<div
				className={cn(
					"min-w-0 whitespace-pre-wrap break-words border-b border-r px-2 py-1 font-mono",
					row.changed && row.before != null && "bg-red-500/10",
					row.before == null && "text-muted-foreground",
				)}
			>
				{row.before == null ? "—" : stripKey(row.before)}
			</div>
			<div
				className={cn(
					"min-w-0 whitespace-pre-wrap break-words border-b px-2 py-1 font-mono",
					row.changed && row.after != null && "bg-emerald-500/10",
					row.after == null && "text-muted-foreground italic",
				)}
			>
				{row.after == null ? tx.removed : stripKey(row.after)}
			</div>
		</>
	);
}

/** Colored `diff -u` text from kb_merge.R --show. */
export function UnifiedDiff({ text }: { text: string }) {
	const lines = useMemo(() => classifyUnified(text), [text]);
	return (
		<pre className="overflow-x-auto rounded-md border bg-muted/20 p-2 font-mono text-xs leading-5">
			{lines.map((l, i) => (
				<div
					// biome-ignore lint/suspicious/noArrayIndexKey: lines are positional
					key={i}
					className={cn(
						"whitespace-pre-wrap break-words",
						l.kind === "add" &&
							"bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
						l.kind === "del" && "bg-red-500/10 text-red-800 dark:text-red-300",
						l.kind === "hunk" && "text-sky-700 dark:text-sky-300",
						l.kind === "meta" && "text-muted-foreground",
					)}
				>
					{l.text || " "}
				</div>
			))}
		</pre>
	);
}
