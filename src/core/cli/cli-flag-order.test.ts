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

	it('keeps numeric flags in declaration order in the flat flags table', async () => {
		const app = cli('mycli')
			.help({ flagOrder: 'declaration' })
			.command(
				command('run')
					.flag('20', flag.boolean())
					.flag('10', flag.boolean())
					.action(() => {}),
			);
		const help = await app.execute(['run', '--help']);
		expect(help.stdout.join('').match(/--\d+/gu)).toEqual(['--20', '--10']);
	});

	it('keeps numeric default-command flags ordered after the synthetic completions flag', async () => {
		const app = cli('mycli')
			.help({ flagOrder: 'declaration' })
			.completions({ as: 'flag' })
			.default(command('run').flag('20', flag.boolean()).flag('10', flag.boolean()));
		const result = await app.execute(['--help']);
		expect(result.exitCode).toBe(0);
		expect(result.stdout.join('').match(/--(?:completions|\d+)/gu)).toEqual([
			'--completions',
			'--20',
			'--10',
		]);
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
	it('keeps declaration order through multiple levels of propagation and shadowing', async () => {
		const leaf = command('leaf').flag('bravo', flag.boolean().group('Leaf'));
		const middle = command('middle')
			.flag('omega', flag.boolean().group('Middle').propagate())
			.flag('shared', flag.boolean().group('Middle').propagate())
			.command(leaf);
		const root = command('root')
			.flag('zebra', flag.boolean().group('Root').propagate())
			.flag('shared', flag.boolean().group('Shadowed').propagate())
			.flag('alpha', flag.boolean().group('Root').propagate())
			.command(middle);
		const app = cli('mycli').help({ flagOrder: 'declaration' }).command(root);
		const result = await app.execute(['root', 'middle', 'leaf', '--help']);
		const help = result.stdout.join('');
		expect(result.exitCode).toBe(0);
		expect(help.match(/^\w+ options:$|--(?:zebra|alpha|omega|shared|bravo)/gmu)).toEqual([
			'Root options:',
			'--zebra',
			'--alpha',
			'Middle options:',
			'--omega',
			'--shared',
			'Leaf options:',
			'--bravo',
		]);
	});

	it('keeps declaration order for numeric flag names, including inherited flags', async () => {
		const parent = command('parent')
			.flag('20', flag.boolean().group('First').propagate())
			.flag('10', flag.boolean().group('Second').propagate())
			.command(
				command('child')
					.flag('1', flag.boolean().group('Third'))
					.action(() => {}),
			);
		const app = cli('mycli').command(parent);
		const text = await app.execute(['parent', 'child', '--help']);
		expect(text.stdout.join('').match(/^.* options:$/gm)).toEqual([
			'First options:',
			'Second options:',
			'Third options:',
		]);
		const json = await app.execute(['parent', 'child', '--help', '--json']);
		expect(JSON.parse(json.stdout.join(''))).toHaveProperty('flagDeclarationOrder', [
			'20',
			'10',
			'1',
		]);
	});

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
