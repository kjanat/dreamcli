/**
 * Generate DreamCLI starter files using the templates shipped with the package.
 *
 * @module @kjanat/dreamcli/create
 */

import {
	linkSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	renameSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { CLIError } from './core/errors/index.ts';
import { entryTemplates, testTemplates } from './create/templates.ts';
import { detectTestRunner } from './create/test-runner.ts';

export interface ScaffoldOptions {
	/** CLI name. Converted to a lowercase, hyphen-separated filename. */
	readonly name: string;
	/** Starter layout. Defaults to a single root command. */
	readonly mode?: 'single' | 'multi';
	/** Output directory. Defaults to the current working directory. */
	readonly out?: string;
	/** Generate a test file. Defaults to true. */
	readonly test?: boolean;
	/** Replace existing starter files. Defaults to false. */
	readonly force?: boolean;
}

export interface ScaffoldResult {
	/** Normalized CLI name. */
	readonly name: string;
	/** Absolute path to the generated entrypoint. */
	readonly entry: string;
	/** Absolute path to the generated test, when enabled. */
	readonly test?: string;
	/** Import specifier for the generated test runner, when tests are enabled. */
	readonly testRunner?: 'bun:test' | 'vitest';
}

function renderTemplate(template: string, name: string): string {
	return template.replaceAll('__CLI_NAME__', name).replaceAll('__ENTRY_FILE__', `./${name}.ts`);
}

function existingFile(path: string): CLIError {
	return new CLIError(`Refusing to overwrite existing file: ${path}`, {
		code: 'SCAFFOLD_FILE_EXISTS',
		suggest: 'Use --force to replace the existing starter file.',
	});
}

/** Generate starter files in an existing project or a new directory. */
export function scaffold(options: ScaffoldOptions): ScaffoldResult {
	const name = options.name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
	if (name === '' || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(name)) {
		throw new CLIError('Choose a CLI name that can be used as a filename.', {
			code: 'SCAFFOLD_INVALID_NAME',
			suggest: 'Use a name with at least one letter or digit, such as my-cli.',
		});
	}

	const directory = resolve(options.out ?? '.');
	const mode = options.mode ?? 'single';
	const entry = join(directory, `${name}.ts`);
	const test = options.test === false ? undefined : join(directory, `${name}.test.ts`);
	const testRunner = test === undefined ? undefined : detectTestRunner(directory);
	const files: { path: string; content: string; mode?: number }[] = [
		{ path: entry, content: renderTemplate(entryTemplates[mode], name) },
	];
	if (test !== undefined && testRunner !== undefined) {
		files.push({
			path: test,
			content: renderTemplate(testTemplates[mode], name).replace('__TEST_RUNNER__', testRunner),
		});
	}

	for (const file of files) {
		const { path } = file;
		const existing = lstatSync(path, { throwIfNoEntry: false });
		if (!existing) continue;
		if (!existing.isFile()) {
			throw new CLIError(`Cannot replace a path that is not a regular file: ${path}`, {
				code: 'SCAFFOLD_NOT_A_FILE',
			});
		}
		if (!options.force) throw existingFile(path);
		file.mode = existing.mode & 0o777;
	}

	mkdirSync(directory, { recursive: true });
	// Stage every file before publishing any output.
	const staging = mkdtempSync(join(directory, '.dreamcli-'));
	const created: string[] = [];
	try {
		const staged = files.map(({ path, content, mode }, index) => {
			const source = join(staging, String(index));
			writeFileSync(source, content, mode === undefined ? undefined : { mode });
			return { path, source };
		});

		for (const { path, source } of staged) {
			if (options.force) {
				renameSync(source, path);
				continue;
			}
			// A hard link publishes the complete file and fails if another writer won the race.
			try {
				linkSync(source, path);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw existingFile(path);
				throw error;
			}
			created.push(path);
		}
	} catch (error) {
		for (const path of created) rmSync(path, { force: true });
		throw error;
	} finally {
		rmSync(staging, { recursive: true, force: true });
	}

	return {
		name,
		entry,
		...(test !== undefined && { test }),
		...(testRunner !== undefined && { testRunner }),
	};
}
