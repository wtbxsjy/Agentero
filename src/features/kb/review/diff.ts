/**
 * Line diff (Myers O(ND)) and the side-by-side row model for the review
 * inbox. No dependency: proposals are single wiki pages, a few hundred lines.
 */

export type DiffOp = { type: "equal" | "del" | "ins"; a: number; b: number };

/** Edit distance above which we give up and show "replace everything". */
const MAX_D = 4000;

/**
 * Shortest edit script between `a` and `b` (any comparable tokens).
 * Returns one op per token: `equal` (a[i] == b[j]), `del` (a[i]), `ins` (b[j]).
 */
export function diffSeq<T>(a: readonly T[], b: readonly T[]): DiffOp[] {
	// Trim common head/tail first: most edits are local.
	let head = 0;
	while (head < a.length && head < b.length && a[head] === b[head]) head++;
	let tail = 0;
	while (
		tail < a.length - head &&
		tail < b.length - head &&
		a[a.length - 1 - tail] === b[b.length - 1 - tail]
	)
		tail++;
	const A = a.slice(head, a.length - tail);
	const B = b.slice(head, b.length - tail);
	const mid = myers(A, B).map((op) => ({
		type: op.type,
		a: op.a + head,
		b: op.b + head,
	}));
	const out: DiffOp[] = [];
	for (let i = 0; i < head; i++) out.push({ type: "equal", a: i, b: i });
	out.push(...mid);
	for (let k = tail; k > 0; k--)
		out.push({ type: "equal", a: a.length - k, b: b.length - k });
	return out;
}

function myers<T>(a: readonly T[], b: readonly T[]): DiffOp[] {
	const n = a.length;
	const m = b.length;
	if (!n) return b.map((_, j) => ({ type: "ins" as const, a: 0, b: j }));
	if (!m) return a.map((_, i) => ({ type: "del" as const, a: i, b: 0 }));
	const max = Math.min(n + m, MAX_D);
	const offset = max;
	let v = new Int32Array(2 * max + 2);
	const trace: Int32Array[] = [];
	let found = -1;
	for (let d = 0; d <= max; d++) {
		trace.push(v.slice());
		const next = v.slice();
		for (let k = -d; k <= d; k += 2) {
			let x: number;
			if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) {
				x = v[offset + k + 1];
			} else {
				x = v[offset + k - 1] + 1;
			}
			let y = x - k;
			while (x < n && y < m && a[x] === b[y]) {
				x++;
				y++;
			}
			next[offset + k] = x;
			if (x >= n && y >= m) {
				found = d;
				break;
			}
		}
		v = next;
		if (found >= 0) {
			trace.push(v.slice());
			break;
		}
	}
	if (found < 0) {
		// Too different to be worth aligning: replace wholesale.
		return [
			...a.map((_, i) => ({ type: "del" as const, a: i, b: 0 })),
			...b.map((_, j) => ({ type: "ins" as const, a: n, b: j })),
		];
	}
	// Backtrack through the saved V arrays (trace[d] is V before step d).
	const ops: DiffOp[] = [];
	let x = n;
	let y = m;
	for (let d = found; d > 0; d--) {
		const vPrev = trace[d];
		const k = x - y;
		const down =
			k === -d || (k !== d && vPrev[offset + k - 1] < vPrev[offset + k + 1]);
		const prevK = down ? k + 1 : k - 1;
		const prevX = vPrev[offset + prevK];
		const prevY = prevX - prevK;
		while (x > prevX && y > prevY) {
			x--;
			y--;
			ops.push({ type: "equal", a: x, b: y });
		}
		if (down) {
			y--;
			ops.push({ type: "ins", a: x, b: y });
		} else {
			x--;
			ops.push({ type: "del", a: x, b: y });
		}
	}
	while (x > 0 && y > 0) {
		x--;
		y--;
		ops.push({ type: "equal", a: x, b: y });
	}
	return ops.reverse();
}

export function splitLines(text: string): string[] {
	if (!text) return [];
	const lines = text.replace(/\r\n?/g, "\n").split("\n");
	if (lines[lines.length - 1] === "") lines.pop();
	return lines;
}

/** One inline span of a changed line. */
export type Span = { text: string; changed: boolean };

export type SideCell = {
	/** 1-based line number in its own file. */
	no: number;
	text: string;
	spans?: Span[];
};

export type SideRow =
	| {
			type: "line";
			kind: "equal" | "change" | "del" | "ins";
			left: SideCell | null;
			right: SideCell | null;
	  }
	| { type: "fold"; count: number; key: string };

/** Words, single CJK characters and punctuation as separate tokens. */
function tokenize(line: string): string[] {
	return (
		line.match(
			/\s+|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu,
		) ?? []
	);
}

