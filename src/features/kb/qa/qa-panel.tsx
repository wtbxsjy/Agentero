/**
 * Q&A tab of the KB rail: ask the knowledge base (kb-rag `POST /ask`,
 * multi-hop over wikilinks), read the answer with clickable `[n]`
 * citations and the retrieval trace, and save the answer as a proposal
 * (`kb_merge.R --submit`, routed like any other proposal).
 */

import {
	FilePlus2Icon,
	InboxIcon,
	MessageSquareTextIcon,
	RefreshCwIcon,
} from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { notifyError } from "@/lib/core/notify";
import { cn } from "@/lib/core/utils";
import { openCitation } from "@/lib/workspace/actions";
import { KbRagError, kbAsk } from "../client";
import { kbText } from "../i18n";
import { MergeFailed, runMerge } from "../review/api";
import { openEvidence } from "../review/evidence";
import { openKbReview } from "../review/inbox-rail";
import { joinBase } from "../review/proposal-detail";
import { loadBases, reload, reviewStore, selectBase } from "../review/store";
import { toVaultRel } from "../sources";
import {
	ASK_LEVELS,
	type AskCitation,
	type AskLevel,
	type AskResult,
	lastJson,
	pageReach,
	type SubmitResult,
	segmentAnswer,
} from "./model";

type Saved = { id: string; autoRule: string | null };

