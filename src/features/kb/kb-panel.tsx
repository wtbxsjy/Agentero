import { BookOpenIcon, RefreshCwIcon, SearchIcon } from "lucide-react";
import {
	type FormEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { notifyError } from "@/lib/core/notify";
import { cn } from "@/lib/core/utils";
import { openCitation } from "@/lib/workspace/actions";
import {
	type KbHit,
	type KbInfo,
	type KbMode,
	KbRagError,
	type KbStore,
	kbList,
	kbQuery,
	kbRagUrl,
	setKbRagUrl,
} from "./client";
import { kbText } from "./i18n";
import {
	SOURCE_KINDS,
	SOURCE_STYLE,
	type SourceKind,
	sourceKindOfVaultPath,
	toVaultRel,
} from "./sources";

type Props = {
	vaultPath: string | null;
	/** Title of the paper in the active tab; seeds a "related knowledge" query. */
	paperTitle: string | null;
	className?: string;
};

type Status = "loading" | "offline" | "ready";

const STORE_FOR_FILTER: Record<"all" | SourceKind, KbStore> = {
	all: "all",
	wiki: "wiki",
	evidence: "wiki",
	raw: "raw",
	paper: "all",
	other: "all",
};

export function KbPanel({ vaultPath, paperTitle, className }: Props) {
	useTranslation(); // re-render on locale change
	const tx = kbText();
	const [status, setStatus] = useState<Status>("loading");
	const [kbs, setKbs] = useState<KbInfo[]>([]);
	const [kb, setKb] = useState<string>("");
	const [query, setQuery] = useState("");
	const [mode, setMode] = useState<KbMode>("hybrid");
	const [filter, setFilter] = useState<"all" | SourceKind>("all");
	const [hits, setHits] = useState<KbHit[] | null>(null);
	const [note, setNote] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [url, setUrl] = useState(kbRagUrl);
	const seededFor = useRef<string | null>(null);

	const connect = useCallback(async () => {
		setStatus("loading");
		try {
			const list = await kbList();
			// Prefer knowledge bases that live inside the open vault.
			const inVault = list.filter((k) => toVaultRel(k.kb_dir, vaultPath));
			const shown = inVault.length ? inVault : list;
			setKbs(shown);
			setKb((cur) =>
				shown.some((k) => k.kb === cur) ? cur : (shown[0]?.kb ?? ""),
			);
			setStatus("ready");
		} catch {
			setStatus("offline");
		}
	}, [vaultPath]);

	useEffect(() => {
		void connect();
	}, [connect]);

	const run = useCallback(
		async (q: string) => {
			if (!kb || !q.trim()) return;
			setBusy(true);
			try {
				const res = await kbQuery({
					kb,
					q,
					store: STORE_FOR_FILTER[filter],
					mode,
				});
				setHits(res.hits);
				setNote(res.note ?? null);
			} catch (err) {
				if (err instanceof KbRagError && err.offline) setStatus("offline");
				else notifyError(err instanceof Error ? err.message : String(err));
			} finally {
				setBusy(false);
			}
		},
		[kb, filter, mode],
	);

	// Opening a paper seeds one "related knowledge" query for it.
	useEffect(() => {
		if (status !== "ready" || !kb || !paperTitle) return;
		if (seededFor.current === paperTitle) return;
		seededFor.current = paperTitle;
		setQuery(paperTitle);
		void run(paperTitle);
	}, [status, kb, paperTitle, run]);

	function onSubmit(e: FormEvent) {
		e.preventDefault();
		void run(query);
	}

	function openHit(hit: KbHit) {
		const rel = toVaultRel(hit.path, vaultPath);
		if (!rel) {
			notifyError(`${tx.openFailed}: ${hit.path ?? hit.origin}`);
			return;
		}
		openCitation(rel);
	}

	const kindOf = (h: KbHit): SourceKind => {
		const rel = toVaultRel(h.path, vaultPath);
		return rel ? sourceKindOfVaultPath(rel) : (h.source_kind ?? "other");
	};
	const visible =
		hits?.filter((h) => filter === "all" || kindOf(h) === filter) ?? null;

	if (status === "offline") {
		return (
			<div className={cn("flex flex-col gap-3 p-4 text-sm", className)}>
				<div className="font-medium">{tx.offlineTitle}</div>
				<div className="text-muted-foreground">{tx.offlineHint}</div>
				<code className="rounded-md bg-muted p-2 text-xs break-all">
					KB_RAG_ROOTS={vaultPath ? `${vaultPath}/kb` : "<vault>/kb"} bash
					kb-template/mcp/run.sh --http 127.0.0.1:8766
				</code>
				<div className="flex flex-col gap-1 text-xs text-muted-foreground">
					<label htmlFor="kb-rag-url">{tx.serviceUrl}</label>
					<Input
						id="kb-rag-url"
						value={url}
						onChange={(e) => setUrl(e.target.value)}
						onBlur={() => setKbRagUrl(url)}
					/>
				</div>
				<Button size="sm" variant="outline" onClick={() => void connect()}>
					<RefreshCwIcon />
					{tx.retry}
				</Button>
			</div>
		);
	}

	return (
		<div className={cn("flex min-h-0 flex-col", className)}>
			<form onSubmit={onSubmit} className="flex flex-col gap-2 border-b p-3">
				<div className="flex gap-2">
					<Input
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder={tx.placeholder}
						disabled={status !== "ready" || !kb}
					/>
					<Button
						type="submit"
						size="icon"
						variant="outline"
						aria-label={tx.search}
						disabled={busy || !kb}
					>
						{busy ? <Spinner /> : <SearchIcon />}
					</Button>
				</div>
				<div className="flex gap-2">
					<Select value={kb} onValueChange={(v) => v && setKb(v)}>
						<SelectTrigger size="sm" className="min-w-0 flex-1">
							<SelectValue>
								{kbs.find((k) => k.kb === kb)?.name ?? kb}
							</SelectValue>
						</SelectTrigger>
						<SelectContent>
							{kbs.map((k) => (
								<SelectItem key={k.kb} value={k.kb}>
									{k.name ?? k.kb}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<Select value={mode} onValueChange={(v) => v && setMode(v as KbMode)}>
						<SelectTrigger size="sm" className="w-24">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{(["hybrid", "vss", "bm25"] as const).map((m) => (
								<SelectItem key={m} value={m}>
									{m}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<div className="flex flex-wrap gap-1">
					{(["all", ...SOURCE_KINDS] as const).map((k) => (
						<button
							key={k}
							type="button"
							onClick={() => setFilter(k)}
							className={cn(
								"inline-flex h-6 items-center gap-1.5 rounded-full border px-2 text-xs",
								filter === k
									? "bg-muted text-foreground"
									: "text-muted-foreground hover:bg-muted/60",
							)}
						>
							{k !== "all" && (
								<span
									className={cn("size-2 rounded-full", SOURCE_STYLE[k].dot)}
								/>
							)}
							{k === "all" ? tx.allSources : tx.kind[k]}
						</button>
					))}
				</div>
			</form>

			<ScrollArea className="min-h-0 flex-1">
				<div className="flex flex-col gap-2 p-3">
					{status === "loading" && <Spinner className="mx-auto" />}
					{status === "ready" && !kbs.length && (
						<div className="text-sm text-muted-foreground">{tx.noKb}</div>
					)}
					{paperTitle && hits && query === paperTitle && (
						<div className="flex items-center gap-1 text-xs text-muted-foreground">
							<BookOpenIcon className="size-3" />
							{tx.relatedTo}
						</div>
					)}
					{visible && !visible.length && (
						<div className="text-sm text-muted-foreground">
							{note ?? tx.noHits}
						</div>
					)}
					{visible?.map((h) => {
						const kind = kindOf(h);
						return (
							<button
								key={`${h.store}-${h.rank}-${h.origin}`}
								type="button"
								onClick={() => openHit(h)}
								className="flex flex-col gap-1 rounded-lg border p-2 text-left hover:bg-muted/60"
							>
								<div className="flex items-center gap-2 text-xs">
									<span
										className={cn(
											"inline-flex h-5 items-center gap-1 rounded-full border px-1.5",
											SOURCE_STYLE[kind].chip,
										)}
									>
										<span
											className={cn(
												"size-1.5 rounded-full",
												SOURCE_STYLE[kind].dot,
											)}
										/>
										{tx.kind[kind]}
									</span>
									<span className="min-w-0 flex-1 truncate font-medium">
										{h.doc}
									</span>
									<span className="tabular-nums text-muted-foreground">
										{h.score.toFixed(3)}
									</span>
								</div>
								{h.context && (
									<div className="truncate text-xs text-muted-foreground">
										§ {h.context}
									</div>
								)}
								<div className="line-clamp-3 text-xs">{h.snippet}</div>
							</button>
						);
					})}
				</div>
			</ScrollArea>
		</div>
	);
}
