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
	readdirSync,
	renameSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { CLIError } from './core/errors/index.ts';
import {
	cliTemplate,
	commandTemplate,
	standaloneTemplate,
	testTemplate,
} from './create/templates.ts';
import { detectTestRunner } from './create/test-runner.ts';
import { DREAMCLI_VERSION } from './version.ts';

export interface ScaffoldOptions {
	/** CLI name. Converted to a lowercase, hyphen-separated filename. */
	readonly name: string;
	/** Exact project directory. Defaults to a directory named after the CLI. */
	readonly directory?: string;
	/** Write starter files into this directory instead of creating a named project. */
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
	/** Absolute paths to all generated files. */
	readonly files: readonly string[];
	/** Absolute path to the generated test, when enabled. */
	readonly test?: string;
	/** Import specifier for the generated test runner, when tests are enabled. */
	readonly testRunner?: 'bun:test' | 'vitest';
}

function existingFile(path: string): CLIError {
	return new CLIError(`Refusing to overwrite existing file: ${path}`, {
		code: 'SCAFFOLD_FILE_EXISTS',
		suggest: 'Use --force to replace the existing starter file.',
	});
}

/** Normalize a project name for use as a package name and filename. */
function normalizeProjectName(input: string): string | undefined {
	const name = input
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
	if (name === '' || name.length > 214 || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(name)) {
		return undefined;
	}

	return name;
}

/** Create a named npm project or add starter files to an explicit output directory. */
export function scaffold(options: ScaffoldOptions): ScaffoldResult {
	const name = normalizeProjectName(options.name);
	if (name === undefined) {
		throw new CLIError('Choose a CLI name that can be used as a filename.', {
			code: 'SCAFFOLD_INVALID_NAME',
			suggest: 'Use 1 to 214 letters, digits, or hyphens, such as my-cli.',
		});
	}

	const project = options.out === undefined;
	const directory = resolve(options.out ?? options.directory ?? name);
	const entry = join(directory, project ? 'src/cli.ts' : `${name}.ts`);
	const test =
		options.test === false
			? undefined
			: join(directory, project ? 'src/commands/hello.test.ts' : `${name}.test.ts`);
	const testRunner =
		test === undefined ? undefined : project ? 'vitest' : detectTestRunner(directory);
	const files: { path: string; content: string; mode?: number }[] = [
		{
			path: entry,
			content: (project ? cliTemplate : standaloneTemplate).replace('__CLI_NAME__', name),
		},
	];
	if (project)
		files.push({ path: join(directory, 'src/commands/hello.ts'), content: commandTemplate });
	if (test !== undefined && testRunner !== undefined) {
		files.push({
			path: test,
			content: testTemplate
				.replace('__COMMAND_FILE__', project ? './hello.ts' : `./${name}.ts`)
				.replace('__TEST_RUNNER__', testRunner),
		});
	}

	if (project) {
		const manifest = {
			name,
			version: '0.1.0',
			private: true,
			type: 'module',
			scripts: {
				start: 'node src/cli.ts',
				typecheck: 'tsc --noEmit',
				...(test !== undefined && { test: 'vitest run' }),
			},
			engines: { node: '>=22.22.2' },
			dependencies: {
				'@kjanat/dreamcli': DREAMCLI_VERSION === 'dev' ? 'latest' : DREAMCLI_VERSION,
			},
			devDependencies: {
				'@types/node': '^22.0.0',
				typescript: '^6.0.3',
				...(test !== undefined && { vitest: '^5.1.2' }),
			},
		};
		files.push({
			path: join(directory, 'package.json'),
			content: `${JSON.stringify(manifest, null, 2)}\n`,
		});
		const tsconfig = {
			compilerOptions: {
				target: 'ES2022',
				module: 'NodeNext',
				strict: true,
				noEmit: true,
				allowImportingTsExtensions: true,
				types: ['node'],
			},
			include: ['src'],
		};
		files.push(
			{ path: join(directory, 'tsconfig.json'), content: `${JSON.stringify(tsconfig, null, 2)}\n` },
			{ path: join(directory, '.gitignore'), content: 'node_modules/\ncoverage/\n' },
		);
		const existing = lstatSync(directory, { throwIfNoEntry: false });
		if (existing && (!existing.isDirectory() || readdirSync(directory).length > 0)) {
			throw new CLIError(`Project directory is not empty or not a directory: ${directory}`, {
				code: 'SCAFFOLD_PROJECT_EXISTS',
				suggest:
					'Choose an empty directory or use --out to add starter files to an existing project.',
			});
		}
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
			mkdirSync(dirname(path), { recursive: true });
			if (options.force && !project) {
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
		files: files.map(({ path }) => path),
		...(test !== undefined && { test }),
		...(testRunner !== undefined && { testRunner }),
	};
}
