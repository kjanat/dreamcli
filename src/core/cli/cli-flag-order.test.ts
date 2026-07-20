/**
 * End-to-end tests for `.help({ flagOrder })` / `sortFlags`, verifying the
 * builder-level and runtime help config reaches the flags table renderer.
 */
import { describe, expect, it } from 'vitest';
import { command } from '#internals/core/schema/command.ts';
import { flag } from '#internals/core/schema/flag.ts';
import { cli } from './index.ts';

// === Helpers

function orderedCommand() {
	return command('run')
		.flag('zebra', flag.boolean())
		.flag('apple', flag.boolean().alias('a'))
		.flag('mango', flag.boolean())
		.flag('banana', flag.boolean().alias('b'))
		.action(() => {});
}

function flagOrderIn(help: string): string[] {
	return ['zebra', 'apple', 'mango', 'banana']
		.map((name) => ({ name, at: help.indexOf(`--${name}`) }))
		.sort((x, y) => x.at - y.at)
		.map((entry) => entry.name);
}

// === Flag ordering — end to end

describe('flag ordering — end to end', () => {
	it('defaults to short-first alphabetical', async () => {
		const result = await cli('mycli').command(orderedCommand()).execute(['run', '--help']);
		expect(flagOrderIn(result.stdout.join(''))).toEqual(['apple', 'banana', 'mango', 'zebra']);
	});

	it("honors builder .help({ flagOrder: 'declaration' })", async () => {
		const app = cli('mycli').help({ flagOrder: 'declaration' }).command(orderedCommand());
		const result = await app.execute(['run', '--help']);
		expect(flagOrderIn(result.stdout.join(''))).toEqual(['zebra', 'apple', 'mango', 'banana']);
	});

	it('honors a runtime sortFlags comparator', async () => {
		const app = cli('mycli').command(orderedCommand());
		const result = await app.execute(['run', '--help'], {
			help: { sortFlags: (a, b) => b.localeCompare(a) },
		});
		expect(flagOrderIn(result.stdout.join(''))).toEqual(['zebra', 'mango', 'banana', 'apple']);
	});
});
