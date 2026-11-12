/** Long command help text and definition output. */
import { createColors } from 'ansispeck';
import { describe, expect, it } from 'vitest';
import { cli } from '#internals/core/cli/index.ts';
import { generateCommandSchema, generateSchema } from '#internals/core/json-schema/index.ts';
import { command, createCommandSchema, group } from '#internals/core/schema/command.ts';
import { stripAnsi, visibleWidth } from './ansi.ts';
import { formatHelp } from './index.ts';

describe('command details', () => {
	it('wraps paragraphs below the short description', () => {
		const cmd = command('release')
			.description('Publish a release')
			.details(
				'Build binaries and publish packages.\n\nFollow each publication after confirmation.',
			);
		expect(formatHelp(cmd.schema, { width: 25 })).toBe(
			'Usage: release\n\nPublish a release\n\nBuild binaries and\npublish packages.\n\nFollow each publication\nafter confirmation.\n',
		);
	});

	it('keeps long text out of parent listings and renders it for nested help', async () => {
		const child = command('release')
			.description('Publish')
			.details('Wait for the upload to finish.');
		const parent = group('project').command(child);
		const app = cli('app').command(parent);
		const parentHelp = await app.execute(['project', '--help']);
		expect(parentHelp.stdout.join('')).toContain('Publish');
		expect(parentHelp.stdout.join('')).not.toContain('Wait for');
		const childHelp = await app.execute(['project', 'release', '--help']);
		expect(childHelp.stdout.join('')).toContain('Publish\n\nWait for the upload to finish.');
	});

	it('renders details for a default command and without a short description', async () => {
		const app = cli('app').default(command('release').details('Wait for the upload.'));
		const result = await app.execute(['--help']);
		expect(result.stdout.join('')).toContain('Wait for the upload.');
	});

	it('uses the description theme and ignores color escapes when wrapping', () => {
		const cmd = command('release').details(
			(theme) => `Use ${theme.flag('--dry-run')} to preview the release.`,
		);
		const plain = formatHelp(cmd.schema, { width: 24 });
		const colored = formatHelp(cmd.schema, { width: 24, colors: createColors(true) });
		expect(stripAnsi(colored)).toBe(plain);
		expect(colored).toContain('\u001b[');
		for (const line of colored.trimEnd().split('\n'))
			expect(visibleWidth(line)).toBeLessThanOrEqual(24);
	});

	it('preserves the original builder and the action on the new builder', async () => {
		const initial = command('release').action(({ out }) => out.log('released'));
		const detailed = initial.details('Wait for the upload.');
		expect(initial.schema.details).toBeUndefined();
		expect(detailed.handler).toBe(initial.handler);
		expect(createCommandSchema(detailed.schema).details).toBe('Wait for the upload.');
		expect((await cli('app').default(detailed).execute([])).stdout).toEqual(['released\n']);
	});

	it('serializes themed details as plain text in standalone and nested definitions', async () => {
		const cmd = command('release').details((theme) => `Use ${theme.flag('--dry-run')}.`);
		const document = generateCommandSchema(cmd.schema);
		expect(document.details).toBe('Use --dry-run.');
		expect(createCommandSchema({ name: document.name, details: document.details }).details).toBe(
			document.details,
		);
		const app = cli('app').command(cmd);
		expect(generateSchema(app.schema).commands[0]?.details).toBe('Use --dry-run.');
		const result = await app.execute(['release', '--help', '--json']);
		expect(JSON.parse(result.stdout.join('')).details).toBe('Use --dry-run.');
	});
});
