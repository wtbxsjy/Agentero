import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import i18n from "@/i18n";
import { cn } from "@/lib/core/utils";
import { reviewText } from "./i18n";
import type { RejectReason } from "./model";
import type { RejectInput } from "./store";

type Choice = { code: string; label: string; feeds: string | null };

/** Profile reasons in the UI language, else the built-in presets. */
function choices(reasons: readonly RejectReason[] | null): Choice[] {
	const zh = i18n.language?.startsWith("zh");
	if (reasons?.length)
		return reasons.map((r) => ({
			code: r.code,
			label: zh ? r.label : r.labelEn,
			feeds: r.feeds,
		}));
	return reviewText().reasons.map((r) => ({ ...r, feeds: null }));
}

/**
 * Reject with a reason category (from the base's domain profile: it decides
 * where the rejection feeds back — compile prompt, alias table, scope) plus
 * free text. A duplicate can name the page it duplicates, which
 * kb_feedback.R turns into an alias suggestion.
 */
export function RejectDialog({
	open,
	count,
	reasons,
	onCancel,
	onConfirm,
}: {
	open: boolean;
	count: number;
	reasons: readonly RejectReason[] | null;
	onCancel: () => void;
	onConfirm: (input: RejectInput) => void;
}) {
	const tx = reviewText();
	const [code, setCode] = useState<string | null>(null);
	const [reason, setReason] = useState("");
	const [dup, setDup] = useState("");
	const ref = useRef<HTMLTextAreaElement>(null);
	const list = choices(reasons);
	useEffect(() => {
		if (open) {
			setCode(null);
			setReason("");
			setDup("");
			window.setTimeout(() => ref.current?.focus(), 30);
		}
	}, [open]);
	const picked = list.find((c) => c.code === code) ?? null;
	const confirm = () =>
		onConfirm({
			// No free text: the category label still says why.
			reason: reason.trim() || picked?.label || "",
			code,
			duplicateOf: code === "duplicate" && dup.trim() ? dup.trim() : null,
		});
	return (
		<Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>
						{tx.rejectTitle}
						{count > 1 ? ` · ${tx.selected(count)}` : ""}
					</DialogTitle>
					<DialogDescription>{tx.rejectHint}</DialogDescription>
				</DialogHeader>
				<div className="flex flex-col gap-1">
					<span className="text-xs text-muted-foreground">
						{tx.rejectCategory}
					</span>
					<div className="flex flex-wrap gap-1.5">
						{list.map((r, i) => (
							<button
								key={r.code}
								type="button"
								title={r.feeds ? tx.rejectFeeds[r.feeds] : undefined}
								onClick={() => setCode(code === r.code ? null : r.code)}
								className={cn(
									"h-6 rounded-full border px-2 text-xs",
									code === r.code
										? "border-foreground/40 bg-muted text-foreground"
										: "text-muted-foreground hover:bg-muted/60",
								)}
							>
								<span className="mr-1 font-mono opacity-60">{i + 1}</span>
								{r.label}
							</button>
						))}
					</div>
					{picked?.feeds && (
						<span className="text-[11px] text-muted-foreground">
							{tx.rejectFeeds[picked.feeds] ?? picked.feeds}
						</span>
					)}
				</div>
				{code === "duplicate" && (
					<label
						htmlFor="kb-reject-dup"
						className="flex flex-col gap-1 text-xs"
					>
						{tx.duplicateOf}
						<Input
							id="kb-reject-dup"
							value={dup}
							onChange={(e) => setDup(e.target.value)}
							placeholder="entity-…"
							className="h-7 font-mono text-xs"
						/>
						<span className="text-muted-foreground">{tx.duplicateOfHint}</span>
					</label>
				)}
				<Textarea
					ref={ref}
					value={reason}
					onChange={(e) => setReason(e.target.value)}
					placeholder={tx.rejectPlaceholder}
					className="min-h-20 text-sm"
					onKeyDown={(e) => {
						if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
							e.preventDefault();
							confirm();
						}
						// Digits pick a category while the box is still empty.
						if (!reason && /^[1-9]$/.test(e.key)) {
							const preset = list[Number(e.key) - 1];
							if (preset) {
								e.preventDefault();
								setCode(preset.code);
							}
						}
					}}
				/>
				<DialogFooter>
					<Button variant="ghost" onClick={onCancel}>
						{tx.cancel}
					</Button>
					<Button variant="destructive" onClick={confirm}>
						{count > 1 ? tx.rejectN(count) : tx.reject}
						<kbd className="ml-1 text-[10px] opacity-60">⌘↵</kbd>
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