export function KbAskPanel({
	vaultPath,
	className,
}: {
	vaultPath: string | null;
	className?: string;
}) {
	useTranslation();
	const tx = kbText();
	const bases = useStore(reviewStore, (s) => s.bases);
	const baseDir = useStore(reviewStore, (s) => s.baseDir);
	const base = bases.find((b) => b.dir === baseDir) ?? null;
	const [question, setQuestion] = useState("");
	const [level, setLevel] = useState<AskLevel>("multihop");
	const [hops, setHops] = useState(2);
	const [busy, setBusy] = useState(false);
	const [offline, setOffline] = useState(false);
	const [result, setResult] = useState<AskResult | null>(null);
	const [saving, setSaving] = useState(false);
	const [saved, setSaved] = useState<Saved | null>(null);

	useEffect(() => {
		void loadBases(vaultPath);
	}, [vaultPath]);

	async function ask(e?: FormEvent) {
		e?.preventDefault();
		const q = question.trim();
		if (!base || !q || busy) return;
		setBusy(true);
		setSaved(null);
		try {
			setResult(await kbAsk({ kb: base.dir, q, level, hops }));
			setOffline(false);
		} catch (err) {
			if (err instanceof KbRagError && err.offline) setOffline(true);
			else notifyError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(false);
		}
	}

	async function save() {
		if (!base || !result || saving) return;
		setSaving(true);
		try {
			const out = await runMerge(
				base.dir,
				{ action: "submit", draft: JSON.stringify(result.draft) },
				{ allowFail: true },
			);
			const r = lastJson<SubmitResult>(out.stdout);
			if (!r?.ok || !r.id)
				throw new Error(
					r?.error ?? (out.stderr || out.stdout).trim().split("\n").pop(),
				);
			setSaved({
				id: r.id,
				autoRule: r.route?.mode === "auto" ? (r.route.rule ?? "auto") : null,
			});
			void reload({ force: true });
		} catch (err) {
			notifyError(
				err instanceof MergeFailed || err instanceof Error
					? err.message
					: String(err),
			);
		} finally {
			setSaving(false);
		}
	}

	function openPage(rel: string) {
		if (!base) return;
		const vrel = toVaultRel(joinBase(base.dir, rel), vaultPath);
		if (vrel) openCitation(vrel);
		else notifyError(`${tx.openFailed}: ${rel}`);
	}

	if (!vaultPath || !bases.length) {
		return (
			<div className={cn("p-4 text-sm text-muted-foreground", className)}>
				{tx.askNoBase}
			</div>
		);
	}

	return (
		<div className={cn("flex min-h-0 flex-col", className)}>
			<form onSubmit={ask} className="flex flex-col gap-2 border-b p-3">
				<Textarea
					value={question}
					onChange={(e) => setQuestion(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void ask();
					}}
					placeholder={tx.askPlaceholder}
					className="min-h-16 text-sm"
				/>
				<div className="flex items-center gap-2">
					{bases.length > 1 && (
						<Select
							value={baseDir ?? ""}
							onValueChange={(v) => v && void selectBase(v)}
						>
							<SelectTrigger
								size="sm"
								className="min-w-0 flex-1"
								title={tx.askBase}
							>
								<SelectValue>{base?.name}</SelectValue>
							</SelectTrigger>
							<SelectContent>
								{bases.map((b) => (
									<SelectItem key={b.dir} value={b.dir}>
										{b.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					)}
					<Select
						value={level}
						onValueChange={(v) => v && setLevel(v as AskLevel)}
					>
						<SelectTrigger size="sm" className="w-24" title={tx.askLevel}>
							<SelectValue>{tx.askLevels[level]}</SelectValue>
						</SelectTrigger>
						<SelectContent>
							{ASK_LEVELS.map((l) => (
								<SelectItem key={l} value={l}>
									{tx.askLevels[l]}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					{level === "multihop" && (
						<Select
							value={String(hops)}
							onValueChange={(v) => v && setHops(Number(v))}
						>
							<SelectTrigger size="sm" className="w-16" title={tx.askHops}>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{[1, 2, 3].map((h) => (
									<SelectItem key={h} value={String(h)}>
										{h}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					)}
					<Button
						type="submit"
						size="sm"
						className="ml-auto"
						disabled={busy || !base || !question.trim()}
						title={tx.askCost}
					>
						{busy ? <Spinner /> : <MessageSquareTextIcon />}
						{tx.askSubmit}
					</Button>
				</div>
			</form>

			<ScrollArea className="min-h-0 flex-1">
				<div className="flex flex-col gap-3 p-3 text-sm">
					{offline && (
						<div className="flex flex-col gap-2 text-xs">
							<div className="text-muted-foreground">{tx.askOffline}</div>
							<code className="rounded-md bg-muted p-2 break-all">
								KB_RAG_ROOTS={vaultPath}/kb bash kb-template/mcp/run.sh --http
								127.0.0.1:8766
							</code>
							<Button size="xs" variant="outline" onClick={() => void ask()}>
								<RefreshCwIcon />
								{tx.retry}
							</Button>
						</div>
					)}
					{!result && !offline && (
						<div className="text-xs text-muted-foreground">{tx.askCost}</div>
					)}
					{result && (
						<AnswerView
							result={result}
							onOpenPage={openPage}
							onOpenEvidence={(c, i) =>
								base && void openEvidence(base.dir, vaultPath, c.evidence[i])
							}
						/>
					)}
					{result && (
						<div className="flex flex-col gap-1.5 border-t pt-3">
							{saved ? (
								<div className="flex flex-col gap-1 text-xs">
									<span>{tx.askSaved(saved.id)}</span>
									{saved.autoRule && (
										<span className="text-muted-foreground">
											{tx.askSavedAuto(saved.autoRule)}
										</span>
									)}
									<Button
										size="xs"
										variant="outline"
										className="self-start"
										onClick={() => openKbReview(saved.id)}
									>
										<InboxIcon />
										{tx.askOpenInbox}
									</Button>
								</div>
							) : (
								<>
									<Button
										size="sm"
										variant="outline"
										className="self-start"
										disabled={saving || !base?.hasMerge || !result.answer}
										title={tx.askSaveHint}
										onClick={() => void save()}
									>
										{saving ? <Spinner /> : <FilePlus2Icon />}
										{tx.askSave}
									</Button>
									{!base?.hasMerge && (
										<span className="text-xs text-muted-foreground">
											{tx.askNeedsMerge}
										</span>
									)}
								</>
							)}
						</div>
					)}
				</div>
			</ScrollArea>
		</div>
	);
}

function AnswerView({
	result,
	onOpenPage,
	onOpenEvidence,
}: {
	result: AskResult;
	onOpenPage: (rel: string) => void;
	onOpenEvidence: (c: AskCitation, i: number) => void;
}) {
	const tx = kbText();
	const parts = segmentAnswer(result.answer, result.citations);
	const cited = new Map(result.citations.map((c) => [c.n, c]));
	const ms = (result.elapsed_ms?.retrieve ?? 0) + (result.elapsed_ms?.llm ?? 0);
	return (
		<div className="flex flex-col gap-3">
			{result.insufficient && (
				<div className="rounded-md bg-amber-500/10 px-2 py-1 text-xs">
					{tx.askInsufficient}
				</div>
			)}
			<div className="leading-relaxed whitespace-pre-wrap">
				{parts.map((p, i) =>
					p.kind === "text" ? (
						// biome-ignore lint/suspicious/noArrayIndexKey: static segments
						<span key={i}>{p.text}</span>
					) : (
						<button
							// biome-ignore lint/suspicious/noArrayIndexKey: static segments
							key={i}
							type="button"
							disabled={!p.citation}
							title={p.citation?.title}
							onClick={() => p.citation && onOpenPage(p.citation.path)}
							className={cn(
								"mx-0.5 rounded bg-muted px-1 align-baseline font-mono text-[11px]",
								p.citation
									? "text-primary hover:bg-muted/70"
									: "text-destructive line-through",
							)}
						>
							{p.n}
						</button>
					),
				)}
			</div>
			<div className="text-[11px] text-muted-foreground">
				{tx.askConfidence(result.confidence)} ·{" "}
				{tx.askMeta(result.created_by.model, result.created_by.prompt_hash, ms)}
			</div>
			{result.invalid_citations.length > 0 && (
				<div className="text-xs text-destructive">
					{tx.askInvalidCites(result.invalid_citations)}
				</div>
			)}
			{cited.size > 0 && (
				<div className="flex flex-col gap-1">
					<div className="text-xs font-medium">{tx.askCitations}</div>
					{[...cited.values()].map((c) => (
						<div
							key={c.n}
							className="flex flex-wrap items-center gap-1 text-xs"
						>
							<span className="font-mono text-muted-foreground">[{c.n}]</span>
							<button
								type="button"
								onClick={() => onOpenPage(c.path)}
								className="min-w-0 truncate text-left hover:underline"
								title={c.path}
							>
								{c.title} ¶{c.para}
							</button>
							{c.evidence.map((ev, i) => (
								<button
									key={`${ev.source}-${ev.locator ?? i}`}
									type="button"
									onClick={() => onOpenEvidence(c, i)}
									className="rounded-full border px-1.5 text-[11px] text-muted-foreground hover:bg-muted/60"
								>
									{ev.source}
									{ev.locator ? ` ${ev.locator}` : ""}
								</button>
							))}
						</div>
					))}
				</div>
			)}
			<details className="text-xs">
				<summary className="cursor-pointer text-muted-foreground">
					{tx.askTrace} ({result.retrieval.pages.length})
				</summary>
				<div className="mt-1 flex flex-col gap-0.5">
					{result.retrieval.pages.map((p) => (
						<button
							key={p.id}
							type="button"
							onClick={() => onOpenPage(p.path)}
							className="flex items-center gap-2 rounded px-1 text-left hover:bg-muted/60"
							title={pageReach(p)}
						>
							<span className="w-12 shrink-0 text-muted-foreground">
								{tx.askTraceHop(p.hop)}
							</span>
							<span className="min-w-0 flex-1 truncate">{p.title}</span>
							<span className="tabular-nums text-muted-foreground">
								{p.score.toFixed(2)}
							</span>
						</button>
					))}
				</div>
			</details>
		</div>
	);
}
