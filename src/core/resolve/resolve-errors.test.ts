import { describe, expect, it } from 'vitest';
import { isValidationError, type ValidationError } from '#internals/core/errors/index.ts';
import type { ParseResult } from '#internals/core/parse/index.ts';
import type { CommandSchema } from '#internals/core/schema/command.ts';
import { createSchema } from '#internals/core/schema/flag.ts';
import { resolve } from './index.ts';

// --- Helpers

function makeSchema(overrides: Partial<CommandSchema> = {}): CommandSchema {
	return {
		name: 'test',
		description: undefined,
		aliases: [],
		hidden: false,
		examples: [],
		flags: {},
		args: [],
		hasAction: false,
		interactive: undefined,
		middleware: [],
		commands: [],
		...overrides,
	};
}

function makeParsed(overrides: Partial<ParseResult> = {}): ParseResult {
	return {
		flags: {},
		args: {},
		...overrides,
	};
}

/**
 * Helper to catch the ValidationError from resolve() and return it.
 * Fails the test if resolve does not throw.
 */
async function catchValidationError(
	schema: CommandSchema,
	parsed: ParseResult,
	options?: Parameters<typeof resolve>[2],
): Promise<ValidationError> {
	try {
		await resolve(schema, parsed, options);
		expect.unreachable('should have thrown');
	} catch (err) {
		expect(isValidationError(err)).toBe(true);
		return err as ValidationError;
	}
	// Unreachable, but satisfies TS
	throw new Error('unreachable');
}

// === Actionable required flag hints — resolution source suggestions