/** Intraline highlight for a replaced line pair. */
export function inlineSpans(
	before: string,
	after: string,
): { left: Span[]; right: Span[] } {
	const a = tokenize(before);
	const b = tokenize(after);
	const ops = diffSeq(a, b);
	const left: Span[] = [];
	const right: Span[] = [];
	const push = (list: Span[], text: string, changed: boolean) => {
		const last = list[list.length - 1];
		if (last && last.changed === changed) last.text += text;
		else list.push({ text, changed });
	};
	for (const op of ops) {
		if (op.type === "equal") {
			push(left, a[op.a], false);
			push(right, b[op.b], false);
		} else if (op.type === "del") push(left, a[op.a], true);
		else push(right, b[op.b], true);
	}
	return { left, right };
}

/**
 * Side-by-side rows. Deletions followed by insertions are paired line by line
 * (with inline highlights); unchanged runs longer than `2 * context` fold.
 */
export function sideBySide(
	before: string,
	after: string,
	context = 3,
): { rows: SideRow[]; added: number; removed: number } {
	const a = splitLines(before);
	const b = splitLines(after);
	const ops = diffSeq(a, b);
	const lines: Extract<SideRow, { type: "line" }>[] = [];
	let added = 0;
	let removed = 0;
	let i = 0;
	while (i < ops.length) {
		const op = ops[i];
		if (op.type === "equal") {
			lines.push({
				type: "line",
				kind: "equal",
				left: { no: op.a + 1, text: a[op.a] },
				right: { no: op.b + 1, text: b[op.b] },
			});
			i++;
			continue;
		}
		const dels: DiffOp[] = [];
		const ins: DiffOp[] = [];
		while (i < ops.length && ops[i].type !== "equal") {
			(ops[i].type === "del" ? dels : ins).push(ops[i]);
			i++;
		}
		removed += dels.length;
		added += ins.length;
		const n = Math.max(dels.length, ins.length);
		for (let k = 0; k < n; k++) {
			const d = dels[k];
			const s = ins[k];
			if (d && s) {
				const spans = inlineSpans(a[d.a], b[s.b]);
				lines.push({
					type: "line",
					kind: "change",
					left: { no: d.a + 1, text: a[d.a], spans: spans.left },
					right: { no: s.b + 1, text: b[s.b], spans: spans.right },
				});
			} else if (d) {
				lines.push({
					type: "line",
					kind: "del",
					left: { no: d.a + 1, text: a[d.a] },
					right: null,
				});
			} else if (s) {
				lines.push({
					type: "line",
					kind: "ins",
					left: null,
					right: { no: s.b + 1, text: b[s.b] },
				});
			}
		}
	}
	return { rows: fold(lines, context), added, removed };
}

function fold(
	lines: Extract<SideRow, { type: "line" }>[],
	context: number,
): SideRow[] {
	const out: SideRow[] = [];
	let i = 0;
	while (i < lines.length) {
		if (lines[i].kind !== "equal") {
			out.push(lines[i]);
			i++;
			continue;
		}
		let j = i;
		while (j < lines.length && lines[j].kind === "equal") j++;
		const run = j - i;
		const keepHead = i === 0 ? 0 : context;
		const keepTail = j === lines.length ? 0 : context;
		if (run > keepHead + keepTail + 1) {
			out.push(...lines.slice(i, i + keepHead));
			out.push({
				type: "fold",
				count: run - keepHead - keepTail,
				key: `fold-${i}`,
			});
			out.push(...lines.slice(j - keepTail, j));
		} else {
			out.push(...lines.slice(i, j));
		}
		i = j;
	}
	return out;
}

/** Expand one fold back into its lines (for "show N unchanged lines"). */
export function unfoldedRows(
	before: string,
	after: string,
	openFolds: ReadonlySet<string>,
	context = 3,
): { rows: SideRow[]; added: number; removed: number } {
	if (!openFolds.size) return sideBySide(before, after, context);
	const full = sideBySide(before, after, Number.MAX_SAFE_INTEGER);
	const folded = sideBySide(before, after, context);
	// Fold keys index into the unfolded line list, so slice it back in.
	const rows: SideRow[] = [];
	const fullLines = full.rows as Extract<SideRow, { type: "line" }>[];
	let cursor = 0;
	for (const r of folded.rows) {
		if (r.type === "fold") {
			const start = cursor;
			cursor += r.count;
			if (openFolds.has(r.key)) rows.push(...fullLines.slice(start, cursor));
			else rows.push(r);
		} else {
			rows.push(r);
			cursor++;
		}
	}
	return { rows, added: folded.added, removed: folded.removed };
}

export type UnifiedLine = {
	kind: "meta" | "hunk" | "add" | "del" | "ctx";
	text: string;
};

/** Classify `diff -u` output (from `kb_merge.R --show`) for coloring. */
export function classifyUnified(diff: string): UnifiedLine[] {
	return splitLines(diff).map((text) => {
		if (text.startsWith("+++") || text.startsWith("---"))
			return { kind: "meta", text };
		if (text.startsWith("@@")) return { kind: "hunk", text };
		if (text.startsWith("+")) return { kind: "add", text };
		if (text.startsWith("-")) return { kind: "del", text };
		return { kind: "ctx", text };
	});
}
