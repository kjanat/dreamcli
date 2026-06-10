/**
 * Root-help header hyperlink resolution.
 *
 * Stores explicit `.links()` URLs and derives missing ones from package.json
 * metadata (`repository` / `homepage`) once that data is available — during
 * runtime preflight for `.run()`, or directly from pre-loaded
 * `.packageJson(data)` for `.execute()`.
 *
 * @module dreamcli/core/cli/help-links
 * @internal
 */

import type { PackageJsonData } from '#internals/core/config/package-json.ts';
import { packageRepositoryUrl } from '#internals/core/config/package-json.ts';

/**
 * OSC 8 hyperlink targets for the root-help header.
 *
 * Set via `CLIBuilder.links()`; fields left `undefined` are derived from
 * package.json metadata when `.packageJson()` is active.
 */
interface HelpLinks {
	/** URL the program name links to (e.g. the repository or homepage). */
	readonly name: string | undefined;
	/** URL the version links to (e.g. the release tag). */
	readonly version: string | undefined;
}

/**
 * Build the release-tag URL for a version on a known forge.
 *
 * GitHub and GitLab have stable release-tag routes; other hosts return
 * `undefined` rather than guessing.
 *
 * @internal
 */
function releaseTagUrl(repoUrl: string, version: string): string | undefined {
	let hostname: string;
	try {
		hostname = new URL(repoUrl).hostname;
	} catch {
		return undefined;
	}
	if (hostname === 'github.com') return `${repoUrl}/releases/tag/v${version}`;
	if (hostname === 'gitlab.com') return `${repoUrl}/-/releases/v${version}`;
	return undefined;
}

/**
 * Fill `undefined` link fields from package.json metadata.
 *
 * Explicit URLs always win. The name falls back to the normalized
 * `repository` URL, then `homepage`; the version falls back to the forge
 * release-tag URL when both a repository and a version are known.
 * Idempotent — already-resolved fields pass through unchanged.
 *
 * @internal
 */
function deriveHelpLinks(
	links: HelpLinks | undefined,
	pkg: PackageJsonData | undefined,
	version: string | undefined,
): HelpLinks | undefined {
	if (links === undefined) return undefined;
	if (pkg === undefined || (links.name !== undefined && links.version !== undefined)) {
		return links;
	}
	const repoUrl = packageRepositoryUrl(pkg);
	return {
		name: links.name ?? repoUrl ?? pkg.homepage,
		version:
			links.version ??
			(repoUrl !== undefined && version !== undefined
				? releaseTagUrl(repoUrl, version)
				: undefined),
	};
}

// --- Exports

export type { HelpLinks };
export { deriveHelpLinks };
