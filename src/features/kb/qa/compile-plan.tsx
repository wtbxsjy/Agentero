/**
 * Compile plan card (the "plan before running" card from P2): lists what
 * `kb_compile.R` would compile, with rough token estimates and the per-run
 * budget; the reviewer ticks sources and only those are compiled (`--ids`).
 */

import { HammerIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { notifyError, notifySuccess } from "@/lib/core/notify";
import { cn } from "@/lib/core/utils";
import { type KbBase, runCompile } from "../review/api";
import { reviewText } from "../review/i18n";
import { reload } from "../review/store";
import {
	type CompilePlan,
	defaultPicks,
	parseCompilePlan,
	planSelection,
} from "./model";

export function CompilePlanCard({
	base,
	onDone,
	className,
}: {
	base: KbBase;
	onDone: () => void;
	className?: string;
}) {
	useTranslation();
	const tx = reviewText();
	const [plan, setPlan] = useState<CompilePlan | null>(null);
	const [picked, setPicked] = useState<Set<string>>(new Set());
	const [loading, setLoading] = useState(false);
	const [running, setRunning] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const out = await runCompile(base.dir, { action: "plan" });
			const p = parseCompilePlan(out.stdout);
			if (!p) throw new Error(out.stdout.trim().split("\n").pop() || "plan");
			setPlan(p);
			setPicked(defaultPicks(p));
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setLoading(false);
		}
	}, [base.dir]);

	useEffect(() => {
		void load();
	}, [load]);

	const sel = plan ? planSelection(plan, picked) : null;

	async function run() {
		if (!sel?.ids.length || running) return;
		setRunning(true);
		try {
			await runCompile(base.dir, { action: "run", ids: sel.ids });
			notifySuccess(tx.compileDone);
			await reload({ force: true });
			onDone();
		} catch (e) {
			notifyError(e instanceof Error ? e.message : String(e));
			void load();
		} finally {
			setRunning(false);
		}
	}

	function toggle(id: string, on: boolean) {
		setPicked((cur) => {
			const next = new Set(cur);
			if (on) next.add(id);
			else next.delete(id);
			return next;
		});
	}

	return (
		<div className={cn("flex min-h-0 flex-col", className)}>
			<div className="flex flex-col gap-1.5 border-b p-3 text-xs">
				<div className="flex items-center gap-2">
					<span className="text-sm font-medium">{tx.compileTitle}</span>
					<Button
						size="icon-sm"
						variant="ghost"
						className="ml-auto"
						title={tx.refresh}
						disabled={loading || running}
						onClick={() => void load()}
					>
						{loading ? <Spinner /> : <RefreshCwIcon />}
					</Button>
					<Button size="xs" variant="ghost" onClick={onDone}>
						{tx.compileBack}
					</Button>
				</div>
				<span className="text-muted-foreground">{tx.compileHint}</span>
				{plan && (
					<span className="text-muted-foreground">
						{tx.compileModel(plan.provider, plan.model)}
						{plan.budget &&
							` · ${tx.compileBudget(plan.budget.pages, plan.budget.tokens)}`}
					</span>
				)}
			</div>
			<ScrollArea className="min-h-0 flex-1">
				<div className="flex flex-col p-2 text-xs">
					{error && (
						<div className="rounded-md bg-destructive/10 p-2 whitespace-pre-wrap">
							{error}
						</div>
					)}
					{plan && !plan.queue.length && (
						<div className="p-2 text-muted-foreground">{tx.compileEmpty}</div>
					)}
					{plan?.queue.map((q) => (
						<div
							key={q.id}
							className="flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-muted/60"
						>
							<Checkbox
								id={`kb-plan-${q.id}`}
								checked={picked.has(q.id)}
								disabled={running}
								onCheckedChange={(v) => toggle(q.id, v === true)}
								className="mt-0.5"
							/>
							<label
								htmlFor={`kb-plan-${q.id}`}
								className="flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5"
							>
								<span className="truncate font-medium" title={q.path}>
									{q.title || q.id}
								</span>
								<span className="truncate text-muted-foreground">
									{q.id}
									{q.source_type ? ` · ${q.source_type}` : ""}
									{q.status ? ` · ${q.status}` : ""}
									{q.est_tokens != null
										? ` · ${tx.compileEst(q.est_tokens)}`
										: ""}
								</span>
							</label>
						</div>
					))}
					{plan && plan.undecided > 0 && (
						<div className="p-2 text-muted-foreground">
							{tx.compileUndecided(plan.undecided)}
						</div>
					)}
				</div>
			</ScrollArea>
			{plan && plan.queue.length > 0 && sel && (
				<div className="flex flex-col gap-1.5 border-t p-3 text-xs">
					<span className="text-muted-foreground">
						{tx.compileEst(sel.tokens)}
					</span>
					{sel.overBudget && (
						<span className="text-amber-600">{tx.compileOverBudget}</span>
					)}
					{running && (
						<span className="text-muted-foreground">{tx.compileRunning}</span>
					)}
					<Button
						size="sm"
						disabled={running || !sel.ids.length}
						onClick={() => void run()}
					>
						{running ? <Spinner /> : <HammerIcon />}
						{tx.compileRun(sel.ids.length)}
					</Button>
				</div>
			)}
		</div>
	);
}
