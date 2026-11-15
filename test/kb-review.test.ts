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
	parseAuditList,
	parseAuditStats,
	parseDedupe,
	parseFreshList,
	parseMergeReport,
	parseProposal,
	parseReasons,
	parseRoutePreview,
	parseRouteRun,
	serializeEdited,
	summarizeBatch,
} from "@/features/kb/review/model";
import { EMPTY_FILTER, filterProposals } from "@/features/kb/review/store";

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

// Shapes below are real kb-template P3 output (kb_merge.R / kb_audit.R / kb_dedupe.R --json).
describe("domain profile outputs", () => {
	it("reads routing previews and route runs, with log lines around the JSON", () => {
		const list = `[
  {"id": "p-20261115-032348-19c799", "kind": "merge_entity", "fresh": true,
   "route": {"mode": "inbox", "why": "实体合并，被并入页不在别名表里"}},
  {"id": "p-20261115-032349-aaaaaa", "fresh": true,
   "route": {"mode": "auto", "rule": "link", "why": "只补 2 条链接"}},
  {"id": "p-20261115-032350-bbbbbb", "fresh": false}
]`;
		const routes = parseRoutePreview(list);
		expect(routes.size).toBe(2);
		expect(routes.get("p-20261115-032349-aaaaaa")).toEqual({
			mode: "auto",
			rule: "link",
			why: "只补 2 条链接",
		});
		expect(routes.get("p-20261115-032348-19c799")?.rule).toBeNull();

		const run = parseRouteRun(`  ✓ route: 1 auto\n[
  {"id": "p-1", "kind": "link", "target": "wiki/a.md", "mode": "auto", "rule": "link",
   "why": "w", "result": "accepted", "commit": "abc1234"},
  {"id": "p-2", "mode": "inbox", "why": "置信度低"}
] `);
		expect(run.map((r) => [r.id, r.mode, r.result, r.commit])).toEqual([
			["p-1", "auto", "accepted", "abc1234"],
			["p-2", "inbox", null, null],
		]);
	});

	it("filters by route, falling back to the stored route", () => {
		const a = parseProposal(proposalJson(), "a.json");
		const b = parseProposal(
			proposalJson({
				id: "p-20261115-021001-abc124",
				route: { mode: "auto", rule: "format", why: "x", at: "t" },
			}),
			"b.json",
		);
		expect(b.route?.mode).toBe("auto");
		const auto = { ...EMPTY_FILTER, route: "auto" as const };
		expect(filterProposals([a, b], auto).map((p) => p.id)).toEqual([b.id]);
		const live = new Map([
			[a.id, { mode: "auto" as const, rule: "link", why: null }],
		]);
		expect(filterProposals([a, b], auto, live)).toHaveLength(2);
		const inbox = { ...EMPTY_FILTER, route: "inbox" as const };
		expect(filterProposals([a, b], inbox).map((p) => p.id)).toEqual([a.id]);
	});

	it("reads reject reasons", () => {
		const r = parseReasons(`[
  {"code": "unsupported", "label": "证据不支持论断", "label_en": "Evidence does not support the claim", "feeds": "prompt"},
  {"code": "duplicate", "label": "与已有页重复", "label_en": "Duplicates an existing page", "feeds": "aliases"},
  {"label": "no code"}
]`);
		expect(r.map((x) => [x.code, x.feeds])).toEqual([
			["unsupported", "prompt"],
			["duplicate", "aliases"],
		]);
		expect(r[1].labelEn).toBe("Duplicates an existing page");
	});

	it("reads the audit report with null rates", () => {
		const st = parseAuditStats(`{
  "rules": [
    {"rule": "alias", "auto_merged": 0, "audited": 0, "wrong": 0, "error_rate": null, "upper95": null, "disabled": false},
    {"rule": "link", "auto_merged": 30, "audited": 21, "wrong": 3, "error_rate": 0.1429, "upper95": 0.3,
     "unaudited": 9, "disabled": true, "paused": false},
    {"rule": "format", "auto_merged": 60, "audited": 0, "wrong": 0, "error_rate": null, "upper95": null,
     "unaudited": 60, "disabled": false, "paused": true}
  ],
  "target": 0.05, "min_audited": 20, "audited": 21, "wrong": 3, "max_unaudited": 50,
  "error_rate": 0.1429, "upper95": 0.3, "queued": 4, "disabled": ["link"], "paused": ["format"]
}`);
		expect(st?.rules[2]).toMatchObject({ unaudited: 60, paused: true });
		expect(st?.rules[0].unaudited).toBe(0);
		expect(st?.paused).toEqual(["format"]);
		expect(st?.maxUnaudited).toBe(50);
		expect(st?.rules[0].errorRate).toBeNull();
		expect(st?.rules[1]).toMatchObject({ autoMerged: 30, disabled: true });
		expect(st?.disabled).toEqual(["link"]);
		expect(st?.queued).toBe(4);
		expect(parseAuditStats("no json")).toBeNull();
	});

	it("reads the audit queue", () => {
		const q =
			parseAuditList(`[{"id": "p-1", "kind": "link", "target": "wiki/a.md",
  "rule": "link", "why": "w", "decided_at": "2026-11-15T03:00:00", "rationale": "r", "commit": "abc"}]`);
		expect(q[0]).toMatchObject({
			id: "p-1",
			rule: "link",
			decidedAt: "2026-11-15T03:00:00",
			commit: "abc",
		});
		expect(parseAuditList("[] ")).toEqual([]);
	});

	it("reads duplicate candidates", () => {
		const d = parseDedupe(`[
  {"from": "entity-acme-b", "into": "entity-acme-a", "basis": "title",
   "from_title": "Acme Corp", "into_title": "Acme Corp", "pending": true}
]`);
		expect(d).toEqual([
			{
				from: "entity-acme-b",
				into: "entity-acme-a",
				basis: "title",
				fromTitle: "Acme Corp",
				intoTitle: "Acme Corp",
				pending: true,
			},
		]);
	});

	it("reads merge_entity proposals", () => {
		const p = parseProposal(
			proposalJson({
				kind: "merge_entity",
				target: "wiki/entities/entity-acme-a.md",
				patch: {},
				merge: {
					from: [
						{
							path: "wiki/entities/entity-acme-b.md",
							id: "entity-acme-b",
							title: "Acme Corp",
							base_hash: "h",
						},
					],
					aliases: ["Acme"],
					basis: "title",
				},
				reason_code: "duplicate",
				duplicate_of: "entity-acme-a",
			}),
			"m.json",
		);
		expect(p.merge?.from.map((f) => f.id)).toEqual(["entity-acme-b"]);
		expect(p.merge?.aliases).toEqual(["Acme"]);
		expect(p.reasonCode).toBe("duplicate");
		expect(p.duplicateOf).toBe("entity-acme-a");
	});
});
