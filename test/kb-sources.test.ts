import { describe, expect, it } from "vitest";
import { sourceKindOfVaultPath, toVaultRel } from "@/features/kb/sources";

describe("kb sources", () => {
	it("maps absolute hit paths into the vault", () => {
		expect(toVaultRel("/v/Research/kb/T/wiki/a.md", "/v/Research")).toBe(
			"kb/T/wiki/a.md",
		);
		expect(toVaultRel("C:\\V\\kb\\T\\raw\\x.md", "C:\\V\\")).toBe(
			"kb/T/raw/x.md",
		);
		expect(toVaultRel("/v/ResearchOld/kb/a.md", "/v/Research")).toBeNull();
	});

	it("classifies the four source kinds by location", () => {
		expect(sourceKindOfVaultPath("papers/1706.03762/NOTES.md")).toBe("paper");
		expect(sourceKindOfVaultPath("kb/T/raw/r1.md")).toBe("raw");
		expect(sourceKindOfVaultPath("kb/T/wiki/attention.md")).toBe("wiki");
		expect(sourceKindOfVaultPath("kb/T/wiki/evidence/e1.md")).toBe("evidence");
		expect(sourceKindOfVaultPath("notes/idea.md")).toBe("other");
	});
});
