import { CheckIcon, DicesIcon, RefreshCwIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useStore } from "zustand";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/core/utils";
import type { KbBase } from "./api";
import { UnifiedDiff } from "./diff-view";
import {
	domainStore,
	loadAudit,
	loadCommit,
	markAudit,
	sampleAudit,
} from "./domain-store";
import { reviewText } from "./i18n";
import type { AuditStats } from "./model";
import { Chip } from "./proposal-detail";

const pct = (x: number | null) =>
	x == null ? "–" : `${(100 * x).toFixed(1)}%`;

function StatsTable({ stats }: { stats: AuditStats }) {
	const tx = reviewText();
	return (
		<div className="flex flex-col gap-1">
			<div className="text-xs text-muted-foreground">
				{tx.auditTarget(Math.round(stats.target * 100))}
			</div>
			<table className="w-full text-xs tabular-nums">
				<thead className="text-muted-foreground">
					<tr className="text-left">
						<th className="font-normal">{tx.auditRule}</th>
						<th className="text-right font-normal">{tx.auditMerged}</th>
						<th className="text-right font-normal">{tx.auditAudited}</th>
						<th className="text-right font-normal">{tx.auditWrong}</th>
						<th className="text-right font-normal">{tx.auditRate}</th>
						<th className="text-right font-normal">{tx.auditUpper}</th>
					</tr>
				</thead>
				<tbody>
					{stats.rules.map((r) => (
						<tr
							key={r.rule}
							className={cn(
								r.errorRate != null &&
									r.errorRate > stats.target &&
									"text-red-700 dark:text-red-300",
							)}
						>
							<td>
								{tx.routeRule[r.rule] ?? r.rule}
								{r.disabled && (
									<Chip className="ml-1 border-red-500/40 text-red-700 dark:text-red-300">
										{tx.auditDisabled}
									</Chip>
								)}
							</td>
							<td className="text-right">{r.autoMerged}</td>
							<td className="text-right">{r.audited}</td>
							<td className="text-right">{r.wrong}</td>
							<td className="text-right">{pct(r.errorRate)}</td>
							<td className="text-right">{pct(r.upper95)}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

/**
 * Spot checks of auto-merged proposals (`kb_audit.R`): sample per rule, look
 * at the merge commit, judge it. "Wrong" can revert the merge, which sends the
 * proposal back to the inbox for a human decision.
 */
export function AuditView({ base }: { base: KbBase }) {
	const tx = reviewText();
	const s = useStore(domainStore);
	const [note, setNote] = useState("");
	const [revert, setRevert] = useState(true);

	// biome-ignore lint/correctness/useExhaustiveDependencies: reload when the selected base changes
	useEffect(() => {
		if (base.hasDomain) void loadAudit();
	}, [base.dir, base.hasDomain]);

	if (!base.hasDomain)
		return (
			<div className="p-4 text-sm text-muted-foreground">{tx.noDomain}</div>
		);

	const focused = s.queue.find((q) => q.id === s.auditFocus) ?? null;
	const sampled = s.notice?.startsWith("sampled:")
		? Number(s.notice.slice(8))
		: null;

	return (
		<div className="flex min-h-0 flex-1">
			<div className="flex w-[22rem] min-w-[16rem] shrink-0 flex-col border-r">
				<div className="flex flex-col gap-2 border-b p-2">
					<div className="flex items-center gap-1">
						<span className="text-sm font-medium">{tx.auditTitle}</span>
						{(s.auditLoading || s.auditBusy) && (
							<Spinner className="size-3.5" />
						)}
						<Button
							size="xs"
							variant="outline"
							className="ml-auto"
							disabled={s.auditBusy}
							title={tx.auditSampleHint}
							onClick={() => void sampleAudit()}
						>
							<DicesIcon />
							{tx.auditSample}
						</Button>
						<Button
							size="icon-sm"
							variant="ghost"
							title={tx.refresh}
							onClick={() => void loadAudit()}
						>
							<RefreshCwIcon />
						</Button>
					</div>
					{sampled != null && (
						<div className="text-xs text-muted-foreground">
							{tx.auditSampled(sampled)}
						</div>
					)}
					{s.stats && <StatsTable stats={s.stats} />}
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto">
					{s.queue.length ? (
						s.queue.map((q) => (
							<button
								key={q.id}
								type="button"
								onClick={() => void loadCommit(q.id)}
								className={cn(
									"flex w-full flex-col gap-0.5 border-l-2 border-transparent px-2 py-1.5 text-left hover:bg-muted/50",
									q.id === s.auditFocus && "border-l-primary bg-muted",
								)}
							>
								<span
									className="truncate font-mono text-xs"
									title={q.target ?? ""}
								>
									{q.target ?? q.id}
								</span>
								<span className="flex items-center gap-1">
									<Chip className="border-sky-500/40 text-sky-700 dark:text-sky-300">
										{tx.routeRule[q.rule ?? ""] ?? q.rule ?? "?"}
									</Chip>
									<span className="truncate text-[11px] text-muted-foreground">
										{q.why ?? q.rationale ?? ""}
									</span>
								</span>
							</button>
						))
					) : (
						<div className="p-4 text-sm text-muted-foreground">
							{s.auditLoading ? <Spinner /> : tx.auditEmpty}
						</div>
					)}
				</div>
			</div>

			<div className="flex min-w-0 flex-1 flex-col">
				{s.error && (
					<pre className="whitespace-pre-wrap border-b bg-destructive/10 px-3 py-1.5 text-xs">
						{s.error}
					</pre>
				)}
				{focused ? (
					<>
						<div className="flex flex-col gap-1 border-b px-4 py-3 text-xs">
							<div className="flex items-center gap-2">
								<span className="font-mono text-sm">{focused.target}</span>
								<span className="ml-auto font-mono text-muted-foreground">
									{focused.id}
								</span>
							</div>
							{focused.rationale && <div>{focused.rationale}</div>}
							{focused.decidedAt && (
								<div className="text-muted-foreground">
									{tx.auditCommit}: {focused.commit?.slice(0, 10) ?? "–"} ·{" "}
									{focused.decidedAt.replace("T", " ")}
								</div>
							)}
						</div>
						<div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
							{s.commitText?.id === focused.id ? (
								<UnifiedDiff text={s.commitText.text} />
							) : (
								<Spinner />
							)}
						</div>
						<div className="flex flex-wrap items-center gap-2 border-t px-4 py-2">
							<Input
								value={note}
								onChange={(e) => setNote(e.target.value)}
								placeholder={tx.auditNote}
								className="h-7 min-w-48 flex-1 text-xs"
							/>
							<label
								className="flex items-center gap-1 text-xs"
								htmlFor="kb-audit-revert"
							>
								<Checkbox
									id="kb-audit-revert"
									checked={revert}
									onCheckedChange={(v) => setRevert(v === true)}
								/>
								{tx.auditRevert}
							</label>
							<Button
								size="sm"
								disabled={s.auditBusy}
								onClick={() => {
									void markAudit(focused.id, "ok", note, false).then(() =>
										setNote(""),
									);
								}}
							>
								<CheckIcon />
								{tx.auditOk}
							</Button>
							<Button
								size="sm"
								variant="destructive"
								disabled={s.auditBusy}
								onClick={() => {
									void markAudit(focused.id, "wrong", note, revert).then(() =>
										setNote(""),
									);
								}}
							>
								<XIcon />
								{tx.auditWrongBtn}
							</Button>
						</div>
					</>
				) : (
					<div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
						{tx.auditEmpty}
					</div>
				)}
			</div>
		</div>
	);
}
