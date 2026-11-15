/**
 * Just enough YAML to compare a page's current frontmatter with a proposal's
 * frontmatter object, field by field. The merger (R `yaml::as.yaml`) owns the
 * exact output; the inbox only needs "which fields change, and to what". For
 * the byte-exact view, the detail pane can ask `kb_merge.R --show`.
 */

export function splitFrontmatter(text: string | null): {
	frontmatter: string | null;
	body: string;
} {
	if (text == null) return { frontmatter: null, body: "" };
	const t = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
	if (!t.startsWith("---\n")) return { frontmatter: null, body: t };
	const end = t.indexOf("\n---", 3);
	if (end < 0) return { frontmatter: null, body: t };
	const after = t.slice(end + 4);
	if (after && !after.startsWith("\n")) return { frontmatter: null, body: t };
	return {
		frontmatter: t.slice(4, end + 1),
		body: after.replace(/^\n+/, ""),
	};
}

/**
 * Top-level `key:` blocks with their continuation lines (indented lines and
 * R-style `- item` list lines at column 0).
 */
export function topLevelBlocks(
	frontmatter: string | null,
): Map<string, string> {
	const out = new Map<string, string>();
	if (!frontmatter) return out;
	let key: string | null = null;
	let buf: string[] = [];
	const flush = () => {
		if (key != null) out.set(key, buf.join("\n").replace(/\s+$/, ""));
	};
	for (const line of frontmatter.split("\n")) {
		const m = line.match(/^([^\s#-][^:]*):(?:\s|$)/);
		if (m && !line.startsWith(" ")) {
			flush();
			key = m[1].trim().replace(/^["']|["']$/g, "");
			buf = [line];
		} else if (key != null) {
			buf.push(line);
		}
	}
	flush();
	return out;
}

const PLAIN_SAFE = /^[^\s\-?:,[\]{}#&*!|>'"%@`][^:#]*$/;
const NEEDS_QUOTES = /^(true|false|yes|no|null|~|on|off|-?\d[\d.e+-]*)$/i;

function scalar(v: unknown): string {
	if (v === null || v === undefined) return "~";
	if (typeof v === "boolean" || typeof v === "number") return String(v);
	const s = String(v);
	if (s.includes("\n")) return `|-\n${s.replace(/^/gm, "  ")}`;
	if (s && PLAIN_SAFE.test(s) && !NEEDS_QUOTES.test(s) && s.trim() === s)
		return s;
	return `'${s.replace(/'/g, "''")}'`;
}

function render(value: unknown, indent: string): string[] {
	if (Array.isArray(value)) {
		if (!value.length) return ["[]"];
		return value.flatMap((item) => {
			const inner = render(item, `${indent}  `);
			if (inner.length === 1 && !isBlock(item))
				return [`${indent}- ${inner[0].trim()}`];
			return [`${indent}-`, ...inner];
		});
	}
	if (value && typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>);
		if (!entries.length) return ["{}"];
		return entries.flatMap(([k, v]) => {
			if (isBlock(v)) return [`${indent}${k}:`, ...render(v, `${indent}  `)];
			return [`${indent}${k}: ${scalar(v)}`];
		});
	}
	return [scalar(value)];
}

function isBlock(v: unknown): boolean {
	return (
		(Array.isArray(v) && v.length > 0) ||
		(!!v &&
			typeof v === "object" &&
			!Array.isArray(v) &&
			Object.keys(v as object).length > 0)
	);
}

/** `key: value` block for one field, in the style kb-template writes. */
export function renderField(key: string, value: unknown): string {
	if (isBlock(value)) return [`${key}:`, ...render(value, "")].join("\n");
	const r = render(value, "");
	return `${key}: ${r[0]}`;
}

/** Whole frontmatter + body as the page the proposal would write. */
export function renderPage(
	frontmatter: Record<string, unknown> | undefined,
	body: string | undefined,
): string {
	const fm = Object.entries(frontmatter ?? {})
		.map(([k, v]) => renderField(k, v))
		.join("\n");
	return `---\n${fm}\n---\n\n${body ?? ""}`;
}

/** Compare two field blocks ignoring quoting and whitespace style. */
export function sameField(a: string | null, b: string | null): boolean {
	if (a == null || b == null) return a === b;
	const norm = (s: string) =>
		s
			.replace(/^[^:]*:/, "")
			.replace(/["']/g, "")
			.replace(/^\s*-\s*/gm, "- ")
			.replace(/\s+/g, " ")
			.trim();
	return norm(a) === norm(b);
}

export type FieldRow = {
	key: string;
	before: string | null;
	after: string | null;
	changed: boolean;
};

/**
 * Field rows for a proposal. `replace` = new/edit page (fields absent from the
 * proposal are dropped); otherwise only the listed fields are set (link/gate).
 */
export function fieldRows(
	currentFrontmatter: string | null,
	proposed: Record<string, unknown> | undefined,
	replace: boolean,
): FieldRow[] {
	const cur = topLevelBlocks(currentFrontmatter);
	const rows: FieldRow[] = [];
	const seen = new Set<string>();
	for (const [key, value] of Object.entries(proposed ?? {})) {
		seen.add(key);
		const before = cur.get(key) ?? null;
		const after = renderField(key, value);
		rows.push({ key, before, after, changed: !sameField(before, after) });
	}
	if (replace) {
		for (const [key, before] of cur) {
			if (seen.has(key)) continue;
			rows.push({ key, before, after: null, changed: true });
		}
	}
	return rows;
}
