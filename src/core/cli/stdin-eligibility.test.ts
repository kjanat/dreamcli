import { describe, expect, it } from 'vitest';
import { arg } from '#internals/core/schema/arg.ts';
import { command } from '#internals/core/schema/command.ts';
import { flag } from '#internals/core/schema/flag.ts';
import { createTestAdapter, ExitError } from '#internals/runtime/adapter.ts';
import { cli } from './index.ts';

// === L15 — stdin is read only when resolution will select it

// --- helpers

/** Run to completion, swallowing the adapter's exit signal. */
async function runQuietly(invoke: () => Promise<unknown>): Promise<void> {
	try {
		await invoke();
	} catch (error) {
		if (!(error instanceof ExitError)) throw error;
	}
}

/** An adapter whose `readStdin()` counts its own calls. */
function countingAdapter(options: { argv: readonly string[]; stdinData?: string }) {
	const base = createTestAdapter({
		argv: ['node', 'cli', ...options.argv],
		...(options.stdinData !== undefined ? { stdinData: options.stdinData } : {}),
	});
	let reads = 0;
	return {
		adapter: {
			...base,
			readStdin: () => {
				reads += 1;
				return base.readStdin();
			},
		},
		reads: () => reads,
	};
}

// --- arg surface

describe('arg stdin eligibility', () => {
	it('reads stdin once when the positional is absent', async () => {
		const seen: unknown[] = [];
		const app = cli('mycli').default(
			command('run')
				.arg('input', arg.string().stdin().optional())
				.action(({ args }) => {
					seen.push(args.input);
				}),
		);
		const host = countingAdapter({ argv: [], stdinData: 'piped\n' });

		await runQuietly(() => app.run({ adapter: host.adapter }));

		expect(host.reads()).toBe(1);
		expect(seen).toEqual(['piped\n']);
	});

	it('does not read stdin when the positional was supplied', async () => {
		const app = cli('mycli').default(
			command('run')
				.arg('input', arg.string().stdin())
				.action(() => {}),
		);
		const host = countingAdapter({ argv: ['given'], stdinData: 'piped' });

		await runQuietly(() => app.run({ adapter: host.adapter }));

		expect(host.reads()).toBe(0);
	});

	it("does not read stdin for a 'dash' binding the invocation never dashes", async () => {
		const app = cli('mycli').default(
			command('run')
				.arg('input', arg.string().stdin({ when: 'dash' }).optional())
				.action(() => {}),
		);
		const host = countingAdapter({ argv: [], stdinData: 'piped' });

		await runQuietly(() => app.run({ adapter: host.adapter }));

		expect(host.reads()).toBe(0);
	});

	it("reads stdin for a 'dash' binding given an explicit dash", async () => {
		const app = cli('mycli').default(
			command('run')
				.arg('input', arg.string().stdin({ when: 'dash' }))
				.action(() => {}),
		);
		const host = countingAdapter({ argv: ['-'], stdinData: 'piped' });

		await runQuietly(() => app.run({ adapter: host.adapter }));

		expect(host.reads()).toBe(1);
	});

	it("does not read stdin for a 'missing' binding given an explicit dash", async () => {
		const app = cli('mycli').default(
			command('run')
				.arg('input', arg.string().stdin({ when: 'missing' }))
				.action(() => {}),
		);
		const host = countingAdapter({ argv: ['-'], stdinData: 'piped' });

		await runQuietly(() => app.run({ adapter: host.adapter }));

		expect(host.reads()).toBe(0);
	});
});

// --- flag surface

