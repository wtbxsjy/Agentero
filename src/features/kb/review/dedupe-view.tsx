import { GitMergeIcon, RefreshCwIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useStore } from "zustand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { KbBase } from "./api";
import {
	dismissDomainMessage,
	domainStore,
	loadDedupe,
	proposeMerge,
} from "./domain-store";
import { reviewText } from "./i18n";
import { Chip } from "./proposal-detail";

/**
 * Duplicate entity pages (`kb_dedupe.R --scan`): each candidate can become a
 * `merge_entity` proposal, which is then accepted or rejected in the inbox
 * like any other. A manual form covers pairs the scan does not see.
 */
export function DedupeView({ base }: { base: KbBase }) {
	const tx = reviewText();
	const s = useStore(domainStore);
	const [from, setFrom] = useState("");
	const [into, setInto] = useState("");
	const [why, setWhy] = useState("");

	// biome-ignore lint/correctness/useExhaustiveDependencies: reload when the selected base changes
	useEffect(() => {
		if (base.hasDomain) void loadDedupe();
	}, [base.dir, base.hasDomain]);

	if (!base.hasDomain)
		return (
			<div className="p-4 text-sm text-muted-foreground">{tx.noDomain}</div>
		);

	const proposed = s.notice?.startsWith("proposed:") ? s.notice.slice(9) : null;
	const busy = (a: string, b: string) => s.dedupeBusy.has(`${a}\u0000${b}`);
	const manualOk = from.trim() && into.trim() && from.trim() !== into.trim();

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex items-center gap-2 border-b px-3 py-2">
				<span className="text-sm font-medium">{tx.dedupeTitle}</span>
				{s.dedupeLoading && <Spinner className="size-3.5" />}
				<Button
					size="xs"
					variant="outline"
					className="ml-auto"
					disabled={s.dedupeLoading}
					onClick={() => void loadDedupe()}
				>
					<RefreshCwIcon />
					{tx.dedupeScan}
				</Button>
			</div>
			{(s.error || proposed) && (
				<div
					className={
						s.error
							? "flex items-start gap-2 border-b bg-destructive/10 px-3 py-1.5 text-xs"
							: "flex items-start gap-2 border-b bg-emerald-500/10 px-3 py-1.5 text-xs"
					}
				>
					<pre className="min-w-0 flex-1 whitespace-pre-wrap font-sans">
						{s.error ?? (proposed ? tx.dedupeProposed(proposed) : "")}
					</pre>
					<button
						type="button"
						onClick={dismissDomainMessage}
						className="text-muted-foreground"
					>
						<XIcon className="size-3.5" />
					</button>
				</div>
			)}
			<div className="min-h-0 flex-1 overflow-y-auto">
				{s.candidates.length ? (
					<table className="w-full text-xs">
						<tbody>
							{s.candidates.map((c) => (
								<tr key={`${c.from}>${c.into}`} className="border-b">
									<td className="px-3 py-1.5">
										<div className="font-mono">{c.from}</div>
										<div className="text-muted-foreground">{c.fromTitle}</div>
									</td>
									<td className="px-1 text-muted-foreground">→</td>
									<td className="px-3 py-1.5">
										<div className="font-mono">{c.into}</div>
										<div className="text-muted-foreground">{c.intoTitle}</div>
									</td>
									<td className="px-2">
										<Chip className="border-sky-500/40 text-sky-700 dark:text-sky-300">
											{tx.mergeBasisLabel[c.basis] ?? c.basis}
										</Chip>
									</td>
									<td className="px-3 text-right">
										{c.pending ? (
											<span className="text-muted-foreground">
												{tx.dedupePending}
											</span>
										) : (
											<Button
												size="xs"
												variant="outline"
												disabled={busy(c.from, c.into)}
												onClick={() => void proposeMerge(c.from, c.into)}
											>
												{busy(c.from, c.into) ? <Spinner /> : <GitMergeIcon />}
												{tx.dedupePropose}
											</Button>
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				) : (
					<div className="p-4 text-sm text-muted-foreground">
						{s.dedupeLoading ? <Spinner /> : tx.dedupeEmpty}
					</div>
				)}
			</div>
			<div className="flex flex-col gap-1.5 border-t px-3 py-2">
				<span className="text-xs font-medium">{tx.dedupeManual}</span>
				<div className="flex flex-wrap items-center gap-2">
					<Input
						value={from}
						onChange={(e) => setFrom(e.target.value)}
						placeholder={tx.dedupeFrom}
						className="h-7 w-48 font-mono text-xs"
					/>
					<span className="text-muted-foreground">→</span>
					<Input
						value={into}
						onChange={(e) => setInto(e.target.value)}
						placeholder={tx.dedupeInto}
						className="h-7 w-48 font-mono text-xs"
					/>
					<Input
						value={why}
						onChange={(e) => setWhy(e.target.value)}
						placeholder={tx.dedupeReason}
						className="h-7 min-w-40 flex-1 text-xs"
					/>
					<Button
						size="xs"
						disabled={!manualOk || busy(from.trim(), into.trim())}
						onClick={() => {
							void proposeMerge(from.trim(), into.trim(), why).then((ok) => {
								if (ok) {
									setFrom("");
									setInto("");
									setWhy("");
								}
							});
						}}
					>
						<GitMergeIcon />
						{tx.dedupePropose}
					</Button>
				</div>
			</div>
		</div>
	);
}
