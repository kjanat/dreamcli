import { describe, expect, it } from 'vitest';
import { flag } from '#internals/core/schema/flag.ts';
import { createTestAdapter } from '#internals/runtime/adapter.ts';
import { readFlags } from './index.ts';

// === L15 — readFlags() carries the same source semantics

// --- helpers

/** An adapter whose `readStdin()` counts its own calls. */
function countingAdapter(options?: { stdinData?: string; env?: Record<string, string> }) {
	const base = createTestAdapter({
		argv: ['node', 'script'],
		...(options?.stdinData !== undefined ? { stdinData: options.stdinData } : {}),
		...(options?.env !== undefined ? { env: options.env } : {}),
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

// --- tests

describe('readFlags() stdin contract', () => {
	it('reads stdin through the adapter when the flag is absent', async () => {
		const host = countingAdapter({ stdinData: 'piped\n' });

		const values = await readFlags(
			{ body: flag.string().stdin() },
			{ argv: [], adapter: host.adapter },
		);

		expect(values.body).toBe('piped\n');
		expect(host.reads()).toBe(1);
	});

	it('never reads stdin when no flag declares one', async () => {
		const host = countingAdapter({ stdinData: 'piped' });

		const values = await readFlags(
			{ body: flag.string().default('none') },
			{ argv: [], adapter: host.adapter },
		);

		expect(values.body).toBe('none');
		expect(host.reads()).toBe(0);
	});

	it('never reads stdin when argv already supplied the flag', async () => {
		const host = countingAdapter({ stdinData: 'piped' });

		const values = await readFlags(
			{ body: flag.string().stdin() },
			{ argv: ['--body', 'given'], adapter: host.adapter },
		);

		expect(values.body).toBe('given');
		expect(host.reads()).toBe(0);
	});

	it('prefers injected stdinData over the adapter', async () => {
		const host = countingAdapter({ stdinData: 'from-adapter' });

		const values = await readFlags(
			{ body: flag.string().stdin() },
			{ argv: [], adapter: host.adapter, stdinData: 'injected' },
		);

		expect(values.body).toBe('injected');
		expect(host.reads()).toBe(0);
	});

	it('puts the stdin fallback ahead of env, matching a command', async () => {
		const host = countingAdapter({ stdinData: 'piped\n', env: { BODY: 'from-env' } });

		const values = await readFlags(
			{ body: flag.string().stdin().env('BODY') },
			{ argv: [], adapter: host.adapter },
		);

		expect(values.body).toBe('piped\n');
	});

	it('keeps an explicit dash at CLI precedence', async () => {
		const host = countingAdapter({ stdinData: 'piped\n', env: { BODY: 'from-env' } });

		const values = await readFlags(
			{ body: flag.string().stdin().env('BODY') },
			{ argv: ['--body', '-'], adapter: host.adapter },
		);

		expect(values.body).toBe('piped\n');
		expect(host.reads()).toBe(1);
	});

	it("leaves a dash literal for a 'missing' binding", async () => {
		const host = countingAdapter({ stdinData: 'piped' });

		const values = await readFlags(
			{ body: flag.string().stdin({ when: 'missing' }) },
			{ argv: ['--body', '-'], adapter: host.adapter },
		);

		expect(values.body).toBe('-');
		expect(host.reads()).toBe(0);
	});

	it('decodes a piped boolean the way a command does', async () => {
		const host = countingAdapter({ stdinData: 'true\n' });

		const values = await readFlags(
			{ enabled: flag.boolean().stdin() },
			{ argv: [], adapter: host.adapter },
		);

		expect(values.enabled).toBe(true);
	});

	it('trims a piped value when the binding asks for it', async () => {
		const host = countingAdapter({ stdinData: 'piped\n' });

		const values = await readFlags(
			{ body: flag.string().stdin({ trim: true }) },
			{ argv: [], adapter: host.adapter },
		);

		expect(values.body).toBe('piped');
	});

	it('splices a dash occurrence into a collection the way a command does', async () => {
		const host = countingAdapter({ stdinData: 'a\nb\n' });

		const values = await readFlags(
			{ tag: flag.array(flag.string()).stdin() },
			{ argv: ['--tag', 'before', '--tag', '-'], adapter: host.adapter },
		);

		expect(values.tag).toEqual(['before', 'a', 'b']);
		expect(host.reads()).toBe(1);
	});

	it('fails on a dash occurrence with nothing piped', async () => {
		const host = countingAdapter();

		await expect(
			readFlags(
				{ tag: flag.array(flag.string()).stdin() },
				{ argv: ['--tag', 'a', '--tag', '-'], adapter: host.adapter },
			),
		).rejects.toThrow("No piped stdin for the '-' occurrence of flag --tag");
	});
});
