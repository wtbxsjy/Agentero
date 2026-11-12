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
		// kb-rag in WSL, Agentero on Windows
		expect(toVaultRel("/mnt/d/Vault/kb/T/raw/x.md", "D:\\Vault")).toBe(
			"kb/T/raw/x.md",
		);
		expect(toVaultRel("/mnt/d/Vault/kb/a.md", "\\\\?\\D:\\Vault")).toBe(
			"kb/a.md",
		);
	});

	it("classifies the four source kinds by location", () => {
		expect(sourceKindOfVaultPath("papers/1706.03762/NOTES.md")).toBe("paper");
		expect(sourceKindOfVaultPath("kb/T/raw/r1.md")).toBe("raw");
		expect(sourceKindOfVaultPath("kb/T/wiki/attention.md")).toBe("wiki");
		expect(sourceKindOfVaultPath("kb/T/wiki/evidence/e1.md")).toBe("evidence");
		expect(sourceKindOfVaultPath("kb/T/wiki_Demo/evidence/e1.md")).toBe(
			"evidence",
		);
		expect(sourceKindOfVaultPath("notes/idea.md")).toBe("other");
	});

	it("maps a WSL knowledge base onto a WSL vault opened via UNC", () => {
		const plain = String.raw`\\wsl.localhost\Ubuntu-24.04\home\u\Vault`;
		expect(toVaultRel("/home/u/Vault/kb/T/raw/x.md", plain)).toBe(
			"kb/T/raw/x.md",
		);
		const verbatim = String.raw`\\?\UNC\wsl.localhost\Ubuntu-24.04\home\u\Vault`;
		expect(toVaultRel("/home/u/Vault/kb/T/wiki/a.md", verbatim)).toBe(
			"kb/T/wiki/a.md",
		);
		const wslDollar = String.raw`\\wsl$\Ubuntu-24.04\home\u\Vault`;
		expect(toVaultRel("/home/u/Vault/kb/a.md", wslDollar)).toBe("kb/a.md");
	});

	it("classifies flat topic layouts (KB dir opened as the vault)", () => {
		expect(sourceKindOfVaultPath("JamesZou/raw/mineru/x.md")).toBe("raw");
		expect(sourceKindOfVaultPath("JamesZou/wiki_jzou/entities/x.md")).toBe(
			"wiki",
		);
		expect(sourceKindOfVaultPath("JamesZou/wiki_jzou/evidence/e.md")).toBe(
			"evidence",
		);
	});
});
