import {
	AlertTriangleIcon,
	CheckIcon,
	ExternalLinkIcon,
	FileTextIcon,
	PencilIcon,
	XIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/core/utils";
import { openPath } from "@/lib/workspace/actions";
import { toVaultRel } from "../sources";
import {
	type EvidenceTarget,
	type KbBase,
	readBaseFile,
	runMerge,
} from "./api";
import { FieldTable, SideBySideDiff, UnifiedDiff } from "./diff-view";
import { openEvidence, resolveEvidenceCached } from "./evidence";
import { fieldRows, splitFrontmatter } from "./frontmatter";
import { reviewText } from "./i18n";
import type { Evidence, Level, Proposal, ProposalPatch } from "./model";

export const RISK_STYLE: Record<Level, string> = {
	high: "border-red-500/40 text-red-700 dark:text-red-300",
	medium: "border-amber-500/40 text-amber-700 dark:text-amber-300",
	low: "border-emerald-500/40 text-emerald-700 dark:text-emerald-300",
};

export function Chip({
	className,
	children,
	title,
}: {
	className?: string;
	children: React.ReactNode;
	title?: string;
}) {
	return (
		<span
			title={title}
			className={cn(
				"inline-flex h-5 shrink-0 items-center gap-1 rounded-full border px-1.5 text-[11px] leading-none",
				className,
			)}
		>
			{children}
		</span>
	);
}

export function joinBase(dir: string, rel: string): string {
	return `${dir.replace(/\\/g, "/").replace(/\/+$/, "")}/${rel}`;
}

/** Current target text, re-read whenever the inbox reloads. */
function useTargetText(base: KbBase, target: string, revision: number) {
	const [state, setState] = useState<{
		key: string;
		text: string | null;
		loading: boolean;
		error: string | null;
	}>({ key: "", text: null, loading: true, error: null });
	const key = `${base.dir}\u0000${target}\u0000${revision}`;
	useEffect(() => {
		let alive = true;
		setState((s) => ({ ...s, key, loading: true, error: null }));
		readBaseFile(base.dir, target)
			.then((text) => {
				if (alive) setState({ key, text, loading: false, error: null });
			})
			.catch((e) => {
				if (alive)
					setState({
						key,
						text: null,
						loading: false,
						error: e instanceof Error ? e.message : String(e),
					});
			});
		return () => {
			alive = false;
		};
	}, [base.dir, target, key]);
	return state.key === key ? state : { ...state, loading: true };
}

function EvidenceItem({
	index,
	ev,
	base,
	vaultPath,
}: {
	index: number;
	ev: Evidence;
	base: KbBase;
	vaultPath: string | null;
}) {
	const tx = reviewText();
	const [target, setTarget] = useState<EvidenceTarget | null>(null);
	const [opening, setOpening] = useState(false);
	useEffect(() => {
		let alive = true;
		setTarget(null);
		resolveEvidenceCached(base.dir, ev)
			.then((t) => alive && setTarget(t))
			.catch(() => {});
		return () => {
			alive = false;
		};
	}, [base.dir, ev]);
	const text = ev.quote ?? target?.text ?? null;
	return (
		<button
			type="button"
			disabled={opening}
			onClick={async () => {
				setOpening(true);
				try {
					await openEvidence(base.dir, vaultPath, ev);
				} finally {
					setOpening(false);
				}
			}}
			className="group flex w-full gap-2 rounded-md border p-2 text-left hover:bg-muted/60"
		>
			<span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded bg-amber-500/15 font-mono text-[11px] text-amber-700 dark:text-amber-300">
				{index}
			</span>
			<span className="flex min-w-0 flex-1 flex-col gap-1">
				<span className="flex min-w-0 items-center gap-1.5 text-xs">
					<span className="truncate font-medium">
						{target?.rawTitle ?? ev.source}
					</span>
					{ev.locator && (
						<Chip className="border-amber-500/40 text-amber-700 dark:text-amber-300">
							{ev.locator}
						</Chip>
					)}
					<span className="ml-auto inline-flex shrink-0 items-center gap-1 text-muted-foreground opacity-0 group-hover:opacity-100">
						{opening ? (
							<Spinner className="size-3" />
						) : (
							<ExternalLinkIcon className="size-3" />
						)}
						{target?.pdfPath ? tx.evidenceOpen : ""}
					</span>
				</span>
				{text ? (
					<span className="line-clamp-4 text-xs text-muted-foreground">
						{text}
					</span>
				) : target ? null : (
					<span className="text-xs text-muted-foreground/70">
						{tx.evidenceLoading}
					</span>
				)}
			</span>
		</button>
	);
}

function prettyJson(v: unknown): string {
	return JSON.stringify(v ?? {}, null, 2);
}

type Draft = { body: string; meta: string };

function draftOf(p: Proposal): Draft {
	const page =
		p.kind === "new_page" ||
		p.kind === "edit_page" ||
		p.kind === "merge_entity";
	return {
		body: p.patch.body ?? "",
		meta: prettyJson(page ? p.patch.frontmatter : p.patch.set),
	};
}

/** Draft → patch, or an error string when the JSON does not parse. */
function patchOf(p: Proposal, d: Draft): ProposalPatch | string {
	let meta: unknown;
	try {
		meta = JSON.parse(d.meta);
	} catch {
		return reviewText().badJson;
	}
	if (!meta || typeof meta !== "object" || Array.isArray(meta))
		return reviewText().badJson;
	const page =
		p.kind === "new_page" ||
		p.kind === "edit_page" ||
		p.kind === "merge_entity";
	return page
		? { frontmatter: meta as Record<string, unknown>, body: d.body }
		: { set: meta as Record<string, unknown> };
}

export type DetailProps = {
	proposal: Proposal;
	base: KbBase;
	vaultPath: string | null;
	revision: number;
	fresh: boolean | undefined;
	busy: boolean;
	editing: boolean;
	onEditingChange: (editing: boolean) => void;
	onAccept: () => void;
	onReject: () => void;
	onSaveEdit: (patch: ProposalPatch, andAccept: boolean) => Promise<boolean>;
};

export function ProposalDetail({
	proposal: p,
	base,
	vaultPath,
	revision,
	fresh,
	busy,
	editing,
	onEditingChange,
	onAccept,
	onReject,
	onSaveEdit,
}: DetailProps) {
	const tx = reviewText();
	const current = useTargetText(base, p.target, revision);
	const [mode, setMode] = useState<"client" | "merger">("client");
	const [merger, setMerger] = useState<{ id: string; text: string } | null>(
		null,
	);
	const [mergerErr, setMergerErr] = useState<string | null>(null);
	const [draft, setDraft] = useState<Draft>(() => draftOf(p));
	const [saving, setSaving] = useState(false);

	// Reset per proposal (and when the file on disk changes).
	// biome-ignore lint/correctness/useExhaustiveDependencies: keyed on identity
	useEffect(() => {
		setDraft(draftOf(p));
		setMerger(null);
		setMergerErr(null);
	}, [p.id, p.raw]);

	useEffect(() => {
		if (mode !== "merger" || merger?.id === p.id || !base.hasMerge) return;
		let alive = true;
		setMergerErr(null);
		runMerge(base.dir, { action: "show", id: p.id })
			.then((out) => {
				if (!alive) return;
				// --show prints the header, a blank line, then the diff.
				const i = out.stdout.search(/^(--- |\(无差异\)|\(目标不存在\))/m);
				setMerger({
					id: p.id,
					text: i >= 0 ? out.stdout.slice(i) : out.stdout,
				});
			})
			.catch(
				(e) =>
					alive && setMergerErr(e instanceof Error ? e.message : String(e)),
			);
		return () => {
			alive = false;
		};
	}, [mode, merger?.id, p.id, base.dir, base.hasMerge]);

	const isPage =
		p.kind === "new_page" ||
		p.kind === "edit_page" ||
		p.kind === "merge_entity";
	const cur = useMemo(() => splitFrontmatter(current.text), [current.text]);
	const draftPatch = editing ? patchOf(p, draft) : null;
	const effective: ProposalPatch =
		draftPatch && typeof draftPatch !== "string" ? draftPatch : p.patch;
	const rows = useMemo(
		() =>
			fieldRows(
				cur.frontmatter,
				isPage ? effective.frontmatter : effective.set,
				isPage,
			),
		[cur.frontmatter, effective.frontmatter, effective.set, isPage],
	);

	const targetAbs = joinBase(base.dir, p.target);
	const targetInVault = toVaultRel(targetAbs, vaultPath) != null;

	async function save(andAccept: boolean) {
		const patch = patchOf(p, draft);
		if (typeof patch === "string") return;
		setSaving(true);
		try {
			if (await onSaveEdit(patch, andAccept)) onEditingChange(false);
		} finally {
			setSaving(false);
		}
	}

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			{/* header */}
			<div className="flex flex-col gap-2 border-b px-4 py-3">
				<div className="flex flex-wrap items-center gap-1.5">
					<Chip className="border-border">{tx.kind[p.kind]}</Chip>
					<Chip className={RISK_STYLE[p.risk]} title={tx.riskLabel}>
						{tx.riskLabel} {tx.risk[p.risk]}
					</Chip>
					{p.confidence && (
						<Chip
							className="border-border text-muted-foreground"
							title={tx.confidence}
						>
							{tx.confidence} {tx.risk[p.confidence]}
						</Chip>
					)}
					{fresh === false && (
						<Chip className="border-amber-500/50 text-amber-700 dark:text-amber-300">
							<AlertTriangleIcon className="size-3" />
							{tx.stale}
						</Chip>
					)}
					<span className="ml-auto font-mono text-[11px] text-muted-foreground">
						{p.id}
					</span>
				</div>
				<div className="flex min-w-0 items-center gap-2">
					<FileTextIcon className="size-4 shrink-0 text-emerald-600" />
					<span className="min-w-0 truncate font-mono text-sm" title={p.target}>
						{p.target}
					</span>
					{current.text == null && !current.loading && (
						<Chip className="border-emerald-500/40 text-emerald-700 dark:text-emerald-300">
							{tx.newPage}
						</Chip>
					)}
					{current.text != null && targetInVault && (
						<Button
							size="xs"
							variant="ghost"
							onClick={() => openPath(targetAbs)}
							title={tx.openTarget}
						>
							<ExternalLinkIcon />
							{tx.openTarget}
						</Button>
					)}
				</div>
				<div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
					<span>
						{tx.generated}: {p.createdAt.replace("T", " ")} · {p.tool}
						{p.pass ? ` / ${p.pass}` : ""}
						{p.model ? ` · ${p.model}` : ""}
					</span>
					{p.sourceIds.length > 0 && (
						<span className="min-w-0 truncate" title={p.sourceIds.join(", ")}>
							{tx.sources}: {p.sourceIds.join(", ")}
						</span>
					)}
				</div>
				{p.rationale && (
					<div className="rounded-md bg-muted/50 px-2.5 py-1.5 text-sm">
						<span className="mr-1.5 text-xs text-muted-foreground">
							{tx.rationale}
						</span>
						{p.rationale}
					</div>
				)}
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="flex flex-col gap-4 px-4 py-3">
					{/* evidence */}
					<section className="flex flex-col gap-1.5">
						<h3 className="text-xs font-medium text-muted-foreground">
							{tx.evidence} ({p.evidence.length})
						</h3>
						{p.evidence.length ? (
							<div className="grid gap-1.5 xl:grid-cols-2">
								{p.evidence.map((ev, i) => (
									<EvidenceItem
										// biome-ignore lint/suspicious/noArrayIndexKey: evidence may repeat; the number is its identity
										key={`${ev.source}-${ev.locator ?? ""}-${i}`}
										index={i + 1}
										ev={ev}
										base={base}
										vaultPath={vaultPath}
									/>
								))}
							</div>
						) : (
							<div className="text-xs text-muted-foreground">
								{tx.noEvidence}
							</div>
						)}
					</section>

					{/* editor */}
					{editing && (
						<section className="flex flex-col gap-2 rounded-md border border-sky-500/40 p-2">
							<div className="text-xs text-muted-foreground">
								{tx.editedNote}
							</div>
							{isPage && (
								<label
									htmlFor={`kb-edit-body-${p.id}`}
									className="flex flex-col gap-1 text-xs"
								>
									{tx.editBody}
									<Textarea
										id={`kb-edit-body-${p.id}`}
										value={draft.body}
										onChange={(e) =>
											setDraft((d) => ({ ...d, body: e.target.value }))
										}
										className="min-h-56 font-mono text-xs"
										spellCheck={false}
									/>
								</label>
							)}
							<label
								htmlFor={`kb-edit-meta-${p.id}`}
								className="flex flex-col gap-1 text-xs"
							>
								{isPage ? tx.editFrontmatter : tx.editSet}
								<Textarea
									id={`kb-edit-meta-${p.id}`}
									value={draft.meta}
									onChange={(e) =>
										setDraft((d) => ({ ...d, meta: e.target.value }))
									}
									className={cn(
										"min-h-32 font-mono text-xs",
										typeof draftPatch === "string" && "border-destructive",
									)}
									spellCheck={false}
								/>
								{typeof draftPatch === "string" && (
									<span className="text-destructive">{draftPatch}</span>
								)}
							</label>
						</section>
					)}

					{/* diff */}
					<section className="flex flex-col gap-1.5">
						<div className="flex items-center gap-1">
							{(["client", "merger"] as const).map((m) => (
								<button
									key={m}
									type="button"
									disabled={m === "merger" && (!base.hasMerge || editing)}
									title={m === "merger" ? tx.diffMergerHint : undefined}
									onClick={() => setMode(m)}
									className={cn(
										"h-6 rounded-md px-2 text-xs disabled:opacity-40",
										mode === m || (editing && m === "client")
											? "bg-muted text-foreground"
											: "text-muted-foreground hover:bg-muted/60",
									)}
								>
									{m === "client" ? tx.diffClient : tx.diffMerger}
								</button>
							))}
						</div>
						{mode === "merger" && !editing ? (
							merger?.id === p.id ? (
								<UnifiedDiff text={merger.text} />
							) : mergerErr ? (
								<pre className="whitespace-pre-wrap text-xs text-destructive">
									{mergerErr}
								</pre>
							) : (
								<div className="flex items-center gap-2 text-xs text-muted-foreground">
									<Spinner className="size-3" />
									{tx.loadingDiff}
								</div>
							)
						) : current.loading ? (
							<div className="flex items-center gap-2 text-xs text-muted-foreground">
								<Spinner className="size-3" />
								{tx.loadingDiff}
							</div>
						) : (
							<>
								{current.error && (
									<div className="text-xs text-destructive">
										{current.error}
									</div>
								)}
								<h3 className="text-xs font-medium text-muted-foreground">
									{tx.fields}
								</h3>
								<FieldTable rows={rows} />
								{isPage && (
									<>
										<h3 className="mt-2 text-xs font-medium text-muted-foreground">
											{tx.body}
										</h3>
										<SideBySideDiff
											before={cur.body}
											after={effective.body ?? ""}
										/>
									</>
								)}
							</>
						)}
					</section>
				</div>
			</div>

			{/* actions */}
			<div className="flex items-center gap-2 border-t px-4 py-2">
				{editing ? (
					<>
						<Button
							size="sm"
							disabled={
								saving ||
								busy ||
								typeof draftPatch === "string" ||
								!base.hasMerge
							}
							onClick={() => void save(true)}
						>
							{saving ? <Spinner /> : <CheckIcon />}
							{tx.acceptEdited}
						</Button>
						<Button
							size="sm"
							variant="outline"
							disabled={saving || typeof draftPatch === "string"}
							onClick={() => void save(false)}
						>
							{tx.saveDraft}
						</Button>
						<Button
							size="sm"
							variant="ghost"
							disabled={saving}
							onClick={() => {
								setDraft(draftOf(p));
								onEditingChange(false);
							}}
						>
							{tx.discard}
						</Button>
					</>
				) : (
					<>
						<Button
							size="sm"
							disabled={busy || !base.hasMerge}
							onClick={onAccept}
						>
							{busy ? <Spinner /> : <CheckIcon />}
							{tx.accept}
							<kbd className="ml-1 text-[10px] opacity-60">A</kbd>
						</Button>
						<Button
							size="sm"
							variant="outline"
							disabled={busy || p.kind === "merge_entity"}
							onClick={() => onEditingChange(true)}
						>
							<PencilIcon />
							{tx.edit}
							<kbd className="ml-1 text-[10px] opacity-60">E</kbd>
						</Button>
						<Button
							size="sm"
							variant="destructive"
							disabled={busy || !base.hasMerge}
							onClick={onReject}
						>
							<XIcon />
							{tx.reject}
							<kbd className="ml-1 text-[10px] opacity-60">R</kbd>
						</Button>
					</>
				)}
			</div>
		</div>
	);
}
