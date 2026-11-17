/**
 * End-to-end tests for `.help({ flagOrder })` / `sortFlags`, verifying the
 * builder-level and runtime help config reaches the flags table renderer.
 */
import { describe, expect, it } from 'vitest';
import { arg } from '#internals/core/schema/arg.ts';
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

describe('input groups in help', () => {
	function groupedCommand() {
		return command('render')
			.arg('source', arg.string().group('Input'))
			.arg('target', arg.string().group('Output'))
			.arg('profile', arg.string())
			.flag('file', flag.string().group('Output'))
			.flag('size', flag.number().group('Rasterizing'))
			.flag('directory', flag.string().group('Output'))
			.flag('verbose', flag.boolean())
			.action(() => {});
	}

	it('uses declaration order for sections and sorts flags only within each section', async () => {
		const result = await cli('mycli')
			.command(groupedCommand())
			.execute(['render', '--help'], {
				help: {
					sortFlags: (a, b) => {
						expect([a, b].sort()).toEqual(['directory', 'file']);
						return b.localeCompare(a);
					},
				},
			});
		const help = result.stdout.join('');
		expect(help).toContain('<source> <target> <profile>');
		const blocks = help.trimEnd().split('\n\n').slice(1);
		expect(blocks.map((block) => block.split('\n')[0])).toEqual([
			'Input arguments:',
			'Output arguments:',
			'Arguments:',
			'Output options:',
			'Rasterizing options:',
			'Flags:',
		]);
		expect(blocks[3]?.match(/--[\w-]+/gu)).toEqual(['--file', '--directory']);
		expect(blocks[4]).toContain('--size');
		expect(blocks[5]).toContain('--verbose');
	});

	it('applies the configured section order to inlined root help', async () => {
		const app = cli('mycli')
			.default(groupedCommand())
			.help({ groupOrder: ['Rasterizing', 'Output', 'Unknown', 'Output'] });
		const result = await app.execute(['--help']);
		const help = result.stdout.join('');
		expect(help).toMatch(/Output arguments:[\s\S]*Input arguments:/u);
		expect(help).toMatch(/Rasterizing options:[\s\S]*Output options:/u);
		expect(help.match(/Output options:/gu)).toHaveLength(1);
		expect(help).not.toContain('Unknown options:');
	});

	it('serializes membership and the effective override in root and command JSON help', async () => {
		const app = cli('mycli')
			.command(groupedCommand())
			.help({ groupOrder: ['Output'] });
		const root = await app.execute(['--help', '--json']);
		const command = await app.execute(['render', '--help', '--json'], {
			help: { groupOrder: ['Rasterizing'] },
		});
		const membership = {
			flags: {
				file: { group: 'Output' },
				size: { group: 'Rasterizing' },
				directory: { group: 'Output' },
				verbose: { kind: 'boolean' },
			},
			args: [
				{ name: 'source', group: 'Input' },
				{ name: 'target', group: 'Output' },
				{ name: 'profile' },
			],
		};
		expect(JSON.parse(root.stdout.join(''))).toMatchObject({
			groupOrder: ['Output'],
			commands: [membership],
		});
		const document: unknown = JSON.parse(command.stdout.join(''));
		expect(document).toMatchObject({ ...membership, groupOrder: ['Rasterizing'] });
		expect(document).not.toHaveProperty(['flags', 'verbose', 'group']);
		expect(document).not.toHaveProperty(['args', 2, 'group']);
	});
});
