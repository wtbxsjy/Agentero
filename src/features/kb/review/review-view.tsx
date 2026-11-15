import {
	CheckIcon,
	InboxIcon,
	KeyboardIcon,
	RefreshCwIcon,
	RouteIcon,
	SettingsIcon,
	ShieldAlertIcon,
	XIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "zustand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/core/utils";
import { openPath } from "@/lib/workspace/actions";
import { AuditView } from "./audit-view";
import { DedupeView } from "./dedupe-view";
import { clearEvidenceCache, openEvidence } from "./evidence";
import { reviewText } from "./i18n";
import type { Level, ProposalKind } from "./model";
import { joinBase, ProposalDetail, RISK_STYLE } from "./proposal-detail";
import { orderedForKeys, ProposalList } from "./proposal-list";
import { RejectDialog } from "./reject-dialog";
import { reviewSettings, saveReviewSettings } from "./settings";
import {
	accept,
	checkStale,
	clearChecked,
	type DecisionLog,
	dismissDecision,
	filterProposals,
	focus,
	loadBases,
	loadReasons,
	reject,
	reload,
	reviewStore,
	routeNow,
	routeOf,
	saveEdit,
	selectBase,
	setChecked,
	setFilter,
	setGrouping,
	setView,
	toggleChecked,
} from "./store";

function isTypingTarget(t: EventTarget | null): boolean {
	const el = t as HTMLElement | null;
	if (!el) return false;
	const tag = el.tagName;
	return (
		tag === "INPUT" ||
		tag === "TEXTAREA" ||
		tag === "SELECT" ||
		el.isContentEditable ||
		!!el.closest("[role=dialog],[role=listbox],[role=menu]")
	);
}

function DecisionBanner({ log }: { log: DecisionLog }) {
	const tx = reviewText();
	const count = (pred: (s: string) => boolean) =>
		log.results.filter((r) => pred(r.status)).length;
	const ok = count((s) => s === "accepted" || s === "edited");
	const rejected = count((s) => s === "rejected");
	const stale = count((s) => s === "stale");
	const failed = count(
		(s) => !["accepted", "edited", "rejected", "stale", "inbox"].includes(s),
	);
	const inbox = count((s) => s === "inbox");
	const parts =
		log.action === "check"
			? [tx.resultChecked(stale)]
			: log.action === "route"
				? [
						tx.resultRouted(log.results.length - inbox, inbox),
						stale ? tx.resultStale(stale) : null,
					].filter(Boolean)
				: [
						ok ? tx.resultAccepted(ok) : null,
						rejected ? tx.resultRejected(rejected) : null,
						stale ? tx.resultStale(stale) : null,
						failed ? tx.resultFailed(failed) : null,
					].filter(Boolean);
	const problems = log.results.filter((r) => r.msg);
	return (
		<div
			className={cn(
				"flex items-start gap-2 border-b px-3 py-1.5 text-xs",
				log.error || failed
					? "bg-destructive/10"
					: stale
						? "bg-amber-500/10"
						: "bg-emerald-500/10",
			)}
		>
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="font-medium">
					{log.error ? tx.mergeError : parts.join(" · ")}
					{log.results.some((r) => r.commit) && (
						<span className="ml-2 font-mono font-normal text-muted-foreground">
							{log.results
								.map((r) => r.commit)
								.filter(Boolean)
								.slice(0, 4)
								.join(" ")}
						</span>
					)}
				</span>
				{log.error && (
					<pre className="whitespace-pre-wrap text-destructive">
						{log.error}
					</pre>
				)}
				{problems.slice(0, 4).map((r) => (
					<span key={r.id} className="text-muted-foreground">
						<span className="font-mono">{r.id}</span> {r.msg}
					</span>
				))}
			</div>
			<button
				type="button"
				onClick={dismissDecision}
				className="text-muted-foreground"
			>
				<XIcon className="size-3.5" />
			</button>
		</div>
	);
}

function SettingsPopover() {
	const tx = reviewText();
	const [s, setS] = useState(reviewSettings);
	return (
		<Popover onOpenChange={(o) => o && setS(reviewSettings())}>
			<PopoverTrigger asChild>
				<Button size="icon-sm" variant="ghost" title={tx.settings}>
					<SettingsIcon />
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" className="flex w-80 flex-col gap-3 text-xs">
				<label htmlFor="kb-review-rscript" className="flex flex-col gap-1">
					{tx.rscript}
					<Input
						id="kb-review-rscript"
						value={s.rscript}
						placeholder="Rscript"
						onChange={(e) => setS({ ...s, rscript: e.target.value })}
						onBlur={() => saveReviewSettings({ rscript: s.rscript.trim() })}
					/>
					<span className="text-muted-foreground">{tx.rscriptHint}</span>
				</label>
				<label htmlFor="kb-review-template" className="flex flex-col gap-1">
					{tx.template}
					<Input
						id="kb-review-template"
						value={s.template}
						placeholder="/path/to/kb-template"
						onChange={(e) => setS({ ...s, template: e.target.value })}
						onBlur={() => {
							const template = s.template.trim();
							if (template === reviewSettings().template) return;
							saveReviewSettings({ template });
							void loadBases(reviewStore.getState().vaultPath).then(() =>
								reload(),
							);
						}}
					/>
					<span className="text-muted-foreground">{tx.templateHint}</span>
				</label>
				<label htmlFor="kb-review-decider" className="flex flex-col gap-1">
					{tx.decider}
					<Input
						id="kb-review-decider"
						value={s.decider}
						onChange={(e) => setS({ ...s, decider: e.target.value })}
						onBlur={() => saveReviewSettings({ decider: s.decider.trim() })}
					/>
					<span className="text-muted-foreground">{tx.deciderHint}</span>
				</label>
			</PopoverContent>
		</Popover>
	);
}

function ShortcutsPopover() {
	const tx = reviewText();
	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button size="icon-sm" variant="ghost" title={tx.shortcuts}>
					<KeyboardIcon />
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-64 text-xs">
				<div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
					{tx.shortcutList.map(([k, label]) => (
						<div key={k} className="contents">
							<kbd className="font-mono text-muted-foreground">{k}</kbd>
							<span>{label}</span>
						</div>
					))}
				</div>
			</PopoverContent>
		</Popover>
	);
}