describe('resolve — required flag actionable hints', () => {
	// -- CLI-only (no env/config configured) ---------------------------------

	it('suggests only --flag when no env or config configured', async () => {
		const schema = makeSchema({
			flags: {
				token: createSchema('string', { presence: 'required' }),
			},
		});
		const err = await catchValidationError(schema, makeParsed());
		expect(err.suggest).toBe('Provide --token <value>');
	});

	it('suggests only --flag for boolean (no <value> hint)', async () => {
		const schema = makeSchema({
			flags: {
				confirm: createSchema('boolean', { presence: 'required' }),
			},
		});
		const err = await catchValidationError(schema, makeParsed());
		expect(err.suggest).toBe('Provide --confirm');
	});

	// -- CLI + env -----------------------------------------------------------

	it('suggests --flag or env when envVar configured', async () => {
		const schema = makeSchema({
			flags: {
				token: createSchema('string', {
					presence: 'required',
					envVar: 'API_TOKEN',
				}),
			},
		});
		const err = await catchValidationError(schema, makeParsed());
		expect(err.suggest).toBe('Provide --token <value> or set API_TOKEN');
	});

	// -- CLI + config --------------------------------------------------------

	it('suggests --flag or config when configPath configured', async () => {
		const schema = makeSchema({
			flags: {
				region: createSchema('enum', {
					presence: 'required',
					enumValues: ['us', 'eu', 'ap'],
					configPath: 'deploy.region',
				}),
			},
		});
		const err = await catchValidationError(schema, makeParsed());
		expect(err.suggest).toBe('Provide --region <value> or add deploy.region to config');
	});

	// -- CLI + env + config (full chain) ------------------------------------

	it('suggests all three sources when env and config configured', async () => {
		const schema = makeSchema({
			flags: {
				region: createSchema('enum', {
					presence: 'required',
					enumValues: ['us', 'eu', 'ap'],
					envVar: 'DEPLOY_REGION',
					configPath: 'deploy.region',
				}),
			},
		});
		const err = await catchValidationError(schema, makeParsed());
		expect(err.suggest).toBe(
			'Provide --region <value>, set DEPLOY_REGION, or add deploy.region to config',
		);
	});

	it('boolean with env and config lists all sources', async () => {
		const schema = makeSchema({
			flags: {
				dryRun: createSchema('boolean', {
					presence: 'required',
					envVar: 'DRY_RUN',
					configPath: 'ci.dryRun',
				}),
			},
		});
		const err = await catchValidationError(schema, makeParsed());
		expect(err.suggest).toBe('Provide --dryRun, set DRY_RUN, or add ci.dryRun to config');
	});

	// -- Details include resolution sources ---------------------------------

	it('includes envVar in details when configured', async () => {
		const schema = makeSchema({
			flags: {
				token: createSchema('string', {
					presence: 'required',
					envVar: 'API_TOKEN',
				}),
			},
		});
		const err = await catchValidationError(schema, makeParsed());
		expect(err.details).toEqual({
			flag: 'token',
			kind: 'string',
			envVar: 'API_TOKEN',
		});
	});

	it('includes configPath in details when configured', async () => {
		const schema = makeSchema({
			flags: {
				region: createSchema('string', {
					presence: 'required',
					configPath: 'deploy.region',
				}),
			},
		});
		const err = await catchValidationError(schema, makeParsed());
		expect(err.details).toEqual({
			flag: 'region',
			kind: 'string',
			configPath: 'deploy.region',
		});
	});

	it('includes both envVar and configPath in details', async () => {
		const schema = makeSchema({
			flags: {
				region: createSchema('string', {
					presence: 'required',
					envVar: 'DEPLOY_REGION',
					configPath: 'deploy.region',
				}),
			},
		});
		const err = await catchValidationError(schema, makeParsed());
		expect(err.details).toEqual({
			flag: 'region',
			kind: 'string',
			envVar: 'DEPLOY_REGION',
			configPath: 'deploy.region',
		});
	});

	it('omits envVar and configPath from details when not configured', async () => {
		const schema = makeSchema({
			flags: {
				token: createSchema('string', { presence: 'required' }),
			},
		});
		const err = await catchValidationError(schema, makeParsed());
		expect(err.details).toEqual({ flag: 'token', kind: 'string' });
		expect(err.details).not.toHaveProperty('envVar');
		expect(err.details).not.toHaveProperty('configPath');
	});

	// -- Aggregated errors preserve per-flag suggestions --------------------

	it('aggregated error preserves per-flag suggest with sources', async () => {
		const schema = makeSchema({
			flags: {
				token: createSchema('string', {
					presence: 'required',
					envVar: 'API_TOKEN',
				}),
				region: createSchema('enum', {
					presence: 'required',
					enumValues: ['us', 'eu'],
					envVar: 'DEPLOY_REGION',
					configPath: 'deploy.region',
				}),
			},
		});
		const err = await catchValidationError(schema, makeParsed());

		// Aggregated error wraps individual errors
		expect(err.message).toContain('Multiple validation errors');
		const errors = (err.details as Record<string, unknown>).errors as Array<
			Record<string, unknown>
		>;
		expect(errors).toHaveLength(2);

		// Each individual error has its own source-aware suggestion
		const tokenErr = errors.find((e) => (e.details as Record<string, unknown>).flag === 'token');
		const regionErr = errors.find((e) => (e.details as Record<string, unknown>).flag === 'region');

		expect(tokenErr).toBeDefined();
		expect(regionErr).toBeDefined();
		expect(tokenErr?.suggest).toBe('Provide --token <value> or set API_TOKEN');
		expect(regionErr?.suggest).toBe(
			'Provide --region <value>, set DEPLOY_REGION, or add deploy.region to config',
		);
	});

	// -- Still throws even when env/config are provided but value is absent --

	it('throws with sources when env record provided but var is missing', async () => {
		const schema = makeSchema({
			flags: {
				token: createSchema('string', {
					presence: 'required',
					envVar: 'API_TOKEN',
				}),
			},
		});
		// Env record provided but without the expected key
		const err = await catchValidationError(schema, makeParsed(), { env: { OTHER_VAR: 'x' } });
		expect(err.suggest).toBe('Provide --token <value> or set API_TOKEN');
	});

	it('throws with sources when config provided but path is missing', async () => {
		const schema = makeSchema({
			flags: {
				region: createSchema('string', {
					presence: 'required',
					configPath: 'deploy.region',
				}),
			},
		});
		// Config provided but without the expected path
		const err = await catchValidationError(schema, makeParsed(), {
			config: { deploy: { other: 'x' } },
		});
		expect(err.suggest).toBe('Provide --region <value> or add deploy.region to config');
	});

	// -- Number flag with env/config sources --------------------------------

	it('number flag required error includes env/config sources', async () => {
		const schema = makeSchema({
			flags: {
				port: createSchema('number', {
					presence: 'required',
					envVar: 'PORT',
					configPath: 'server.port',
				}),
			},
		});
		const err = await catchValidationError(schema, makeParsed());
		expect(err.suggest).toBe('Provide --port <value>, set PORT, or add server.port to config');
	});
});
