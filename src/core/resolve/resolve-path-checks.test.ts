/**
 * Path check tests — `flag.path()` filesystem expectations.
 *
 * Covers the builder schema (`pathChecks`, `valueHint`), the post-resolution
 * validation pass in `resolve()`, and the end-to-end `runCommand()` surface
 * with an injected `stat` probe.
 */

import { describe, expect, expectTypeOf, it } from 'vitest';
import { isValidationError } from '#internals/core/errors/index.ts';
import type { ParseResult } from '#internals/core/parse/index.ts';
import type { CommandSchema } from '#internals/core/schema/command.ts';
import { command, createCommandSchema } from '#internals/core/schema/command.ts';
import type { InferFlag } from '#internals/core/schema/flag.ts';
import { createFlagSchema, flag } from '#internals/core/schema/flag.ts';
import { runCommand } from '#internals/core/testkit/index.ts';
import { resolve } from './index.ts';

// --- Helpers — schemas, parse results, and a recording stat probe

function makeSchema(overrides: Partial<CommandSchema> = {}): CommandSchema {
	return createCommandSchema({ name: 'test', ...overrides });
}

function makeParsed(overrides: Partial<ParseResult> = {}): ParseResult {
	return {
		flags: {},
		args: {},
		...overrides,
	};
}

interface StatProbe {
	readonly stat: (path: string) => Promise<'file' | 'directory' | null>;
	readonly calls: string[];
}

/** Plain wrapper-fn spy — records every probed path, no module mocks. */
function statProbe(lookup: Readonly<Record<string, 'file' | 'directory'>> = {}): StatProbe {
	const calls: string[] = [];
	return {
		calls,
		stat: (path: string): Promise<'file' | 'directory' | null> => {
			calls.push(path);
			return Promise.resolve(lookup[path] ?? null);
		},
	};
}

// === flag.path() — builder schema

describe('flag.path() — builder schema', () => {
	it('creates a string-kind flag with optional presence', () => {
		const f = flag.path();
		expect(f.schema.kind).toBe('string');
		expect(f.schema.presence).toBe('optional');
		expect(f.schema.defaultValue).toBeUndefined();
	});

	it('sets the path value hint', () => {
		expect(flag.path().schema.valueHint).toBe('path');
		expect(flag.path({ mustExist: true }).schema.valueHint).toBe('path');
	});

	it('leaves pathChecks undefined without options', () => {
		expect(flag.path().schema.pathChecks).toBeUndefined();
	});

	it('leaves pathChecks undefined for an empty options object', () => {
		expect(flag.path({}).schema.pathChecks).toBeUndefined();
	});

	it('leaves pathChecks undefined for mustExist: false alone', () => {
		expect(flag.path({ mustExist: false }).schema.pathChecks).toBeUndefined();
	});

	it('stores mustExist when requested', () => {
		expect(flag.path({ mustExist: true }).schema.pathChecks).toEqual({
			mustExist: true,
			type: undefined,
			create: false,
		});
	});

	it('defaults mustExist to true when type is set', () => {
		expect(flag.path({ type: 'directory' }).schema.pathChecks).toEqual({
			mustExist: true,
			type: 'directory',
			create: false,
		});
		expect(flag.path({ type: 'file' }).schema.pathChecks).toEqual({
			mustExist: true,
			type: 'file',
			create: false,
		});
	});

	it('keeps an explicit mustExist: false alongside type', () => {
		expect(flag.path({ mustExist: false, type: 'file' }).schema.pathChecks).toEqual({
			mustExist: false,
			type: 'file',
			create: false,
		});
	});

	it('stores create for directory paths', () => {
		expect(flag.path({ type: 'directory', create: true }).schema.pathChecks).toEqual({
			mustExist: true,
			type: 'directory',
			create: true,
		});
	});

	it('rejects create without type: directory at the type level', () => {
		// @ts-expect-error — create is only available with type: 'directory'
		flag.path({ create: true });
		// @ts-expect-error — create is only available with type: 'directory'
		flag.path({ type: 'file', create: true });
	});

	// --- type inference

	it('infers string | undefined for an optional path flag', () => {
		const f = flag.path({ mustExist: true });
		expectTypeOf<InferFlag<typeof f>>().toEqualTypeOf<string | undefined>();
	});

	it('infers string for a required path flag', () => {
		const f = flag.path({ type: 'file' }).required();
		expectTypeOf<InferFlag<typeof f>>().toEqualTypeOf<string>();
	});

	// --- string constraint chaining (path kind is string)

	it('.nonEmpty() chains onto a path flag', () => {
		const f = flag.path().nonEmpty();
		expect(f.schema.kind).toBe('string');
		expect(f.schema.stringConstraints).toEqual({ nonEmpty: true });
	});

	it('.nonEmpty() preserves pathChecks through the chain', () => {
		const f = flag.path({ type: 'file' }).nonEmpty();
		expect(f.schema.pathChecks).toEqual({ mustExist: true, type: 'file', create: false });
		expect(f.schema.stringConstraints).toEqual({ nonEmpty: true });
	});
});

