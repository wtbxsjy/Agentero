/**
 * Compile-time switches for the modules this fork drops.
 *
 * This build is a dedicated domain wiki / knowledge-base tool. The modules
 * below are hidden at their UI entry points first (P0, step 1) and deleted
 * module by module afterwards (P0, step 2). Flip one to `true` only to check
 * whether something still depends on it before its deletion PR.
 *
 * Plugins and account surfaces have their own upstream switches
 * (`lib/plugins/visibility.ts`, `features/account/visibility.ts`).
 */
export const surfaces = {
	/** Zhihu agent row and the "ask on Zhihu" paper action. */
	zhihu: false,
	/** Remote SSH/SFTP vaults. */
	remoteVault: false,
	/** Word add-in citation dialog. */
	wordCitation: false,
	/** In-app updater: it points at the official releases and would replace this fork. */
	updater: false,
} as const satisfies Record<string, boolean>;
