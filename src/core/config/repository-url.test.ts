/**
 * Unit tests for repository locator normalization.
 *
 * Covers every locator form npm accepts, the `undefined` contract for absent
 * or unrecognised fields, and the `{ require: true }` overload.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import { isCLIError } from '#internals/core/errors/index.ts';
import { packageRepositoryUrl } from './repository-url.ts';

// === packageRepositoryUrl — repository field normalization

describe('packageRepositoryUrl — repository field normalization', () => {
	it('strips git+ prefix and .git suffix from https URLs', () => {
		expect(packageRepositoryUrl({ repository: 'git+https://github.com/me/myapp.git' })).toBe(
			'https://github.com/me/myapp',
		);
	});

	it('passes plain https URLs through (trailing slash removed)', () => {
		expect(packageRepositoryUrl({ repository: 'https://github.com/me/myapp/' })).toBe(
			'https://github.com/me/myapp',
		);
	});

	it('resolves the object form via its url field', () => {
		expect(
			packageRepositoryUrl({
				repository: { type: 'git', url: 'git+https://github.com/me/myapp.git' },
			}),
		).toBe('https://github.com/me/myapp');
	});

	it('converts scp-style locators (git@host:path)', () => {
		expect(packageRepositoryUrl({ repository: 'git@github.com:me/myapp.git' })).toBe(
			'https://github.com/me/myapp',
		);
	});

	it('converts git:// and ssh:// URLs to https', () => {
		expect(packageRepositoryUrl({ repository: 'git://github.com/me/myapp.git' })).toBe(
			'https://github.com/me/myapp',
		);
		expect(packageRepositoryUrl({ repository: 'ssh://git@github.com/me/myapp.git' })).toBe(
			'https://github.com/me/myapp',
		);
	});

	it('expands github/gitlab/bitbucket shorthands', () => {
		expect(packageRepositoryUrl({ repository: 'github:me/myapp' })).toBe(
			'https://github.com/me/myapp',
		);
		expect(packageRepositoryUrl({ repository: 'gitlab:me/myapp' })).toBe(
			'https://gitlab.com/me/myapp',
		);
		expect(packageRepositoryUrl({ repository: 'bitbucket:me/myapp' })).toBe(
			'https://bitbucket.org/me/myapp',
		);
	});

	it('treats bare user/repo as a GitHub shorthand (npm convention)', () => {
		expect(packageRepositoryUrl({ repository: 'me/myapp' })).toBe('https://github.com/me/myapp');
	});

	it('returns undefined for missing, empty, or unrecognised locators', () => {
		expect(packageRepositoryUrl({})).toBeUndefined();
		expect(packageRepositoryUrl({ repository: '  ' })).toBeUndefined();
		expect(packageRepositoryUrl({ repository: 'not a repo' })).toBeUndefined();
		expect(packageRepositoryUrl({ repository: { type: 'git' } })).toBeUndefined();
	});

	describe('{ require: true }', () => {
		it('narrows the return type to string', () => {
			// Assignment to `string` (no undefined, no assertion) IS the test.
			const url: string = packageRepositoryUrl(
				{ repository: 'github:me/myapp' },
				{ require: true },
			);
			expect(url).toBe('https://github.com/me/myapp');
			expectTypeOf(
				packageRepositoryUrl({ repository: 'github:me/myapp' }, { require: true }),
			).toEqualTypeOf<string>();
			expectTypeOf(packageRepositoryUrl({ repository: 'github:me/myapp' })).toEqualTypeOf<
				string | undefined
			>();
		});

		it('throws INVALID_REPOSITORY when the field is missing', () => {
			try {
				packageRepositoryUrl({}, { require: true });
				expect.unreachable('expected INVALID_REPOSITORY');
			} catch (error) {
				if (!isCLIError(error)) throw error;
				expect(error.code).toBe('INVALID_REPOSITORY');
				expect(error.message).toContain("no 'repository' field");
			}
		});

		it('throws INVALID_REPOSITORY for unrecognised locators, naming the value', () => {
			expect(() => packageRepositoryUrl({ repository: 'not a repo' }, { require: true })).toThrow(
				/not a recognisable locator: "not a repo"/,
			);
			expect(() =>
				packageRepositoryUrl({ repository: { type: 'git' } }, { require: true }),
			).toThrow(/not a recognisable locator/);
		});

		it('require: false keeps the undefined-returning behavior', () => {
			expect(packageRepositoryUrl({}, { require: false })).toBeUndefined();
		});
	});
});