// === resolve() — path checks

describe('resolve() — path checks', () => {
	it('passes when stat reports a file for mustExist', async () => {
		const schema = makeSchema({
			flags: {
				input: createFlagSchema('string', {
					pathChecks: { mustExist: true, type: undefined, create: false },
				}),
			},
		});
		const parsed = makeParsed({ flags: { input: '/data/report.csv' } });
		const probe = statProbe({ '/data/report.csv': 'file' });

		const result = await resolve(schema, parsed, { stat: probe.stat });
		expect(result.flags).toEqual({ input: '/data/report.csv' });
		expect(probe.calls).toEqual(['/data/report.csv']);
	});

	it('rejects a missing path with CONSTRAINT_VIOLATED', async () => {
		const schema = makeSchema({
			flags: {
				input: createFlagSchema('string', {
					pathChecks: { mustExist: true, type: undefined, create: false },
				}),
			},
		});
		const parsed = makeParsed({ flags: { input: '/nope' } });
		const probe = statProbe();

		try {
			await resolve(schema, parsed, { stat: probe.stat });
			expect.unreachable('should have thrown');
		} catch (err) {
			expect(isValidationError(err)).toBe(true);
			if (isValidationError(err)) {
				expect(err.code).toBe('CONSTRAINT_VIOLATED');
				expect(err.message).toBe("Path '/nope' for flag --input does not exist");
				expect(err.details).toEqual({ flag: 'input', value: '/nope', constraint: 'mustExist' });
				expect(err.suggest).toBe('Provide an existing path for --input');
				expect(err.exitCode).toBe(2);
			}
		}
	});

	it('passes a missing path when mustExist is false', async () => {
		const schema = makeSchema({
			flags: {
				outDir: createFlagSchema('string', {
					pathChecks: { mustExist: false, type: 'directory', create: false },
				}),
			},
		});
		const parsed = makeParsed({ flags: { outDir: '/not/yet/created' } });
		const probe = statProbe();

		const result = await resolve(schema, parsed, { stat: probe.stat });
		expect(result.flags).toEqual({ outDir: '/not/yet/created' });
		expect(probe.calls).toEqual(['/not/yet/created']);
	});

	it('rejects an existing wrong-type path even when mustExist is false', async () => {
		const schema = makeSchema({
			flags: {
				outDir: createFlagSchema('string', {
					pathChecks: { mustExist: false, type: 'directory', create: false },
				}),
			},
		});
		const parsed = makeParsed({ flags: { outDir: '/data/report.csv' } });
		const probe = statProbe({ '/data/report.csv': 'file' });

		try {
			await resolve(schema, parsed, { stat: probe.stat });
			expect.unreachable('should have thrown');
		} catch (err) {
			expect(isValidationError(err)).toBe(true);
			if (isValidationError(err)) {
				expect(err.code).toBe('CONSTRAINT_VIOLATED');
				expect(err.details).toEqual({
					flag: 'outDir',
					value: '/data/report.csv',
					constraint: 'pathType',
					expected: 'directory',
				});
			}
		}
	});

	it('creates a missing directory when create is set', async () => {
		const schema = makeSchema({
			flags: {
				outDir: createFlagSchema('string', {
					pathChecks: { mustExist: true, type: 'directory', create: true },
				}),
			},
		});
		const parsed = makeParsed({ flags: { outDir: '/build/out' } });
		const probe = statProbe();
		const created: string[] = [];
		const mkdir = (path: string): Promise<void> => {
			created.push(path);
			return Promise.resolve();
		};

		const result = await resolve(schema, parsed, { stat: probe.stat, mkdir });
		expect(result.flags).toEqual({ outDir: '/build/out' });
		expect(created).toEqual(['/build/out']);
	});

	it('creates a missing directory when create is set and mustExist is false', async () => {
		const schema = makeSchema({
			flags: {
				outDir: createFlagSchema('string', {
					pathChecks: { mustExist: false, type: 'directory', create: true },
				}),
			},
		});
		const parsed = makeParsed({ flags: { outDir: '/build/out' } });
		const probe = statProbe();
		const created: string[] = [];
		const mkdir = (path: string): Promise<void> => {
			created.push(path);
			return Promise.resolve();
		};

		const result = await resolve(schema, parsed, { stat: probe.stat, mkdir });
		expect(result.flags).toEqual({ outDir: '/build/out' });
		expect(created).toEqual(['/build/out']);
	});

	it('passes a missing path when create is set with mustExist false and no mkdir is available', async () => {
		const schema = makeSchema({
			flags: {
				outDir: createFlagSchema('string', {
					pathChecks: { mustExist: false, type: 'directory', create: true },
				}),
			},
		});
		const parsed = makeParsed({ flags: { outDir: '/build/out' } });
		const probe = statProbe();

		const result = await resolve(schema, parsed, { stat: probe.stat });
		expect(result.flags).toEqual({ outDir: '/build/out' });
	});

	it('does not call mkdir when the directory already exists', async () => {
		const schema = makeSchema({
			flags: {
				outDir: createFlagSchema('string', {
					pathChecks: { mustExist: true, type: 'directory', create: true },
				}),
			},
		});
		const parsed = makeParsed({ flags: { outDir: '/build/out' } });
		const probe = statProbe({ '/build/out': 'directory' });
		const created: string[] = [];
		const mkdir = (path: string): Promise<void> => {
			created.push(path);
			return Promise.resolve();
		};

		const result = await resolve(schema, parsed, { stat: probe.stat, mkdir });
		expect(result.flags).toEqual({ outDir: '/build/out' });
		expect(created).toEqual([]);
	});

	it('reports a failing mkdir as CONSTRAINT_VIOLATED', async () => {
		const schema = makeSchema({
			flags: {
				outDir: createFlagSchema('string', {
					pathChecks: { mustExist: true, type: 'directory', create: true },
				}),
			},
		});
		const parsed = makeParsed({ flags: { outDir: '/readonly/out' } });
		const probe = statProbe();
		const mkdir = (): Promise<void> => Promise.reject(new Error('EACCES: permission denied'));

		try {
			await resolve(schema, parsed, { stat: probe.stat, mkdir });
			expect.unreachable('should have thrown');
		} catch (err) {
			expect(isValidationError(err)).toBe(true);
			if (isValidationError(err)) {
				expect(err.code).toBe('CONSTRAINT_VIOLATED');
				expect(err.message).toBe(
					"Failed to create directory '/readonly/out' for flag --outDir: EACCES: permission denied",
				);
				expect(err.details).toEqual({
					flag: 'outDir',
					value: '/readonly/out',
					constraint: 'create',
				});
			}
		}
	});

	it('falls back to existence rules when create is set but no mkdir is available', async () => {
		const schema = makeSchema({
			flags: {
				outDir: createFlagSchema('string', {
					pathChecks: { mustExist: true, type: 'directory', create: true },
				}),
			},
		});
		const parsed = makeParsed({ flags: { outDir: '/build/out' } });
		const probe = statProbe();

		try {
			await resolve(schema, parsed, { stat: probe.stat });
			expect.unreachable('should have thrown');
		} catch (err) {
			expect(isValidationError(err)).toBe(true);
			if (isValidationError(err)) {
				expect(err.details).toEqual({
					flag: 'outDir',
					value: '/build/out',
					constraint: 'mustExist',
				});
			}
		}
	});

	it('still rejects an existing file when create is set', async () => {
		const schema = makeSchema({
			flags: {
				outDir: createFlagSchema('string', {
					pathChecks: { mustExist: true, type: 'directory', create: true },
				}),
			},
		});
		const parsed = makeParsed({ flags: { outDir: '/build/out' } });
		const probe = statProbe({ '/build/out': 'file' });
		const created: string[] = [];
		const mkdir = (path: string): Promise<void> => {
			created.push(path);
			return Promise.resolve();
		};

		try {
			await resolve(schema, parsed, { stat: probe.stat, mkdir });
			expect.unreachable('should have thrown');
		} catch (err) {
			expect(isValidationError(err)).toBe(true);
			if (isValidationError(err)) {
				expect(err.details).toEqual({
					flag: 'outDir',
					value: '/build/out',
					constraint: 'pathType',
					expected: 'directory',
				});
			}
		}
		expect(created).toEqual([]);
	});

	it('rejects a file where a directory is expected', async () => {
		const schema = makeSchema({
			flags: {
				outDir: createFlagSchema('string', {
					pathChecks: { mustExist: true, type: 'directory', create: false },
				}),
			},
		});
		const parsed = makeParsed({ flags: { outDir: '/data/report.csv' } });
		const probe = statProbe({ '/data/report.csv': 'file' });

		try {
			await resolve(schema, parsed, { stat: probe.stat });
			expect.unreachable('should have thrown');
		} catch (err) {
			expect(isValidationError(err)).toBe(true);
			if (isValidationError(err)) {
				expect(err.code).toBe('CONSTRAINT_VIOLATED');
				expect(err.message).toBe(
					"Path '/data/report.csv' for flag --outDir is a file, expected a directory",
				);
				expect(err.details).toEqual({
					flag: 'outDir',
					value: '/data/report.csv',
					constraint: 'pathType',
					expected: 'directory',
				});
				expect(err.suggest).toBe('Provide a directory path for --outDir');
			}
		}
	});

	it('rejects a directory where a file is expected', async () => {
		const schema = makeSchema({
			flags: {
				input: createFlagSchema('string', {
					pathChecks: { mustExist: true, type: 'file', create: false },
				}),
			},
		});
		const parsed = makeParsed({ flags: { input: '/data' } });
		const probe = statProbe({ '/data': 'directory' });

		try {
			await resolve(schema, parsed, { stat: probe.stat });
			expect.unreachable('should have thrown');
		} catch (err) {
			expect(isValidationError(err)).toBe(true);
			if (isValidationError(err)) {
				expect(err.message).toBe("Path '/data' for flag --input is a directory, expected a file");
				expect(err.details).toEqual({
					flag: 'input',
					value: '/data',
					constraint: 'pathType',
					expected: 'file',
				});
			}
		}
	});

	it('skips checks when no stat is provided', async () => {
		const schema = makeSchema({
			flags: {
				input: createFlagSchema('string', {
					pathChecks: { mustExist: true, type: 'file', create: false },
				}),
			},
		});
		const parsed = makeParsed({ flags: { input: '/nope' } });

		const result = await resolve(schema, parsed);
		expect(result.flags).toEqual({ input: '/nope' });
	});

	it('validates default values through path checks', async () => {
		const schema = makeSchema({
			flags: {
				input: createFlagSchema('string', {
					presence: 'defaulted',
					defaultValue: '/default/missing',
					pathChecks: { mustExist: true, type: undefined, create: false },
				}),
			},
		});
		const parsed = makeParsed({ flags: {} });
		const probe = statProbe();

		try {
			await resolve(schema, parsed, { stat: probe.stat });
			expect.unreachable('should have thrown');
		} catch (err) {
			expect(isValidationError(err)).toBe(true);
			if (isValidationError(err)) {
				expect(err.code).toBe('CONSTRAINT_VIOLATED');
				expect(err.message).toContain('does not exist');
			}
		}
		expect(probe.calls).toEqual(['/default/missing']);
	});

	it('does not call stat when the optional path flag is unresolved', async () => {
		const schema = makeSchema({
			flags: {
				input: createFlagSchema('string', {
					pathChecks: { mustExist: true, type: 'file', create: false },
				}),
			},
		});
		const parsed = makeParsed({ flags: {} });
		const probe = statProbe();

		const result = await resolve(schema, parsed, { stat: probe.stat });
		expect(result.flags).toEqual({ input: undefined });
		expect(probe.calls).toEqual([]);
	});

	it('does not call stat when pathChecks is undefined', async () => {
		const schema = makeSchema({
			flags: {
				input: createFlagSchema('string'),
			},
		});
		const parsed = makeParsed({ flags: { input: '/anywhere' } });
		const probe = statProbe();

		const result = await resolve(schema, parsed, { stat: probe.stat });
		expect(result.flags).toEqual({ input: '/anywhere' });
		expect(probe.calls).toEqual([]);
	});
});

