import { describe, expect, it } from "vitest";
import {
	diffSeq,
	inlineSpans,
	sideBySide,
	unfoldedRows,
} from "@/features/kb/review/diff";
import {
	fieldRows,
	renderField,
	sameField,
	splitFrontmatter,
	topLevelBlocks,
} from "@/features/kb/review/frontmatter";
import {
	compareForReview,
	groupBatches,
	parseFreshList,
	parseMergeReport,
	parseProposal,
	serializeEdited,
	summarizeBatch,
} from "@/features/kb/review/model";

function proposalJson(over: Record<string, unknown> = {}): string {
	return JSON.stringify({
		schema_version: 1,
		id: "p-20261115-021000-abc123",
		kind: "edit_page",
		target: "wiki/concepts/ribo.md",
		base_hash: "abc",
		patch: { frontmatter: { id: "ribo", title: "Ribo" }, body: "new body\n" },
		patch_hash: "h",
		source_ids: ["ingolia2009"],
		evidence: [{ source: "ingolia2009", locator: "¶12" }],
		confidence: "medium",
		risk: "medium",
		rationale: "why",
		status: "pending",
		created_at: "2026-11-15T02:10:00",
		created_by: { tool: "kb_compile", pass: "page", model: "m" },
		...over,
	});
}

describe("kb review model", () => {
	it("parses a proposal and tolerates jsonlite unboxing", () => {
		const p = parseProposal(
			proposalJson({
				source_ids: "only-one",
				evidence: { source: "s1", locator: "¶3" },
			}),
			"/kb/proposals/pending/x.json",
		);
		expect(p.kind).toBe("edit_page");
		expect(p.sourceIds).toEqual(["only-one"]);
		expect(p.evidence).toEqual([
			{ source: "s1", locator: "¶3", quote: undefined },
		]);
		expect(p.tool).toBe("kb_compile");
		expect(p.pass).toBe("page");
	});

	it("rejects unknown kinds", () => {
		expect(() => parseProposal(proposalJson({ kind: "nope" }), "x")).toThrow();
	});

	it("serializes edits keeping key order and every other field", () => {
		const text = proposalJson();
		const p = parseProposal(text, "x");
		const out = serializeEdited(p, {
			frontmatter: { id: "ribo", title: "Ribo 2" },
			body: "edited\n",
		});
		const parsed = JSON.parse(out);
		expect(Object.keys(parsed)).toEqual(Object.keys(JSON.parse(text)));
		expect(Object.keys(parsed.patch)).toEqual(["frontmatter", "body"]);
		expect(parsed.patch.body).toBe("edited\n");
		expect(parsed.patch_hash).toBe("h");
		expect(parsed.status).toBe("pending");
	});

	it("orders by risk then age", () => {
		const a = parseProposal(
			proposalJson({ id: "p-20261115-021000-aaaaaa", risk: "low" }),
			"a",
		);
		const b = parseProposal(
			proposalJson({ id: "p-20261115-021001-bbbbbb", risk: "high" }),
			"b",
		);
		const c = parseProposal(
			proposalJson({ id: "p-20261115-020000-cccccc", risk: "high" }),
			"c",
		);
		expect([a, b, c].sort(compareForReview).map((p) => p.id)).toEqual([
			"p-20261115-020000-cccccc",
			"p-20261115-021001-bbbbbb",
			"p-20261115-021000-aaaaaa",
		]);
	});

	it("groups runs into batches by tool, pass and time gap", () => {
		const mk = (id: string, at: string, tool = "kb_compile", risk = "low") =>
			parseProposal(
				proposalJson({
					id,
					created_at: at,
					created_by: { tool },
					risk,
				}),
				id,
			);
		const ps = [
			mk("p-20261115-010000-000001", "2026-11-15T01:00:00"),
			mk("p-20261115-010500-000002", "2026-11-15T01:05:00"),
			mk("p-20261115-030000-000003", "2026-11-15T03:00:00"),
			mk("p-20261115-010100-000004", "2026-11-15T01:01:00", "kb_link", "high"),
		];
		const batches = groupBatches(ps);
		expect(batches.map((b) => [b.tool, b.proposals.length])).toEqual([
			["kb_compile", 1],
			["kb_link", 1],
			["kb_compile", 2],
		]);
		const fresh = new Map([["p-20261115-010000-000001", false]]);
		const sum = summarizeBatch(batches[2], fresh);
		expect(sum.byRisk.low).toBe(2);
		expect(sum.stale).toBe(1);
		expect(sum.sources).toBe(1);
	});

	it("reads freshness from --list --json with log noise", () => {
		const out =
			'! 库不是 git 仓库\n[\n  {"id":"p-1","fresh":true},\n  {"id":"p-2","fresh":false}\n]\n';
		const m = parseFreshList(out);
		expect(m.get("p-1")).toBe(true);
		expect(m.get("p-2")).toBe(false);
		expect(parseFreshList("没有待审提案。\n").size).toBe(0);
	});

	it("parses kb_merge.R accept/reject reports", () => {
		const out = [
			"  ✓ p-20261115-021000-abc123 accepted  wiki/a.md  [1a2b3c4]",
			"  ! p-20261115-021000-def456 stale     wiki/b.md  [5d6e7f8]",
			"      目标页在提案生成后已被修改或删除",
			"  · p-20261115-021000-aaa111 rejected  wiki/c.md",
			"✗ 找不到提案 p-20261115-021000-bbb222",
		].join("\n");
		const r = parseMergeReport(out);
		expect(r.get("p-20261115-021000-abc123")).toEqual({
			status: "accepted",
			commit: "1a2b3c4",
			msg: null,
		});
		expect(r.get("p-20261115-021000-def456")?.status).toBe("stale");
		expect(r.get("p-20261115-021000-def456")?.msg).toContain("已被修改");
		expect(r.get("p-20261115-021000-aaa111")?.commit).toBeNull();
		expect(r.get("p-20261115-021000-bbb222")?.status).toBe("missing");
	});
});

