/**
 * Tests for runtime env access hints in missing-input diagnostics.
 *
 * @module dreamcli/core/resolve/resolve-env-access.test
 */

import { describe, expect, it } from 'vitest';
import { isValidationError } from '#internals/core/errors/index.ts';
import { arg } from '#internals/core/schema/arg.ts';
import { command } from '#internals/core/schema/command.ts';
import { flag } from '#internals/core/schema/flag.ts';
import { ENV_ACCESS_HINT } from './env-access.ts';
import { resolve } from './index.ts';

/** An env view that hints at every variable outside `granted`. */
function hintedEnv(granted: readonly string[] = []): Readonly<Record<string, string | undefined>> {
	const env: Record<string, string | undefined> = {};
	Object.defineProperty(env, ENV_ACCESS_HINT, {
		value: (name: string) => (granted.includes(name) ? undefined : `grant ${name}`),
	});
	return env;
}

async function suggestionFor(
	cmd: { readonly schema: Parameters<typeof resolve>[0] },
	env: Readonly<Record<string, string | undefined>>,
): Promise<string | undefined> {
	try {
		await resolve(cmd.schema, { flags: {}, args: {} }, { env });
	} catch (error) {
		if (isValidationError(error)) return error.suggest;
		throw error;
	}
	throw new Error('expected a validation error');
}

describe('env access hints', () => {
	const flagCmd = command('build').flag('wasmPath', flag.string().env('WASM_PATH').required());
	const argCmd = command('build').arg('target', arg.string().env('TARGET'));

	it('appends the hint to a required flag suggestion', async () => {
		expect(await suggestionFor(flagCmd, hintedEnv())).toBe(
			'Provide --wasmPath <value> or set WASM_PATH (grant WASM_PATH)',
		);
	});

	it('appends the hint to a required argument suggestion', async () => {
		expect(await suggestionFor(argCmd, hintedEnv())).toContain('set TARGET (grant TARGET)');
	});

	it('names the count variable of an indexed family', async () => {
		const cmd = command('build').flag(
			'servers',
			flag.array(flag.string()).env({ count: 'SERVER_COUNT', value: 'SERVER_{index}' }).required(),
		);
		expect(await suggestionFor(cmd, hintedEnv())).toContain(
			'set SERVER_COUNT and its entries (grant SERVER_COUNT)',
		);
	});

	it('adds nothing for a readable variable', async () => {
		expect(await suggestionFor(flagCmd, hintedEnv(['WASM_PATH']))).toBe(
			'Provide --wasmPath <value> or set WASM_PATH',
		);
	});

	it('adds nothing for a plain env record', async () => {
		expect(await suggestionFor(flagCmd, {})).toBe('Provide --wasmPath <value> or set WASM_PATH');
	});
});