// === runCommand — flag.path() end to end

describe('runCommand — flag.path() end to end', () => {
	function fileCommand(builder: ReturnType<typeof flag.path>) {
		return command('read')
			.flag('file', builder)
			.action(({ flags, out }) => {
				out.log(`file=${String(flags.file)}`);
			});
	}

	it('accepts an existing file', async () => {
		const cmd = fileCommand(flag.path({ mustExist: true }));
		const probe = statProbe({ '/data/in.txt': 'file' });

		const result = await runCommand(cmd, ['--file', '/data/in.txt'], { stat: probe.stat });
		expect(result.exitCode).toBe(0);
		expect(result.error).toBeUndefined();
		expect(result.stdout.join('\n')).toContain('file=/data/in.txt');
		expect(probe.calls).toEqual(['/data/in.txt']);
	});

	it('exits 2 with CONSTRAINT_VIOLATED for a missing path', async () => {
		const cmd = fileCommand(flag.path({ mustExist: true }));
		const probe = statProbe();

		const result = await runCommand(cmd, ['--file', '/missing.txt'], { stat: probe.stat });
		expect(result.exitCode).toBe(2);
		expect(result.error?.code).toBe('CONSTRAINT_VIOLATED');
		expect(result.error?.message).toBe("Path '/missing.txt' for flag --file does not exist");
	});

	it('reports a file where a directory was expected', async () => {
		const cmd = command('build')
			.flag('outDir', flag.path({ type: 'directory' }))
			.action(({ flags, out }) => {
				out.log(`outDir=${String(flags.outDir)}`);
			});
		const probe = statProbe({ '/data/report.csv': 'file' });

		const result = await runCommand(cmd, ['--outDir', '/data/report.csv'], { stat: probe.stat });
		expect(result.exitCode).toBe(2);
		expect(result.error?.code).toBe('CONSTRAINT_VIOLATED');
		expect(result.error?.message).toBe(
			"Path '/data/report.csv' for flag --outDir is a file, expected a directory",
		);
	});

	it('reports a directory where a file was expected', async () => {
		const cmd = fileCommand(flag.path({ type: 'file' }));
		const probe = statProbe({ '/data': 'directory' });

		const result = await runCommand(cmd, ['--file', '/data'], { stat: probe.stat });
		expect(result.exitCode).toBe(2);
		expect(result.error?.code).toBe('CONSTRAINT_VIOLATED');
		expect(result.error?.message).toBe(
			"Path '/data' for flag --file is a directory, expected a file",
		);
	});

	it('skips filesystem checks when no stat option is provided', async () => {
		const cmd = fileCommand(flag.path({ mustExist: true, type: 'file' }));

		const result = await runCommand(cmd, ['--file', '/definitely/missing']);
		expect(result.exitCode).toBe(0);
		expect(result.error).toBeUndefined();
		expect(result.stdout.join('\n')).toContain('file=/definitely/missing');
	});

	// --- env source

	it('validates env-provided path values — stat receives the env value', async () => {
		const cmd = fileCommand(flag.path({ mustExist: true }).env('INPUT_FILE'));
		const probe = statProbe({ '/from-env.txt': 'file' });

		const result = await runCommand(cmd, [], {
			env: { INPUT_FILE: '/from-env.txt' },
			stat: probe.stat,
		});
		expect(result.exitCode).toBe(0);
		expect(result.stdout.join('\n')).toContain('file=/from-env.txt');
		expect(probe.calls).toEqual(['/from-env.txt']);
	});

	it('rejects a missing env-provided path', async () => {
		const cmd = fileCommand(flag.path({ mustExist: true }).env('INPUT_FILE'));
		const probe = statProbe();

		const result = await runCommand(cmd, [], {
			env: { INPUT_FILE: '/env-missing.txt' },
			stat: probe.stat,
		});
		expect(result.exitCode).toBe(2);
		expect(result.error?.code).toBe('CONSTRAINT_VIOLATED');
		expect(result.error?.message).toBe("Path '/env-missing.txt' for flag --file does not exist");
		expect(probe.calls).toEqual(['/env-missing.txt']);
	});

	// --- no checks, no stat calls

	it('never calls stat for a plain flag.path()', async () => {
		const cmd = fileCommand(flag.path());
		const probe = statProbe();

		const result = await runCommand(cmd, ['--file', '/anything'], { stat: probe.stat });
		expect(result.exitCode).toBe(0);
		expect(result.stdout.join('\n')).toContain('file=/anything');
		expect(probe.calls).toEqual([]);
	});

	// --- string constraints on path flags

	it('.nonEmpty() rejects an empty path value at parse time', async () => {
		const cmd = fileCommand(flag.path().nonEmpty());

		const result = await runCommand(cmd, ['--file', '']);
		expect(result.exitCode).toBe(2);
		expect(result.error?.code).toBe('INVALID_VALUE');
	});

	it('.nonEmpty() accepts a non-empty path and still runs path checks', async () => {
		const cmd = fileCommand(flag.path({ mustExist: true }).nonEmpty());
		const probe = statProbe({ '/present.txt': 'file' });

		const result = await runCommand(cmd, ['--file', '/present.txt'], { stat: probe.stat });
		expect(result.exitCode).toBe(0);
		expect(result.stdout.join('\n')).toContain('file=/present.txt');
		expect(probe.calls).toEqual(['/present.txt']);
	});
});