describe("kb review diff", () => {
	it("finds a minimal edit script", () => {
		const a = "a b c d e f".split(" ");
		const b = "a x c d f g".split(" ");
		const ops = diffSeq(a, b);
		const rebuiltA = ops.filter((o) => o.type !== "ins").map((o) => a[o.a]);
		const rebuiltB = ops.filter((o) => o.type !== "del").map((o) => b[o.b]);
		expect(rebuiltA).toEqual(a);
		expect(rebuiltB).toEqual(b);
		expect(ops.filter((o) => o.type === "equal").length).toBe(4);
	});

	it("handles empty sides", () => {
		expect(diffSeq([], ["x"])).toEqual([{ type: "ins", a: 0, b: 0 }]);
		expect(diffSeq(["x"], [])).toEqual([{ type: "del", a: 0, b: 0 }]);
	});

	it("pairs replaced lines and folds long unchanged runs", () => {
		const before = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
		const after = before.replace("line 10", "line ten");
		const { rows, added, removed } = sideBySide(before, after, 2);
		expect(added).toBe(1);
		expect(removed).toBe(1);
		const change = rows.find((r) => r.type === "line" && r.kind === "change");
		expect(change).toBeTruthy();
		const folds = rows.filter((r) => r.type === "fold");
		expect(folds.length).toBe(2);
		const open = new Set(folds.map((f) => (f.type === "fold" ? f.key : "")));
		const all = unfoldedRows(before, after, open, 2);
		expect(all.rows.filter((r) => r.type === "fold").length).toBe(0);
		expect(all.rows.length).toBe(20);
	});

	it("highlights changed words and single CJK characters", () => {
		const { left, right } = inlineSpans(
			"核糖体图谱 is great",
			"核酸体图谱 is good",
		);
		expect(left.filter((s) => s.changed).map((s) => s.text)).toEqual([
			"糖",
			"great",
		]);
		expect(right.filter((s) => s.changed).map((s) => s.text)).toEqual([
			"酸",
			"good",
		]);
	});
});

describe("kb review frontmatter", () => {
	const page = `---\nid: ribo\ntitle: 'Ribo-seq'\ntags:\n- a\n- b\nsources:\n  - s1\n---\n\n# Body\n`;

	it("splits frontmatter and body", () => {
		const { frontmatter, body } = splitFrontmatter(page);
		expect(frontmatter).toContain("title:");
		expect(body).toBe("# Body\n");
		expect(splitFrontmatter("no fm").frontmatter).toBeNull();
		expect(splitFrontmatter(null).body).toBe("");
	});

	it("reads top-level blocks including R-style lists", () => {
		const blocks = topLevelBlocks(splitFrontmatter(page).frontmatter);
		expect(blocks.get("tags")).toBe("tags:\n- a\n- b");
		expect(blocks.get("sources")).toBe("sources:\n  - s1");
	});

	it("compares fields ignoring quoting style", () => {
		expect(
			sameField("title: 'Ribo-seq'", renderField("title", "Ribo-seq")),
		).toBe(true);
		expect(sameField("tags:\n- a\n- b", renderField("tags", ["a", "b"]))).toBe(
			true,
		);
		expect(sameField("tags:\n- a", renderField("tags", ["a", "c"]))).toBe(
			false,
		);
	});

	it("builds field rows for page replacement and for set patches", () => {
		const fm = splitFrontmatter(page).frontmatter;
		const rows = fieldRows(
			fm,
			{ id: "ribo", title: "Ribo 2", tags: ["a", "b"] },
			true,
		);
		const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
		expect(byKey.id.changed).toBe(false);
		expect(byKey.title.changed).toBe(true);
		expect(byKey.tags.changed).toBe(false);
		expect(byKey.sources.after).toBeNull();
		const set = fieldRows(fm, { sources: ["s1", "s2"] }, false);
		expect(set.map((r) => r.key)).toEqual(["sources"]);
		expect(set[0].changed).toBe(true);
	});
});
