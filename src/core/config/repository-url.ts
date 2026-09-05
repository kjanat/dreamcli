/**
 * Repository locator normalization for `package.json` metadata.
 *
 * @module dreamcli/core/config/repository-url
 */

import { CLIError } from '#internals/core/errors/index.ts';
import { SLASH, stripTrailing } from '#internals/strings.ts';
import type { PackageJsonData } from './package-json.ts';

// --- packageRepositoryUrl

/** Browsable base URLs for npm repository shorthand prefixes. @internal */
const SHORTHAND_HOSTS: Readonly<Record<string, string>> = {
	github: 'https://github.com',
	gitlab: 'https://gitlab.com',
	bitbucket: 'https://bitbucket.org',
};

/** Strip a trailing `.git` suffix from a repository path. @internal */
function stripGitSuffix(path: string): string {
	return path.endsWith('.git') ? path.slice(0, -'.git'.length) : path;
}

/** Options for {@link packageRepositoryUrl}. */
interface PackageRepositoryUrlOptions {
	/**
	 * Throw a `CLIError` (code `INVALID_REPOSITORY`) instead of returning
	 * `undefined` when the `repository` field is absent or not a recognisable
	 * locator. With `require: true` the return type narrows to `string`, so
	 * callers that know their manifest carries a valid repository need no
	 * assertion — and a bad manifest fails fast with a real message instead
	 * of propagating `undefined`.
	 *
	 * @defaultValue `false`
	 */
	readonly require?: boolean;
}

/**
 * Resolve a package's `repository` field to a browsable `https://` URL.
 *
 * Handles the locator formats npm accepts:
 * - object form: `{ "type": "git", "url": "git+https://github.com/u/r.git" }`
 * - `https`/`git`/`ssh` URLs (`git+` prefix and `.git` suffix stripped)
 * - scp-style locators: `git@github.com:u/r.git`
 * - shorthands: `github:u/r`, `gitlab:u/r`, `bitbucket:u/r`, and bare `u/r`
 *   (GitHub, per npm convention)
 *
 * Returns `undefined` when the field is absent or unrecognised — or, with
 * `{ require: true }`, throws instead and the return type is `string`.
 * (The narrowing cannot key off the input type alone: a present `repository`
 * may still be an empty string, a url-less object, or an unparseable
 * locator, so the `string` promise is backed by the runtime check.)
 *
 * @example
 * ```ts
 * packageRepositoryUrl({ repository: 'git+https://github.com/u/r.git' });
 * // 'https://github.com/u/r'
 *
 * const url: string = packageRepositoryUrl(pkg, { require: true });
 * // throws CLIError when pkg.repository is missing or unrecognised
 * ```
 */
function packageRepositoryUrl(
	pkg: PackageJsonData,
	options: PackageRepositoryUrlOptions & { readonly require: true },
): string;
/** Resolve a package repository URL, returning `undefined` for absent or invalid locators. */
function packageRepositoryUrl(
	pkg: PackageJsonData,
	options?: PackageRepositoryUrlOptions,
): string | undefined;
function packageRepositoryUrl(
	pkg: PackageJsonData,
	options?: PackageRepositoryUrlOptions,
): string | undefined {
	const url = resolveRepositoryUrl(pkg);
	if (url === undefined && options?.require === true) {
		throw new CLIError(
			pkg.repository === undefined
				? "package.json has no 'repository' field"
				: `package.json 'repository' is not a recognisable locator: ${JSON.stringify(pkg.repository)}`,
			{
				code: 'INVALID_REPOSITORY',
				suggest:
					"Set 'repository' to a supported locator (e.g. 'github:user/repo' or 'git+https://github.com/user/repo.git'), or drop { require: true } and handle undefined",
			},
		);
	}
	return url;
}

/** Locator normalization behind {@link packageRepositoryUrl}. @internal */
function resolveRepositoryUrl(pkg: PackageJsonData): string | undefined {
	const raw = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
	if (raw === undefined) return undefined;

	let locator = raw.trim();
	if (locator.length === 0) return undefined;

	// npm shorthands: `github:u/r`, `gitlab:u/r`, `bitbucket:u/r`
	const shorthand = /^(github|gitlab|bitbucket):([^/]+\/[^/]+)$/.exec(locator);
	if (shorthand !== null && shorthand[1] !== undefined && shorthand[2] !== undefined) {
		const host = SHORTHAND_HOSTS[shorthand[1]];
		if (host !== undefined) {
			return `${host}/${stripGitSuffix(shorthand[2])}`;
		}
	}

	// Bare `u/r` implies GitHub (npm convention)
	if (/^[\w.-]+\/[\w.-]+$/.test(locator)) {
		return `https://github.com/${stripGitSuffix(locator)}`;
	}

	if (locator.startsWith('git+')) {
		locator = locator.slice('git+'.length);
	}

	// scp-style locator: `git@github.com:u/r.git`
	const scp = /^git@([^:/]+):(.+)$/.exec(locator);
	if (scp !== null && scp[1] !== undefined && scp[2] !== undefined) {
		return `https://${scp[1]}/${stripGitSuffix(stripTrailing(scp[2], [SLASH]))}`;
	}

	if (!/^(?:https?|git|ssh):\/\//.test(locator)) return undefined;
	try {
		const url = new URL(locator);
		const path = stripGitSuffix(stripTrailing(url.pathname, [SLASH]));
		return `https://${url.hostname}${path}`;
	} catch {
		return undefined;
	}
}

// --- inferCliName

// --- Exports

export type { PackageRepositoryUrlOptions };
export { packageRepositoryUrl };
