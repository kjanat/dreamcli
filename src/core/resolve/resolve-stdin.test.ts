import { describe, expect, it } from 'vitest';
import { parse } from '#internals/core/parse/index.ts';
import type { ArgBuilder, ArgConfig } from '#internals/core/schema/arg.ts';
import { arg } from '#internals/core/schema/arg.ts';
import { command } from '#internals/core/schema/command.ts';
import { resolve } from './index.ts';

// === resolve — stdin args

// --- helpers
function parseCommandArg(target: ArgBuilder<ArgConfig>, argv: readonly string[]) {
	const schema = command('deploy')
		.arg('target', target)
		.action(() => {}).schema;
	return { schema, parsed: parse(schema, argv) };
}

// --- tests

describe('resolve — stdin args', () => {
	it('resolves stdin data when no CLI value is provided', async () => {
		const { schema, parsed } = parseCommandArg(arg.string().stdin(), []);

		const result = await resolve(schema, parsed, { stdinData: 'stdin-target' });

		expect(result.args).toEqual({ target: 'stdin-target' });
	});

	it('prefers CLI arg over stdin data', async () => {
		const { schema, parsed } = parseCommandArg(arg.string().stdin(), ['cli-target']);

		const result = await resolve(schema, parsed, { stdinData: 'stdin-target' });

		expect(result.args).toEqual({ target: 'cli-target' });
	});

	it("treats '-' as an explicit stdin selector", async () => {
		const { schema, parsed } = parseCommandArg(arg.string().stdin(), ['-']);

		const result = await resolve(schema, parsed, { stdinData: 'dash-target' });

		expect(result.args).toEqual({ target: 'dash-target' });
	});

	it("falls through from '-' to env and default when stdin has no data", async () => {
		const { schema, parsed } = parseCommandArg(
			arg.string().stdin().env('DEPLOY_TARGET').default('default-target'),
			['-'],
		);

		const result = await resolve(schema, parsed, {
			env: { DEPLOY_TARGET: 'env-target' },
		});

		expect(result.args).toEqual({ target: 'env-target' });
	});

	it('uses stdin before env for stdin-mode args', async () => {
		const { schema, parsed } = parseCommandArg(arg.string().stdin().env('DEPLOY_TARGET'), []);

		const result = await resolve(schema, parsed, {
			stdinData: 'stdin-target',
			env: { DEPLOY_TARGET: 'env-target' },
		});

		expect(result.args).toEqual({ target: 'stdin-target' });
	});

	it('leaves optional stdin arg undefined when no data is available', async () => {
		const { schema, parsed } = parseCommandArg(arg.string().stdin().optional(), []);

		const result = await resolve(schema, parsed);

		expect(result.args).toEqual({ target: undefined });
	});

	it('falls through to default when stdin has no data', async () => {
		const { schema, parsed } = parseCommandArg(arg.string().stdin().default('default-target'), []);

		const result = await resolve(schema, parsed);

		expect(result.args).toEqual({ target: 'default-target' });
	});

	it('coerces stdin data for number args', async () => {
		const schema = command('deploy')
			.arg('count', arg.number().stdin())
			.action(() => {}).schema;
		const parsed = parse(schema, []);

		const result = await resolve(schema, parsed, { stdinData: '42' });

		expect(result.args).toEqual({ count: 42 });
	});

	it('applies custom arg parsers to stdin data', async () => {
		const schema = command('deploy')
			.arg('target', arg.custom((value) => ({ value, upper: value.toUpperCase() })).stdin())
			.action(() => {}).schema;
		const parsed = parse(schema, []);

		const result = await resolve(schema, parsed, { stdinData: 'stdin-target' });

		expect(result.args).toEqual({
			target: { value: 'stdin-target', upper: 'STDIN-TARGET' },
		});
	});
});
