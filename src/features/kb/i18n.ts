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
