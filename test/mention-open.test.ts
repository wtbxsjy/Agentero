import { beforeEach, describe, expect, it, vi } from "vitest";

const { openFolderLibrary, openVaultRel } = vi.hoisted(() => ({
	openFolderLibrary: vi.fn(),
	openVaultRel: vi.fn(),
}));
vi.mock("@/lib/workspace/actions", () => ({
	openFolderLibrary,
	openVaultRel,
}));

import { openMentionTarget } from "@/lib/agent/mention-open";

beforeEach(() => {
	openFolderLibrary.mockClear();
	openVaultRel.mockClear();
});

describe("openMentionTarget", () => {
	it("opens vault paths in the workspace", () => {
		openMentionTarget("papers/attention/NOTES.md");

		expect(openVaultRel).toHaveBeenCalledWith("papers/attention/NOTES.md");
	});

	it("scopes the library for a plain folder mention", () => {
		openMentionTarget("notes");

		expect(openFolderLibrary).toHaveBeenCalledWith("notes");
		expect(openVaultRel).not.toHaveBeenCalled();
	});

	it("ignores empty paths", () => {
		openMentionTarget("   ");
		openMentionTarget(null);

		expect(openVaultRel).not.toHaveBeenCalled();
		expect(openFolderLibrary).not.toHaveBeenCalled();
	});
});
