/**
 * Tests for `.negatable()` booleans and the `.duplicates()` policy.
 *
 * @module dreamcli/core/schema/flag-negatable-duplicates.test
 */

import { describe, expect, it } from 'vitest';
import { isParseError } from '#internals/core/errors/index.ts';
import { parse } from '#internals/core/parse/index.ts';
import { runCommand } from '#internals/core/testkit/index.ts';
import { command } from './command.ts';
import { flag, getFlagNegatedName } from './flag.ts';

function boolCmd() {
	return command('build')
		.flag('sandbox', flag.boolean().default(true).negatable())
		.action(() => {});
}

describe('flag.boolean().negatable()', () => {
	it('parses --no-<name> as false', () => {
		const parsed = parse(boolCmd().schema, ['--no-sandbox']);
		expect(parsed.flags['sandbox']).toBe(false);
	});

	it('parses the positive spelling as true', () => {
		const parsed = parse(boolCmd().schema, ['--sandbox']);
		expect(parsed.flags['sandbox']).toBe(true);
	});

	it('keeps explicit =true/=false on the positive spelling', () => {
		expect(parse(boolCmd().schema, ['--sandbox=false']).flags['sandbox']).toBe(false);
		expect(parse(boolCmd().schema, ['--sandbox=true']).flags['sandbox']).toBe(true);
	});

	it('last occurrence wins across both spellings', () => {
		expect(parse(boolCmd().schema, ['--sandbox', '--no-sandbox']).flags['sandbox']).toBe(false);
		expect(parse(boolCmd().schema, ['--no-sandbox', '--sandbox']).flags['sandbox']).toBe(true);
	});

	it('rejects a value on the negated spelling', () => {
		expect(() => parse(boolCmd().schema, ['--no-sandbox=true'])).toThrow(
			/--no-sandbox does not take a value/,
		);
		expect(() => parse(boolCmd().schema, ['--no-sandbox=false'])).toThrow(/does not take a value/);
	});

	it('supports a custom negated alias', () => {
		const cmd = command('run')
			.flag('color', flag.boolean().negatable({ alias: 'plain' }))
			.action(() => {});
		expect(parse(cmd.schema, ['--plain']).flags['color']).toBe(false);
		// The synthesized default spelling is NOT registered alongside a custom alias.
		expect(() => parse(cmd.schema, ['--no-color'])).toThrow(/Unknown flag/);
	});

	it('resolves through the full pipeline (env/config untouched)', async () => {
		let seen: boolean | undefined;
		const cmd = command('build')
			.flag('sandbox', flag.boolean().default(true).negatable().env('SANDBOX'))
			.action(({ flags }) => {
				seen = flags.sandbox;
			});
		await runCommand(cmd, ['--no-sandbox'], { env: { SANDBOX: 'true' } });
		expect(seen).toBe(false);
	});

	it('throws a schema-time collision when the negated spelling clashes', () => {
		expect(
			() =>
				command('run')
					.flag('sandbox', flag.boolean().negatable())
					.flag('no-sandbox', flag.boolean()).schema.flags,
		).toThrow(/collides|collision|no-sandbox/i);
	});
});

describe('getFlagNegatedName', () => {
	it('synthesizes no-<name> by default and honors custom aliases', () => {
		const plain = flag.boolean().schema;
		const negatable = flag.boolean().negatable().schema;
		const custom = flag.boolean().negatable({ alias: 'plain' }).schema;
		expect(getFlagNegatedName('color', plain)).toBeUndefined();
		expect(getFlagNegatedName('color', negatable)).toBe('no-color');
		expect(getFlagNegatedName('color', custom)).toBe('plain');
	});
});

describe('.duplicates()', () => {
	it("defaults to 'last' (historic behavior)", () => {
		const cmd = command('run')
			.flag('region', flag.string())
			.action(() => {});
		expect(parse(cmd.schema, ['--region', 'us', '--region', 'eu']).flags['region']).toBe('eu');
	});

	it("'error' rejects the second occurrence with DUPLICATE_FLAG details", () => {
		const cmd = command('run')
			.flag('spawn', flag.enum(['session', 'same-dir', 'worktree']).duplicates('error'))
			.action(() => {});
		try {
			parse(cmd.schema, ['--spawn', 'same-dir', '--spawn', 'worktree']);
			expect.unreachable('expected DUPLICATE_FLAG');
		} catch (error) {
			if (!isParseError(error)) throw error;
			expect(error.message).toBe('Flag --spawn may only be specified once');
			expect(error.code).toBe('DUPLICATE_FLAG');
			expect(error.details).toMatchObject({
				flag: 'spawn',
				count: 2,
				values: ['same-dir', 'worktree'],
			});
		}
	});

	it("'error' counts aliases toward the same logical flag", () => {
		const cmd = command('run')
			.flag('capacity', flag.number().alias('c').duplicates('error'))
			.action(() => {});
		expect(() => parse(cmd.schema, ['--capacity', '2', '-c', '3'])).toThrow(
			/--capacity may only be specified once/,
		);
	});

	it("'error' counts negated spellings toward the same logical flag", () => {
		const cmd = command('run')
			.flag('sandbox', flag.boolean().negatable().duplicates('error'))
			.action(() => {});
		expect(() => parse(cmd.schema, ['--sandbox', '--no-sandbox'])).toThrow(
			/--sandbox may only be specified once/,
		);
	});

	it("'first' keeps the first value and still consumes later value tokens", () => {
		const schema = command('run')
			.flag('region', flag.string().duplicates('first'))
			.action(() => {}).schema;
		// Without token consumption 'eu' would leak into positionals and throw.
		const parsed = parse(schema, ['--region', 'us', '--region', 'eu']);
		expect(parsed.flags['region']).toBe('us');
	});

	it("'first' does not leak the suppressed value into positionals", () => {
		const schema = command('copy')
			.flag('mode', flag.string().duplicates('first'))
			.action(() => {}).schema;
		// 'fast' is consumed by the suppressed second occurrence; only 'extra'
		// remains as an (unexpected) positional.
		expect(() => parse(schema, ['--mode', 'slow', '--mode', 'fast', 'extra'])).toThrow(
			/Unexpected positional argument: extra/,
		);
	});

	it('CLI + env is precedence, not a duplicate', async () => {
		let seen: string | undefined;
		const cmd = command('run')
			.flag('region', flag.string().env('REGION').duplicates('error'))
			.action(({ flags }) => {
				seen = flags.region;
			});
		const result = await runCommand(cmd, ['--region', 'us'], { env: { REGION: 'eu' } });
		expect(result.exitCode).toBe(0);
		expect(seen).toBe('us');
	});
});