export function KbReviewView({
	vaultPath,
	active,
}: {
	vaultPath: string | null;
	active: boolean;
}) {
	useTranslation(); // re-render on locale change
	const tx = reviewText();
	const s = useStore(reviewStore);
	const base = s.bases.find((b) => b.dir === s.baseDir) ?? null;
	const [editing, setEditing] = useState(false);
	const [rejecting, setRejecting] = useState<string[] | null>(null);
	const rootRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		void loadBases(vaultPath).then(() => reload());
	}, [vaultPath]);

	// Pick up proposals written by a pipeline run while the tab was hidden.
	useEffect(() => {
		if (!active) return;
		clearEvidenceCache();
		void reload();
		const onFocus = () => void reload();
		window.addEventListener("focus", onFocus);
		return () => window.removeEventListener("focus", onFocus);
	}, [active]);

	// Rejection categories come from the base's domain profile.
	useEffect(() => {
		if (s.baseDir) void loadReasons();
	}, [s.baseDir]);

	const visible = useMemo(
		() =>
			orderedForKeys(
				filterProposals(s.proposals, s.filter, s.routes),
				s.grouping,
			),
		[s.proposals, s.filter, s.routes, s.grouping],
	);
	const autoCount = useMemo(
		() =>
			s.proposals.filter((p) => routeOf(p, s.routes)?.mode === "auto").length,
		[s.proposals, s.routes],
	);
	const focused =
		visible.find((p) => p.id === s.focusedId) ?? visible[0] ?? null;
	const tools = useMemo(
		() => [...new Set(s.proposals.map((p) => p.tool))].sort(),
		[s.proposals],
	);
	const checkedVisible = visible.filter((p) => s.checked.has(p.id));
	const canDecide = !!base?.hasMerge;

	// Leave edit mode when the focused proposal changes.
	const focusedId = focused?.id ?? null;
	const [editingFor, setEditingFor] = useState<string | null>(null);
	if (editing && editingFor !== focusedId) {
		setEditing(false);
		setEditingFor(focusedId);
	} else if (!editing && editingFor !== focusedId) {
		setEditingFor(focusedId);
	}

	const targets = useCallback(
		() =>
			checkedVisible.length
				? checkedVisible.map((p) => p.id)
				: focused
					? [focused.id]
					: [],
		[checkedVisible, focused],
	);

	// Keyboard: j/k move, x select, a accept, e edit, r reject, 1–9 evidence.
	useEffect(() => {
		if (!active || s.view !== "inbox") return;
		const onKey = (e: KeyboardEvent) => {
			if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
			if (isTypingTarget(e.target) || rejecting) return;
			// Only while focus is in this view (or nowhere): another pane's PDF
			// or tree keeps its own keys.
			const focusEl = document.activeElement;
			if (
				focusEl &&
				focusEl !== document.body &&
				!rootRef.current?.contains(focusEl)
			)
				return;
			if (e.key === "Escape") {
				if (editing) setEditing(false);
				else clearChecked();
				return;
			}
			if (editing) return;
			const idx = focused ? visible.findIndex((p) => p.id === focused.id) : -1;
			const move = (d: number) => {
				const next =
					visible[Math.min(Math.max(idx + d, 0), visible.length - 1)];
				if (next) focus(next.id);
			};
			const key = e.key;
			let handled = true;
			if (key === "j" || key === "ArrowDown") move(1);
			else if (key === "k" || key === "ArrowUp") move(-1);
			else if (key === "x" || key === " ") {
				if (focused) toggleChecked(focused.id);
			} else if (key === "A") {
				setChecked(
					visible.map((p) => p.id),
					true,
				);
			} else if (key === "a") {
				if (canDecide && targets().length) void accept(targets());
			} else if (key === "r") {
				if (canDecide && targets().length) setRejecting(targets());
			} else if (key === "e") {
				if (focused) setEditing(true);
			} else if (key === "o") {
				if (focused && base) openPath(joinBase(base.dir, focused.target));
			} else if (/^[1-9]$/.test(key)) {
				const ev = focused?.evidence[Number(key) - 1];
				if (ev && base) void openEvidence(base.dir, vaultPath, ev);
			} else handled = false;
			if (handled) e.preventDefault();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [
		active,
		editing,
		rejecting,
		focused,
		visible,
		canDecide,
		targets,
		base,
		vaultPath,
		s.view,
	]);

	if (!vaultPath) return <Empty text={tx.noVault} />;
	if (!s.bases.length) return <Empty text={s.error ?? tx.noBase} />;

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: focus target for the inbox shortcuts
		<div
			ref={rootRef}
			tabIndex={-1}
			onMouseDown={(e) => {
				if (!isTypingTarget(e.target))
					rootRef.current?.focus({ preventScroll: true });
			}}
			className="flex h-full min-h-0 flex-col bg-background outline-none"
		>
			{/* toolbar */}
			<div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
				<InboxIcon className="size-4 text-muted-foreground" />
				<span className="text-sm font-medium">{tx.title}</span>
				<Select
					value={s.baseDir ?? ""}
					onValueChange={(v) => v && void selectBase(v)}
				>
					<SelectTrigger size="sm" className="w-56">
						<SelectValue>{base?.name ?? ""}</SelectValue>
					</SelectTrigger>
					<SelectContent>
						{s.bases.map((b) => (
							<SelectItem key={b.dir} value={b.dir}>
								{b.name}
								<span className="ml-1 text-muted-foreground tabular-nums">
									{b.pending}
								</span>
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<span className="text-xs tabular-nums text-muted-foreground">
					{visible.length}/{s.proposals.length}
				</span>
				{(s.loading || s.freshLoading) && <Spinner className="size-3.5" />}
				<div className="flex rounded-md border p-0.5">
					{(["inbox", "audit", "dedupe"] as const).map((v) => (
						<button
							key={v}
							type="button"
							onClick={() => setView(v)}
							className={cn(
								"h-5 rounded px-1.5 text-xs",
								s.view === v
									? "bg-muted text-foreground"
									: "text-muted-foreground",
							)}
						>
							{v === "inbox"
								? tx.viewInbox
								: v === "audit"
									? tx.viewAudit
									: tx.viewDedupe}
						</button>
					))}
				</div>
				<div className="ml-auto flex items-center gap-1">
					<div
						className={cn(
							"flex rounded-md border p-0.5",
							s.view !== "inbox" && "hidden",
						)}
					>
						{(["batches", "flat"] as const).map((g) => (
							<button
								key={g}
								type="button"
								onClick={() => setGrouping(g)}
								className={cn(
									"h-5 rounded px-1.5 text-xs",
									s.grouping === g
										? "bg-muted text-foreground"
										: "text-muted-foreground",
								)}
							>
								{g === "batches" ? tx.groupBatches : tx.groupFlat}
							</button>
						))}
					</div>
					{s.view === "inbox" && base?.hasDomain && (
						<Button
							size="sm"
							variant="ghost"
							disabled={!canDecide || s.routing || !autoCount}
							title={`${tx.routeHint}\n${tx.routeAutoCount(autoCount)}`}
							onClick={() => void routeNow()}
						>
							{s.routing ? <Spinner /> : <RouteIcon />}
							{tx.routeNow}
							{autoCount > 0 && (
								<span className="tabular-nums text-muted-foreground">
									{autoCount}
								</span>
							)}
						</Button>
					)}
					<Button
						size="sm"
						variant="ghost"
						className={cn(s.view !== "inbox" && "hidden")}
						disabled={!canDecide || !s.proposals.length}
						title={tx.checkStaleHint}
						onClick={() => void checkStale()}
					>
						<ShieldAlertIcon />
						{tx.checkStale}
					</Button>
					<Button
						size="icon-sm"
						variant="ghost"
						title={tx.refresh}
						onClick={() => void reload()}
					>
						<RefreshCwIcon />
					</Button>
					<ShortcutsPopover />
					<SettingsPopover />
				</div>
			</div>

			{base && !base.hasMerge && (
				<div className="border-b bg-amber-500/10 px-3 py-1.5 text-xs">
					{tx.noMerge}
				</div>
			)}
			{s.broken.length > 0 && (
				<div
					className="border-b bg-destructive/10 px-3 py-1.5 text-xs"
					title={s.broken.map((b) => `${b.id}: ${b.error}`).join("\n")}
				>
					{tx.broken(s.broken.length)}
				</div>
			)}
			{s.error && (
				<div className="border-b bg-destructive/10 px-3 py-1.5 text-xs">
					{s.error}
				</div>
			)}
			{s.lastDecision && <DecisionBanner log={s.lastDecision} />}

			{s.view === "audit" && base ? (
				<AuditView base={base} />
			) : s.view === "dedupe" && base ? (
				<DedupeView base={base} />
			) : (
				<div className="flex min-h-0 flex-1">
					{/* list */}
					<div className="flex w-[22rem] min-w-[16rem] shrink-0 flex-col border-r">
						<div className="flex flex-col gap-1.5 border-b p-2">
							<Input
								value={s.filter.text}
								onChange={(e) => setFilter({ text: e.target.value })}
								placeholder={tx.searchPlaceholder}
								className="h-7 text-xs"
							/>
							<div className="flex flex-wrap items-center gap-1">
								{(["all", "high", "medium", "low"] as const).map((r) => (
									<button
										key={r}
										type="button"
										onClick={() => setFilter({ risk: r as Level | "all" })}
										className={cn(
											"h-5 rounded-full border px-1.5 text-[11px]",
											r !== "all" && RISK_STYLE[r],
											s.filter.risk === r
												? "bg-muted"
												: "opacity-70 hover:opacity-100",
										)}
									>
										{r === "all" ? tx.filterAll : tx.risk[r]}
									</button>
								))}
								{autoCount > 0 &&
									(["auto", "inbox"] as const).map((r) => (
										<button
											key={r}
											type="button"
											onClick={() =>
												setFilter({ route: s.filter.route === r ? "all" : r })
											}
											className={cn(
												"h-5 rounded-full border px-1.5 text-[11px]",
												r === "auto" &&
													"border-sky-500/40 text-sky-700 dark:text-sky-300",
												s.filter.route === r
													? "bg-muted"
													: "opacity-70 hover:opacity-100",
											)}
										>
											{tx.filterRoute[r]}
										</button>
									))}
								<Select
									value={s.filter.kind}
									onValueChange={(v) =>
										v && setFilter({ kind: v as ProposalKind | "all" })
									}
								>
									<SelectTrigger
										size="sm"
										className="ml-auto h-5 w-24 text-[11px]"
									>
										<SelectValue>
											{s.filter.kind === "all"
												? tx.filterAll
												: tx.kind[s.filter.kind]}
										</SelectValue>
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="all">{tx.filterAll}</SelectItem>
										{(Object.keys(tx.kind) as ProposalKind[]).map((k) => (
											<SelectItem key={k} value={k}>
												{tx.kind[k]}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
								{tools.length > 1 && (
									<Select
										value={s.filter.tool}
										onValueChange={(v) => v && setFilter({ tool: v })}
									>
										<SelectTrigger size="sm" className="h-5 w-24 text-[11px]">
											<SelectValue>
												{s.filter.tool === "all" ? tx.filterAll : s.filter.tool}
											</SelectValue>
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="all">{tx.filterAll}</SelectItem>
											{tools.map((t) => (
												<SelectItem key={t} value={t}>
													{t}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								)}
							</div>
						</div>
						{checkedVisible.length > 0 && (
							<div className="flex items-center gap-1 border-b bg-muted/40 px-2 py-1 text-xs">
								<span className="mr-auto">
									{tx.selected(checkedVisible.length)}
								</span>
								<Button
									size="xs"
									disabled={!canDecide}
									onClick={() => void accept(checkedVisible.map((p) => p.id))}
								>
									<CheckIcon />
									{tx.acceptN(checkedVisible.length)}
								</Button>
								<Button
									size="xs"
									variant="destructive"
									disabled={!canDecide}
									onClick={() => setRejecting(checkedVisible.map((p) => p.id))}
								>
									<XIcon />
									{tx.rejectN(checkedVisible.length)}
								</Button>
								<Button size="xs" variant="ghost" onClick={clearChecked}>
									{tx.selectNone}
								</Button>
							</div>
						)}
						<div className="min-h-0 flex-1 overflow-y-auto">
							{visible.length ? (
								<ProposalList
									proposals={visible}
									grouping={s.grouping}
									focusedId={focused?.id ?? null}
									checked={s.checked}
									fresh={s.fresh}
									routes={s.routes}
									busy={s.busy}
									canDecide={canDecide}
									onFocus={focus}
									onToggle={toggleChecked}
									onToggleMany={(ids, on) => setChecked(ids, on)}
									onAcceptMany={(ids) => void accept(ids)}
								/>
							) : (
								<div className="p-4 text-sm text-muted-foreground">
									{s.loading ? (
										<Spinner />
									) : s.proposals.length ? (
										tx.emptyFiltered
									) : (
										tx.empty
									)}
								</div>
							)}
						</div>
					</div>

					{/* detail */}
					<div className="flex min-w-0 flex-1 flex-col">
						{focused && base ? (
							<ProposalDetail
								key={focused.id}
								proposal={focused}
								base={base}
								vaultPath={vaultPath}
								revision={s.revision}
								fresh={s.fresh.get(focused.id)}
								route={routeOf(focused, s.routes)}
								busy={s.busy.has(focused.id)}
								editing={editing}
								onEditingChange={setEditing}
								onAccept={() => void accept([focused.id])}
								onReject={() => setRejecting([focused.id])}
								onSaveEdit={(patch, andAccept) =>
									saveEdit(focused, patch, andAccept)
								}
							/>
						) : (
							<Empty text={s.proposals.length ? tx.emptyFiltered : tx.empty} />
						)}
					</div>
				</div>
			)}

			<RejectDialog
				open={!!rejecting}
				count={rejecting?.length ?? 0}
				reasons={s.reasons?.dir === s.baseDir ? s.reasons.list : null}
				onCancel={() => setRejecting(null)}
				onConfirm={(input) => {
					const ids = rejecting ?? [];
					setRejecting(null);
					void reject(ids, input);
				}}
			/>
		</div>
	);
}

function Empty({ text }: { text: string }) {
	return (
		<div className="flex h-full flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
			<div className="max-w-md">{text}</div>
		</div>
	);
}
