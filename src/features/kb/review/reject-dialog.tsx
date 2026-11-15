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
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/core/utils";
import { reviewText } from "./i18n";

/** Reject with a reason: preset chips (feedback loop) or free text. */
export function RejectDialog({
	open,
	count,
	onCancel,
	onConfirm,
}: {
	open: boolean;
	count: number;
	onCancel: () => void;
	onConfirm: (reason: string) => void;
}) {
	const tx = reviewText();
	const [reason, setReason] = useState("");
	const ref = useRef<HTMLTextAreaElement>(null);
	useEffect(() => {
		if (open) {
			setReason("");
			window.setTimeout(() => ref.current?.focus(), 30);
		}
	}, [open]);
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
				<div className="flex flex-wrap gap-1.5">
					{tx.reasons.map((r, i) => (
						<button
							key={r}
							type="button"
							onClick={() => setReason(r)}
							className={cn(
								"h-6 rounded-full border px-2 text-xs",
								reason === r
									? "bg-muted text-foreground"
									: "text-muted-foreground hover:bg-muted/60",
							)}
						>
							<span className="mr-1 font-mono opacity-60">{i + 1}</span>
							{r}
						</button>
					))}
				</div>
				<Textarea
					ref={ref}
					value={reason}
					onChange={(e) => setReason(e.target.value)}
					placeholder={tx.rejectPlaceholder}
					className="min-h-20 text-sm"
					onKeyDown={(e) => {
						if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
							e.preventDefault();
							onConfirm(reason);
						}
						// Digits pick a preset while the box is still empty.
						if (!reason && /^[1-9]$/.test(e.key)) {
							const preset = tx.reasons[Number(e.key) - 1];
							if (preset) {
								e.preventDefault();
								setReason(preset);
							}
						}
					}}
				/>
				<DialogFooter>
					<Button variant="ghost" onClick={onCancel}>
						{tx.cancel}
					</Button>
					<Button variant="destructive" onClick={() => onConfirm(reason)}>
						{count > 1 ? tx.rejectN(count) : tx.reject}
						<kbd className="ml-1 text-[10px] opacity-60">⌘↵</kbd>
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
