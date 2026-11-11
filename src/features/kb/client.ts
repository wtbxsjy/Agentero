/**
 * kb-rag HTTP client (kb-template `mcp/run.sh --http`). Loopback only, no auth.
 * The service lives outside Agentero, so nothing here goes through Tauri IPC.
 */

import type { SourceKind } from "./sources";

const URL_KEY = "agentero-kb-rag-url";
export const DEFAULT_KB_RAG_URL = "http://127.0.0.1:8766";

export type KbStore = "all" | "wiki" | "raw";
export type KbMode = "hybrid" | "vss" | "bm25";

export type KbInfo = {
	kb: string;
	name?: string;
	kb_dir: string | null;
	stores: { store: string; chunks: number; documents: number }[];
};

export type KbHit = {
	rank: number;
	score: number;
	score_type: string;
	mode: string;
	doc: string;
	file: string;
	page_id: string;
	origin: string;
	context: string;
	snippet: string;
	store?: string;
	source_kind: SourceKind;
	path: string | null;
	kb_rel: string | null;
};

export type KbQueryResult = {
	kb: string;
	kb_dir: string;
	query: string;
	mode: string;
	elapsed_ms: number;
	hits: KbHit[];
	note?: string;
};

export function kbRagUrl(): string {
	try {
		return localStorage.getItem(URL_KEY)?.trim() || DEFAULT_KB_RAG_URL;
	} catch {
		return DEFAULT_KB_RAG_URL;
	}
}

export function setKbRagUrl(url: string): void {
	try {
		if (url.trim()) localStorage.setItem(URL_KEY, url.trim());
		else localStorage.removeItem(URL_KEY);
	} catch {
		// storage unavailable: keep default
	}
}

export class KbRagError extends Error {
	constructor(
		message: string,
		readonly offline = false,
	) {
		super(message);
	}
}

async function get<T>(path: string, params?: Record<string, string>) {
	const url = new URL(path, kbRagUrl());
	for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v);
	let res: Response;
	try {
		res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
	} catch (err) {
		throw new KbRagError(String(err), true);
	}
	const body = (await res.json().catch(() => ({}))) as T & { error?: string };
	if (!res.ok) throw new KbRagError(body.error ?? `HTTP ${res.status}`);
	return body as T;
}

export async function kbHealth(): Promise<boolean> {
	try {
		const r = await get<{ ok: boolean }>("/health");
		return r.ok;
	} catch {
		return false;
	}
}

export async function kbList(): Promise<KbInfo[]> {
	const r = await get<{ kbs: KbInfo[] }>("/list");
	return r.kbs ?? [];
}

export function kbQuery(args: {
	kb: string;
	q: string;
	store: KbStore;
	mode: KbMode;
	k?: number;
}): Promise<KbQueryResult> {
	return get<KbQueryResult>("/query", {
		kb: args.kb,
		q: args.q,
		store: args.store,
		mode: args.mode,
		k: String(args.k ?? 12),
	});
}