describe('flag stdin eligibility', () => {
	it('reads stdin once when the flag is absent from argv', async () => {
		const seen: unknown[] = [];
		const app = cli('mycli').default(
			command('run')
				.flag('body', flag.string().stdin())
				.action(({ flags }) => {
					seen.push(flags.body);
				}),
		);
		const host = countingAdapter({ argv: [], stdinData: 'piped\n' });

		await runQuietly(() => app.run({ adapter: host.adapter }));

		expect(host.reads()).toBe(1);
		expect(seen).toEqual(['piped\n']);
	});

	it('does not read stdin when the flag was supplied on argv', async () => {
		const app = cli('mycli').default(
			command('run')
				.flag('body', flag.string().stdin())
				.action(() => {}),
		);
		const host = countingAdapter({ argv: ['--body', 'given'], stdinData: 'piped' });

		await runQuietly(() => app.run({ adapter: host.adapter }));

		expect(host.reads()).toBe(0);
	});

	it('reads stdin even when the flag is set in the environment', async () => {
		const seen: unknown[] = [];
		const app = cli('mycli').default(
			command('run')
				.flag('body', flag.string().stdin().env('BODY'))
				.action(({ flags }) => {
					seen.push(flags.body);
				}),
		);
		const base = createTestAdapter({
			argv: ['node', 'cli'],
			stdinData: 'piped\n',
			env: { BODY: 'from-env' },
		});
		let reads = 0;
		const adapter = {
			...base,
			readStdin: () => {
				reads += 1;
				return base.readStdin();
			},
		};

		await runQuietly(() => app.run({ adapter }));

		expect(reads).toBe(1);
		expect(seen).toEqual(['piped\n']);
	});

	it('does not read stdin for a command with no stdin input at all', async () => {
		const app = cli('mycli').default(
			command('run')
				.flag('body', flag.string())
				.arg('input', arg.string().optional())
				.action(() => {}),
		);
		const host = countingAdapter({ argv: [], stdinData: 'piped' });

		await runQuietly(() => app.run({ adapter: host.adapter }));

		expect(host.reads()).toBe(0);
	});

	it('does not read stdin when help was requested', async () => {
		const app = cli('mycli').default(
			command('run')
				.flag('body', flag.string().stdin())
				.action(() => {}),
		);
		const host = countingAdapter({ argv: ['--help'], stdinData: 'piped' });

		await runQuietly(() => app.run({ adapter: host.adapter }));

		expect(host.reads()).toBe(0);
	});
});

// === L16: a collection's `-` occurrence is the same selector as a scalar's

describe('collection stdin eligibility', () => {
	it('reads stdin for a `-` occurrence among the occurrences of an array flag', async () => {
		const seen: unknown[] = [];
		const app = cli('mycli').default(
			command('run')
				.flag('tag', flag.array(flag.string()).stdin())
				.action(({ flags }) => {
					seen.push(flags.tag);
				}),
		);
		const host = countingAdapter({
			argv: ['--tag', 'before', '--tag', '-', '--tag', 'after'],
			stdinData: 'a\nb\n',
		});

		await runQuietly(() => app.run({ adapter: host.adapter }));

		expect(host.reads()).toBe(1);
		expect(seen).toEqual([['before', 'a', 'b', 'after']]);
	});

	it('reads stdin for a `-` occurrence of a keyValue flag', async () => {
		const seen: unknown[] = [];
		const app = cli('mycli').default(
			command('run')
				.flag('env', flag.keyValue().stdin())
				.action(({ flags }) => {
					seen.push(flags.env);
				}),
		);
		const host = countingAdapter({ argv: ['--env', 'A=1', '--env', '-'], stdinData: 'B=2\n' });

		await runQuietly(() => app.run({ adapter: host.adapter }));

		expect(host.reads()).toBe(1);
		expect(seen).toEqual([{ A: '1', B: '2' }]);
	});

	it('reads stdin for a `-` token of a keyValue positional', async () => {
		const seen: unknown[] = [];
		const app = cli('mycli').default(
			command('run')
				.arg('vars', arg.keyValue().stdin())
				.action(({ args }) => {
					seen.push(args.vars);
				}),
		);
		const host = countingAdapter({ argv: ['-'], stdinData: 'A=1\nB=2\n' });

		await runQuietly(() => app.run({ adapter: host.adapter }));

		expect(host.reads()).toBe(1);
		expect(seen).toEqual([{ A: '1', B: '2' }]);
	});

	it('does not read stdin for a literal `-` element on an array flag without a stdin binding', async () => {
		const seen: unknown[] = [];
		const app = cli('mycli').default(
			command('run')
				.flag('tag', flag.array(flag.string()))
				.action(({ flags }) => {
					seen.push(flags.tag);
				}),
		);
		const host = countingAdapter({ argv: ['--tag', '-', '--tag', 'x'], stdinData: 'piped' });

		await runQuietly(() => app.run({ adapter: host.adapter }));

		expect(host.reads()).toBe(0);
		expect(seen).toEqual([['-', 'x']]);
	});
});
