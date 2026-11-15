import { describe, expect, it } from "vitest";
import {
	type AskCitation,
	defaultPicks,
	lastJson,
	pageReach,
	parseCompilePlan,
	planSelection,
	segmentAnswer,
} from "@/features/kb/qa/model";
import { withTemplate } from "@/features/kb/review/settings";

const cite = (n: number): AskCitation => ({
	n,
	page_id: `p${n}`,
	title: `Page ${n}`,
	path: `wiki/p${n}.md`,
	para: 1,
	hop: 0,
	evidence: [],
	page_sources: [],
});

describe("segmentAnswer", () => {
	it("splits [n] and [n, m] markers and flags unknown numbers", () => {
		const parts = segmentAnswer("LL-37 是螺旋 [1]，作用于膜 [1, 3]。", [
			cite(1),
		]);
		expect(parts.map((p) => (p.kind === "text" ? p.text : p.n))).toEqual([
			"LL-37 是螺旋 ",
			1,
			"，作用于膜 ",
			1,
			3,
			"。",
		]);
		const unknown = parts.find((p) => p.kind === "cite" && p.n === 3);
		expect(unknown?.kind === "cite" && unknown.citation).toBeNull();
	});

	it("leaves text without markers intact", () => {
		expect(segmentAnswer("资料不足", [])).toEqual([
			{ kind: "text", text: "资料不足" },
		]);
	});
});

describe("pageReach", () => {
	it("names seeds and the link a page was reached by", () => {
		const base = { id: "b", title: "B", path: "wiki/b.md", score: 1, hop: 1 };
		expect(pageReach({ ...base, via: null, relation: "seed", hop: 0 })).toBe(
			"seed",
		);
		expect(pageReach({ ...base, via: "a", relation: "wikilink" })).toBe(
			"wikilink ← a",
		);
	});
});

describe("lastJson", () => {
	it("takes the last JSON line after R's notes", () => {
		expect(
			lastJson<{ ok: boolean }>('✓ 加载 profile\n{"ok":true,"id":"p-1"}\n'),
		).toEqual({ ok: true, id: "p-1" });
		expect(lastJson("no json here")).toBeNull();
	});
});

describe("compile plan", () => {
	const stdout = `${JSON.stringify({
		queue: [
			{
				id: "a",
				title: "A",
				source_type: "paper",
				status: "raw",
				value_gate: "keep",
				path: "raw/a.md",
				est_tokens: 5000,
			},
			{
				id: "b",
				title: "",
				source_type: "web",
				status: "stale",
				value_gate: "keep",
				path: "raw/b.md",
				est_tokens: 4000,
			},
			{
				id: "c",
				title: "C",
				source_type: "paper",
				status: "raw",
				value_gate: "keep",
				path: "raw/c.md",
				est_tokens: null,
			},
		],
		picked: [],
		undecided: 2,
		budget: { pages: 2, tokens: 8000 },
		provider: "deepseek",
		model: "deepseek-chat",
		concurrency: 1,
	})}\n`;

	it("parses the dry-run JSON", () => {
		const plan = parseCompilePlan(stdout);
		expect(plan?.queue.map((q) => q.id)).toEqual(["a", "b", "c"]);
		expect(plan?.queue[2].est_tokens).toBeNull();
		expect(plan?.undecided).toBe(2);
		expect(plan?.model).toBe("deepseek-chat");
		expect(parseCompilePlan("raw/ 为空")).toBeNull();
	});

	it("parses the empty-raw plan", () => {
		const plan = parseCompilePlan(
			'{"queue":[],"picked":[],"undecided":0,"provider":"ollama"}',
		);
		expect(plan?.queue).toEqual([]);
		expect(plan?.budget).toBeNull();
	});

	it("ticks up to the budget and flags overruns", () => {
		const plan = parseCompilePlan(stdout);
		if (!plan) throw new Error("plan");
		const picks = defaultPicks(plan);
		expect([...picks]).toEqual(["a", "b"]);
		expect(planSelection(plan, picks)).toEqual({
			ids: ["a", "b"],
			tokens: 9000,
			overBudget: true,
		});
		expect(planSelection(plan, new Set(["c"])).overBudget).toBe(false);
	});
});

describe("withTemplate", () => {
	it("enables merge and domain tools when kb-template is set", () => {
		const bases = [{ dir: "/kb", hasMerge: false, hasDomain: false }];
		expect(withTemplate(bases, "")).toBe(bases);
		expect(withTemplate(bases, "/src/kb-template")[0]).toMatchObject({
			hasMerge: true,
			hasDomain: true,
		});
	});
});
