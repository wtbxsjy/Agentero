/**
 * KB strings live with the feature instead of the shared locale files, so
 * upstream locale edits never conflict with this patch set.
 */

import i18n from "@/i18n";
import type { SourceKind } from "./sources";

const en = {
	tab: "Knowledge",
	agentTab: "Agent",
	placeholder: "Search the knowledge base…",
	search: "Search",
	allSources: "All",
	offlineTitle: "kb-rag service is not running",
	offlineHint: "Start it from kb-template, then retry:",
	retry: "Retry",
	noKb: "No knowledge base with an index was found.",
	noHits: "No hits.",
	relatedTo: "Related to the open paper",
	serviceUrl: "Service URL",
	openFailed: "This hit is outside the open vault",
	wikiWriteTitle: "This writes knowledge-base wiki pages directly",
	wikiWriteHint:
		"Wiki pages normally change through proposals in the review inbox (kb_merge.R keeps one commit per decision). Allow only if you mean to bypass review.",
	ask: "Ask",
	askPlaceholder: "Ask a question; the answer cites wiki paragraphs…",
	askSubmit: "Ask",
	askLevel: "Retrieval",
	askLevels: {
		keyword: "keyword",
		hybrid: "hybrid",
		multihop: "multi-hop",
	},
	askHops: "Hops",
	askBase: "Knowledge base",
	askNoBase: "No knowledge base in this vault.",
	askOffline:
		"kb-rag service is not running (or too old for /ask). Start it from kb-template:",
	askCost:
		"Each question calls the model configured in kb.config.yaml (ask:, else compile:).",
	askInsufficient: "The knowledge base does not have enough to answer this.",
	askConfidence: (c: string) => `confidence: ${c}`,
	askInvalidCites: (ns: number[]) =>
		`The answer cited passages that were not provided: ${ns.map((n) => `[${n}]`).join(" ")}`,
	askCitations: "Citations",
	askTrace: "Retrieved pages",
	askTraceHop: (h: number) => (h === 0 ? "seed" : `hop ${h}`),
	askMeta: (model: string, prompt: string, ms: number) =>
		`${model} · prompt ${prompt} · ${Math.round(ms)} ms`,
	askSave: "Save as proposal",
	askSaveHint:
		"Registers the answer as a new wiki page proposal (wiki/queries/…) through kb_merge.R --submit; routing decides whether it needs review.",
	askSaved: (id: string) => `Proposal ${id} is in the inbox`,
	askSavedAuto: (rule: string) =>
		`Low risk: auto-merge rule ${rule} applies on the next route`,
	askOpenInbox: "Open in inbox",
	askNeedsMerge:
		"Saving needs kb_merge.R: set the kb-template folder in the review inbox settings.",
	kind: {
		paper: "Paper",
		raw: "Raw",
		wiki: "Wiki",
		evidence: "Evidence",
		other: "Other",
	} satisfies Record<SourceKind, string>,
};

const zh: typeof en = {
	tab: "知识库",
	agentTab: "Agent",
	placeholder: "检索知识库…",
	search: "检索",
	allSources: "全部",
	offlineTitle: "kb-rag 服务未启动",
	offlineHint: "在 kb-template 里启动后重试：",
	retry: "重试",
	noKb: "没有找到已建索引的知识库。",
	noHits: "没有命中。",
	relatedTo: "与当前论文相关",
	serviceUrl: "服务地址",
	openFailed: "该命中不在当前 Vault 内",
	wikiWriteTitle: "这一步会直接改写知识库的 wiki 页",
	wikiWriteHint:
		"wiki 页平时只通过审阅收件箱里的提案修改（kb_merge.R 每个决定一次提交）。只有确实要绕过审阅时才允许。",
	ask: "问答",
	askPlaceholder: "提问；回答会引用 wiki 段落…",
	askSubmit: "提问",
	askLevel: "检索",
	askLevels: {
		keyword: "关键词",
		hybrid: "混合",
		multihop: "多跳",
	},
	askHops: "跳数",
	askBase: "知识库",
	askNoBase: "当前 Vault 里没有知识库。",
	askOffline:
		"kb-rag 服务未启动（或版本太旧，没有 /ask）。在 kb-template 里启动：",
	askCost:
		"每次提问都会调用 kb.config.yaml 里配置的模型（ask: 段，没有就用 compile: 段）。",
	askInsufficient: "知识库里的资料不足以回答这个问题。",
	askConfidence: (c: string) => `置信度：${c}`,
	askInvalidCites: (ns: number[]) =>
		`回答引用了没有提供的段落：${ns.map((n) => `[${n}]`).join(" ")}`,
	askCitations: "引用",
	askTrace: "检索到的页",
	askTraceHop: (h: number) => (h === 0 ? "种子" : `第 ${h} 跳`),
	askMeta: (model: string, prompt: string, ms: number) =>
		`${model} · 提示词 ${prompt} · ${Math.round(ms)} ms`,
	askSave: "存为提案",
	askSaveHint:
		"通过 kb_merge.R --submit 把回答登记为新 wiki 页提案（wiki/queries/…），是否要人审由分流决定。",
	askSaved: (id: string) => `提案 ${id} 已进收件箱`,
	askSavedAuto: (rule: string) => `低风险：下次分流时按规则 ${rule} 自动合并`,
	askOpenInbox: "在收件箱打开",
	askNeedsMerge:
		"存为提案需要 kb_merge.R：请在审阅收件箱设置里填 kb-template 目录。",
	kind: {
		paper: "论文",
		raw: "原文",
		wiki: "知识页",
		evidence: "证据",
		other: "其他",
	},
};

export function kbText(): typeof en {
	return i18n.language?.startsWith("zh") ? zh : en;
}
