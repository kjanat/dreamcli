/**
 * Tests for completion types, Shell enum, and generators.
 */

import { describe, expect, it } from 'vitest';
import type { CLISchema } from '#internals/core/cli/index.ts';
import { isCLIError } from '#internals/core/errors/index.ts';
import type { ActivityEvent, CommandSchema, FlagSchema } from '#internals/core/schema/index.ts';
import type { CompletionOptions } from './index.ts';
import {
	generateBashCompletion,
	generateCompletion,
	generateZshCompletion,
	SHELLS,
} from './index.ts';

// ===================================================================
// Test helpers
// ===================================================================

/** Minimal FlagSchema with all required fields. */
function flagSchema(overrides: Partial<FlagSchema> = {}): FlagSchema {
	return {
		kind: 'string',
		presence: 'optional',
		defaultValue: undefined,
		aliases: [],
		envVar: undefined,
		configPath: undefined,
		description: undefined,
		enumValues: undefined,
		elementSchema: undefined,
		prompt: undefined,
		parseFn: undefined,
		deprecated: undefined,
		propagate: false,
		...overrides,
	};
}

/** Minimal CommandSchema with all required fields. */
function commandSchema(overrides: Partial<CommandSchema> = {}): CommandSchema {
	return {
		name: 'test',
		description: undefined,
		aliases: [],
		hidden: false,
		examples: [],
		flags: {},
		args: [],
		hasAction: true,
		interactive: undefined,
		middleware: [],
		commands: [],
		...overrides,
	};
}

/** Wrap CommandSchema into an ErasedCommand for CLISchema.commands. */
function erased(schema: CommandSchema) {
	return {
		schema,
		subcommands: new Map(),
		_execute() {
			return Promise.resolve({
				stdout: [] as string[],
				stderr: [] as string[],
				activity: [] as ActivityEvent[],
				exitCode: 0,
				error: undefined,
			});
		},
	};
}

/** Options for `minimalSchema()` — all fields optional, allows explicit `undefined`. */
interface MinimalSchemaOverrides {
	readonly name?: string;
	readonly version?: string | undefined;
	readonly description?: string | undefined;
	readonly commands?: CLISchema['commands'];
	readonly defaultCommand?: CLISchema['defaultCommand'];
	readonly configSettings?: CLISchema['configSettings'];
	readonly packageJsonSettings?: CLISchema['packageJsonSettings'];
	readonly plugins?: CLISchema['plugins'];
}

/** Minimal CLISchema for completion tests. */
function minimalSchema(overrides: MinimalSchemaOverrides = {}): CLISchema {
	return {
		name: overrides.name ?? 'testcli',
		inheritName: false,
		version: 'version' in overrides ? overrides.version : '1.0.0',
		description: 'description' in overrides ? overrides.description : 'A test CLI',
		commands: overrides.commands ?? [],
		...('defaultCommand' in overrides
			? { defaultCommand: overrides.defaultCommand }
			: { defaultCommand: undefined }),
		...(overrides.configSettings !== undefined
			? { configSettings: overrides.configSettings }
			: { configSettings: undefined }),
		...(overrides.packageJsonSettings !== undefined
			? { packageJsonSettings: overrides.packageJsonSettings }
			: { packageJsonSettings: undefined }),
		plugins: overrides.plugins ?? [],
	};
}

function extractBashRootWords(script: string): readonly string[] {
	const matches = [...script.matchAll(/compgen -W '([^']*)' -- "\$cur"/g)];
	const words = matches[matches.length - 1]?.[1];
	if (words === undefined) {
		throw new Error('Could not find root bash completion words');
	}
	return words.split(' ').filter(Boolean);
}

function extractZshRootFunction(script: string, funcName = '_testcli'): string {
	const start = script.indexOf(`${funcName}() {`);
	if (start === -1) {
		throw new Error(`Could not find zsh root function '${funcName}'`);
	}
	const end = script.indexOf(`\n}\n\n${funcName} "$@"`, start);
	if (end === -1) {
		throw new Error(`Could not find end of zsh root function '${funcName}'`);
	}
	return script.slice(start, end);
}

// ===================================================================
// Shell type — SHELLS constant
// ===================================================================

describe('Shell type — SHELLS constant', () => {
	it('contains only implemented shell targets', () => {
		expect(SHELLS).toEqual(['bash', 'zsh']);
	});

	it('is a frozen readonly tuple', () => {
		expect(Object.isFrozen(SHELLS)).toBe(true);
	});
});

// ===================================================================
// CompletionOptions — type contract
// ===================================================================

describe('CompletionOptions — type contract', () => {
	it('accepts empty options', () => {
		const options: CompletionOptions = {};
		expect(options).toEqual({});
	});

	it('accepts functionPrefix', () => {
		const options: CompletionOptions = { functionPrefix: '_myapp' };
		expect(options.functionPrefix).toBe('_myapp');
	});

	it('accepts rootMode', () => {
		const options: CompletionOptions = { rootMode: 'surface' };
		expect(options.rootMode).toBe('surface');
	});
});

// ===================================================================
// generateBashCompletion — script structure
// ===================================================================

describe('generateBashCompletion — script structure', () => {
	it('generates shebang and header comment', () => {
		const script = generateBashCompletion(minimalSchema());

		expect(script).toContain('#!/usr/bin/env bash');
		expect(script).toContain('# Bash completion for testcli');
		expect(script).toContain('# Generated by dreamcli');
	});

	it('generates function named _<name>_completions', () => {
		const script = generateBashCompletion(minimalSchema());

		expect(script).toContain('_testcli_completions() {');
	});

	it('uses _init_completion for variable setup', () => {
		const script = generateBashCompletion(minimalSchema());

		expect(script).toContain('local cur prev words cword');
		expect(script).toContain('_init_completion || return');
	});

	it('registers with complete -F', () => {
		const script = generateBashCompletion(minimalSchema());

		expect(script).toContain('complete -F _testcli_completions testcli');
	});

	it('includes --help and --version as root completions', () => {
		const script = generateBashCompletion(minimalSchema());

		expect(script).toContain('--help');
		expect(script).toContain('--version');
	});

	it('includes --version when schema has version', () => {
		const script = generateBashCompletion(
			minimalSchema({
				version: '1.0.0',
				commands: [erased(commandSchema({ name: 'deploy' }))],
			}),
		);

		expect(script).toContain('--version');
	});

	it('omits --version when schema has no version', () => {
		const script = generateBashCompletion(
			minimalSchema({
				version: undefined,
				commands: [erased(commandSchema({ name: 'deploy' }))],
			}),
		);

		expect(script).toContain('--help');
		expect(script).not.toContain('--version');
	});
});

// ===================================================================
// generateBashCompletion — functionPrefix option
// ===================================================================

describe('generateBashCompletion — functionPrefix option', () => {
	it('uses functionPrefix instead of schema name for function', () => {
		const script = generateBashCompletion(minimalSchema(), { functionPrefix: 'myapp' });

		expect(script).toContain('_myapp_completions() {');
		expect(script).toContain('complete -F _myapp_completions testcli');
	});

	it('sanitizes non-identifier characters in prefix', () => {
		const script = generateBashCompletion(minimalSchema(), { functionPrefix: 'my-app.v2' });

		expect(script).toMatch(/_my_app_v2_[0-9a-f]{8}_completions\(\) \{/);
	});
});

// ===================================================================
// generateBashCompletion — subcommand completions
// ===================================================================

describe('generateBashCompletion — subcommand completions', () => {
	it('lists subcommand names at root level', () => {
		const schema = minimalSchema({
			commands: [
				erased(commandSchema({ name: 'deploy' })),
				erased(commandSchema({ name: 'build' })),
			],
		});
		const script = generateBashCompletion(schema);

		expect(script).toContain("'deploy build --help --version'");
	});

	it('excludes hidden commands from completions', () => {
		const schema = minimalSchema({
			commands: [
				erased(commandSchema({ name: 'deploy' })),
				erased(commandSchema({ name: 'secret', hidden: true })),
			],
		});
		const script = generateBashCompletion(schema);

		expect(script).toContain('deploy');
		expect(script).not.toContain('secret');
	});

	it('includes command aliases in subcommand detection', () => {
		const schema = minimalSchema({
			commands: [erased(commandSchema({ name: 'deploy', aliases: ['d', 'ship'] }))],
		});
		const script = generateBashCompletion(schema);

		// Aliases should appear in the case pattern for subcommand detection
		expect(script).toContain('deploy|d|ship)');
	});
});

// ===================================================================
// generateBashCompletion — root completion policy
// ===================================================================

describe('generateBashCompletion — root completion policy', () => {
	it('keeps hybrid CLIs command-centric by default', () => {
		const serve = erased(
			commandSchema({
				name: 'serve',
				flags: {
					port: flagSchema({ kind: 'string', aliases: ['p'], description: 'Port' }),
				},
			}),
		);
		const status = erased(commandSchema({ name: 'status' }));
		const schema = minimalSchema({
			commands: [serve, status],
			defaultCommand: serve,
		});

		const rootWords = extractBashRootWords(generateBashCompletion(schema));

		expect(rootWords).toEqual(['serve', 'status', '--help', '--version']);
	});

	it('exposes default-command flags at the root in surface mode', () => {
		const serve = erased(
			commandSchema({
				name: 'serve',
				flags: {
					port: flagSchema({ kind: 'string', aliases: ['p'], description: 'Port' }),
					verbose: flagSchema({ kind: 'boolean', propagate: true, description: 'Verbose' }),
				},
				commands: [
					commandSchema({
						name: 'inspect',
						flags: {
							childOnly: flagSchema({ kind: 'boolean', description: 'Child only' }),
						},
					}),
				],
			}),
		);
		const status = erased(commandSchema({ name: 'status' }));
		const schema = minimalSchema({
			commands: [serve, status],
			defaultCommand: serve,
		});

		const rootWords = extractBashRootWords(generateBashCompletion(schema, { rootMode: 'surface' }));

		expect(rootWords).toContain('serve');
		expect(rootWords).toContain('status');
		expect(rootWords).toContain('--help');
		expect(rootWords).toContain('--version');
		expect(rootWords).toContain('--port');
		expect(rootWords).toContain('-p');
		expect(rootWords).toContain('--verbose');
		expect(rootWords).not.toContain('--childOnly');
	});

	it('exposes default-command flags for a single visible default even in subcommands mode', () => {
		const serve = erased(
			commandSchema({
				name: 'serve',
				flags: {
					port: flagSchema({ kind: 'string', aliases: ['p'], description: 'Port' }),
				},
			}),
		);
		const schema = minimalSchema({
			commands: [serve],
			defaultCommand: serve,
		});

		const rootWords = extractBashRootWords(generateBashCompletion(schema));

		expect(rootWords).toEqual(['serve', '--help', '--version', '--port', '-p']);
	});
});

// ===================================================================
// generateBashCompletion — flag completions
// ===================================================================

describe('generateBashCompletion — flag completions', () => {
	it('includes --flagname for each registered flag', () => {
		const schema = minimalSchema({
			commands: [
				erased(
					commandSchema({
						name: 'deploy',
						flags: {
							region: flagSchema({ kind: 'string', description: 'AWS region' }),
							force: flagSchema({ kind: 'boolean' }),
						},
					}),
				),
			],
		});
		const script = generateBashCompletion(schema);

		expect(script).toContain('--region');
		expect(script).toContain('--force');
	});

	it('includes short aliases as -<alias>', () => {
		const schema = minimalSchema({
			commands: [
				erased(
					commandSchema({
						name: 'deploy',
						flags: {
							force: flagSchema({ kind: 'boolean', aliases: ['f'] }),
							verbose: flagSchema({ kind: 'boolean', aliases: ['v'] }),
						},
					}),
				),
			],
		});
		const script = generateBashCompletion(schema);

		expect(script).toContain('-f');
		expect(script).toContain('-v');
	});

	it('includes long aliases as --<alias>', () => {
		const schema = minimalSchema({
			commands: [
				erased(
					commandSchema({
						name: 'deploy',
						flags: {
							force: flagSchema({ kind: 'boolean', aliases: ['no-confirm'] }),
						},
					}),
				),
			],
		});
		const script = generateBashCompletion(schema);

		expect(script).toContain('--no-confirm');
	});
});

// ===================================================================
// generateBashCompletion — enum value completions
// ===================================================================

describe('generateBashCompletion — enum value completions', () => {
	it('generates case branch for enum flag values', () => {
		const schema = minimalSchema({
			commands: [
				erased(
					commandSchema({
						name: 'deploy',
						flags: {
							region: flagSchema({
								kind: 'enum',
								enumValues: ['us-east-1', 'eu-west-1', 'ap-south-1'],
							}),
						},
					}),
				),
			],
		});
		const script = generateBashCompletion(schema);

		expect(script).toContain(`case "\${enum_flag:-$prev}" in`);
		expect(script).toContain('--region)');
		expect(script).toContain("'us-east-1 eu-west-1 ap-south-1'");
	});

	it('includes enum flag aliases in case pattern', () => {
		const schema = minimalSchema({
			commands: [
				erased(
					commandSchema({
						name: 'deploy',
						flags: {
							region: flagSchema({
								kind: 'enum',
								aliases: ['r'],
								enumValues: ['us-east-1', 'eu-west-1'],
							}),
						},
					}),
				),
			],
		});
		const script = generateBashCompletion(schema);

		expect(script).toContain('--region|-r)');
	});

	it('omits enum case section when no enum flags exist', () => {
		const schema = minimalSchema({
			commands: [
				erased(
					commandSchema({
						name: 'deploy',
						flags: {
							force: flagSchema({ kind: 'boolean' }),
						},
					}),
				),
			],
		});
		const script = generateBashCompletion(schema);

		expect(script).not.toContain(`case "\${enum_flag:-$prev}" in`);
	});

	// --- Cross-command enum isolation ---

	it('completes correct enum values per command when same-named flag has different values', () => {
		const schema = minimalSchema({
			commands: [
				erased(
					commandSchema({
						name: 'deploy',
						flags: {
							env: flagSchema({
								kind: 'enum',
								enumValues: ['prod', 'staging'],
							}),
						},
					}),
				),
				erased(
					commandSchema({
						name: 'test',
						flags: {
							env: flagSchema({
								kind: 'enum',
								enumValues: ['unit', 'e2e'],
							}),
						},
					}),
				),
			],
		});
		const script = generateBashCompletion(schema);
		const lines = script.split('\n');

		// Find per-command case branches (inside "Complete flags" section)
		const flagSectionStart = lines.findIndex((l) => l.includes('Complete flags'));
		const flagSection = lines.slice(flagSectionStart);

		const deployIdx = flagSection.findIndex((l) => l.trim().startsWith('deploy)'));
		const testIdx = flagSection.findIndex((l) => l.trim().startsWith('test)'));

		const deployBlock = flagSection.slice(deployIdx, testIdx).join('\n');
		const testBlock = flagSection.slice(testIdx).join('\n');

		expect(deployBlock).toContain("'prod staging'");
		expect(deployBlock).not.toContain('unit');
		expect(deployBlock).not.toContain('e2e');

		expect(testBlock).toContain("'unit e2e'");
		expect(testBlock).not.toContain('prod');
		expect(testBlock).not.toContain('staging');
	});

	it('handles mixed enum and non-enum flags across commands', () => {
		const schema = minimalSchema({
			commands: [
				erased(
					commandSchema({
						name: 'deploy',
						flags: {
							env: flagSchema({
								kind: 'enum',
								enumValues: ['prod', 'staging'],
							}),
							force: flagSchema({ kind: 'boolean' }),
						},
					}),
				),
				erased(
					commandSchema({
						name: 'build',
						flags: {
							target: flagSchema({ kind: 'string' }),
						},
					}),
				),
			],
		});
		const script = generateBashCompletion(schema);
		const lines = script.split('\n');

		const flagSectionStart = lines.findIndex((l) => l.includes('Complete flags'));
		const flagSection = lines.slice(flagSectionStart);

		const deployIdx = flagSection.findIndex((l) => l.trim().startsWith('deploy)'));
		const buildIdx = flagSection.findIndex((l) => l.trim().startsWith('build)'));

		const deployBlock = flagSection.slice(deployIdx, buildIdx).join('\n');
		const buildBlock = flagSection.slice(buildIdx).join('\n');

		// Deploy should have enum case block
		expect(deployBlock).toContain(`case "\${enum_flag:-$prev}" in`);
		expect(deployBlock).toContain("'prod staging'");

		// Build should NOT have enum case block (no enum flags)
		expect(buildBlock).not.toContain(`case "\${enum_flag:-$prev}" in`);
	});
});

// ===================================================================
// generateBashCompletion — enum value escaping
// ===================================================================

describe('generateBashCompletion — enum value escaping', () => {
	it('passes simple values through unescaped', () => {
		const schema = minimalSchema({
			commands: [
				erased(
					commandSchema({
						name: 'deploy',
						flags: {
							region: flagSchema({
								kind: 'enum',
								enumValues: ['us-east-1', 'eu-west-1'],
							}),
						},
					}),
				),
			],
		});
		const script = generateBashCompletion(schema);

		expect(script).toContain("compgen -W 'us-east-1 eu-west-1'");
		expect(script).not.toContain('IFS');
	});

	it('uses $-quoting with IFS for values containing spaces', () => {
		const schema = minimalSchema({
			commands: [
				erased(
					commandSchema({
						name: 'deploy',
						flags: {
							env: flagSchema({
								kind: 'enum',
								enumValues: ['hello world', 'foo'],
							}),
						},
					}),
				),
			],
		});
		const script = generateBashCompletion(schema);

		expect(script).toContain("local IFS=$'\\n'");
		expect(script).toContain("compgen -W $'hello world\\nfoo'");
	});

	it('escapes single quotes in enum values', () => {
		const schema = minimalSchema({
			commands: [
				erased(
					commandSchema({
						name: 'deploy',
						flags: {
							msg: flagSchema({
								kind: 'enum',
								enumValues: ["it's", 'normal'],
							}),
						},
					}),
				),
			],
		});
		const script = generateBashCompletion(schema);

		expect(script).toContain("local IFS=$'\\n'");
		expect(script).toContain("it\\'s");
	});

	it('escapes backslashes in enum values', () => {
		const schema = minimalSchema({
			commands: [
				erased(
					commandSchema({
						name: 'deploy',
						flags: {
							path: flagSchema({
								kind: 'enum',
								enumValues: ['C:\\Users', 'normal'],
							}),
						},
					}),
				),
			],
		});
		const script = generateBashCompletion(schema);

		expect(script).toContain("local IFS=$'\\n'");
		expect(script).toContain('C:\\\\Users');
	});

	it('handles mixed pathological values', () => {
		const schema = minimalSchema({
			commands: [
				erased(
					commandSchema({
						name: 'deploy',
						flags: {
							weird: flagSchema({
								kind: 'enum',
								enumValues: ["it's here", 'C:\\path', 'normal'],
							}),
						},
					}),
				),
			],
		});
		const script = generateBashCompletion(schema);

		// All values use $'...' quoting because at least one needs it
		expect(script).toContain("local IFS=$'\\n'");
		expect(script).toContain("compgen -W $'");
		expect(script).toContain("it\\'s here");
		expect(script).toContain('C:\\\\path');
		expect(script).toContain('normal');
	});
});

// ===================================================================
// generateBashCompletion — no commands (flags-only CLI)
// ===================================================================

describe('generateBashCompletion — no commands', () => {
	it('generates script with --help and --version when version defined', () => {
		const script = generateBashCompletion(minimalSchema());

		expect(script).toContain("'--help --version'");
		expect(script).not.toContain('subcmd');
	});

	it('generates script with only --help when no version', () => {
		const script = generateBashCompletion(minimalSchema({ version: undefined }));

		expect(script).toContain("'--help'");
		expect(script).not.toContain('--version');
		expect(script).not.toContain('subcmd');
	});
});

// ===================================================================
// generateBashCompletion — CLI name sanitization
// ===================================================================

describe('generateBashCompletion — name sanitization', () => {
	it('replaces hyphens in CLI name for function identifier', () => {
		const schema = minimalSchema({ name: 'my-cli-tool' });
		const script = generateBashCompletion(schema);

		expect(script).toMatch(/_my_cli_tool_[0-9a-f]{8}_completions\(\) \{/);
		// complete line still uses original name
		expect(script).toMatch(/complete -F _my_cli_tool_[0-9a-f]{8}_completions my-cli-tool/);
	});

	it('replaces dots in CLI name for function identifier', () => {
		const schema = minimalSchema({ name: 'app.cli' });
		const script = generateBashCompletion(schema);

		expect(script).toMatch(/_app_cli_[0-9a-f]{8}_completions\(\) \{/);
	});
});

// ===================================================================
// generateBashCompletion — name escaping (shell injection prevention)
// ===================================================================

describe('generateBashCompletion — name escaping', () => {
	it('leaves shell-safe names unquoted in complete line', () => {
		const script = generateBashCompletion(minimalSchema({ name: 'my-cli' }));

		expect(script).toMatch(/complete -F _my_cli_[0-9a-f]{8}_completions my-cli/);
	});

	it('leaves dotted names unquoted in complete line', () => {
		const script = generateBashCompletion(minimalSchema({ name: 'app.v2' }));

		expect(script).toMatch(/complete -F _app_v2_[0-9a-f]{8}_completions app\.v2/);
	});

	it('single-quotes names with spaces in complete line', () => {
		const script = generateBashCompletion(minimalSchema({ name: 'my cli' }));

		expect(script).toMatch(/complete -F _my_cli_[0-9a-f]{8}_completions 'my cli'/);
	});

	it('escapes single quotes in CLI name', () => {
		const script = generateBashCompletion(minimalSchema({ name: "it's" }));

		expect(script).toMatch(/complete -F _it_s_[0-9a-f]{8}_completions 'it'\\''s'/);
	});

	it('single-quotes names with backticks', () => {
		const script = generateBashCompletion(minimalSchema({ name: 'cli`whoami`' }));

		expect(script).toMatch(/complete -F _cli_whoami__+[0-9a-f]{8}_completions 'cli`whoami`'/);
	});

	it('single-quotes names with semicolons', () => {
		const script = generateBashCompletion(minimalSchema({ name: 'cli;rm -rf /' }));

		expect(script).toContain("'cli;rm -rf /'");
	});

	it('single-quotes names with dollar signs', () => {
		const script = generateBashCompletion(minimalSchema({ name: '$HOME' }));

		expect(script).toMatch(/complete -F __HOME_[0-9a-f]{8}_completions '\$HOME'/);
	});
});

// ===================================================================
// generateZshCompletion — script structure
// ===================================================================

describe('generateZshCompletion — script structure', () => {
	it('generates #compdef directive with CLI name', () => {
		const script = generateZshCompletion(minimalSchema());

		expect(script).toContain('#compdef testcli');
	});

	it('generates header comment', () => {
		const script = generateZshCompletion(minimalSchema());

		expect(script).toContain('# Zsh completion for testcli');
		expect(script).toContain('# Generated by dreamcli');
	});

	it('generates function named _<name>', () => {
		const script = generateZshCompletion(minimalSchema());

		expect(script).toContain('_testcli() {');
	});

	it('declares local variables for state tracking', () => {
		const schema = minimalSchema({
			commands: [erased(commandSchema({ name: 'deploy' }))],
		});
		const script = generateZshCompletion(schema);

		expect(script).toContain('local -a subcmds');
		expect(script).toContain('local line state');
	});

	it('ends with function invocation _<name> "$@"', () => {
		const script = generateZshCompletion(minimalSchema());

		expect(script).toContain('_testcli "$@"');
	});

	it('includes --help in root _arguments', () => {
		const script = generateZshCompletion(minimalSchema());

		expect(script).toContain('--help[Show help text]');
	});

	it('includes --version when schema has version', () => {
		const script = generateZshCompletion(
			minimalSchema({
				version: '1.0.0',
				commands: [erased(commandSchema({ name: 'test' }))],
			}),
		);

		expect(script).toContain('--version[Show version]');
	});

	it('omits --version when schema has no version', () => {
		const script = generateZshCompletion(
			minimalSchema({
				version: undefined,
				commands: [erased(commandSchema({ name: 'test' }))],
			}),
		);

		expect(script).not.toContain('--version');
	});

	it('includes --version in no-commands path when version defined', () => {
		const script = generateZshCompletion(minimalSchema({ version: '2.0.0', commands: [] }));

		expect(script).toContain('--version[Show version]');
	});
});

// ===================================================================
// generateZshCompletion — functionPrefix option
// ===================================================================

describe('generateZshCompletion — functionPrefix option', () => {
	it('uses functionPrefix instead of schema name for function', () => {
		const script = generateZshCompletion(minimalSchema(), { functionPrefix: 'myapp' });

		expect(script).toContain('_myapp() {');
		expect(script).toContain('_myapp "$@"');
	});

	it('sanitizes non-identifier characters in prefix', () => {
		const script = generateZshCompletion(minimalSchema(), { functionPrefix: 'my-app.v2' });

		expect(script).toMatch(/_my_app_v2_[0-9a-f]{8}\(\) \{/);
	});

	it('keeps #compdef using original CLI name, not prefix', () => {
		const script = generateZshCompletion(minimalSchema(), { functionPrefix: 'myapp' });

		expect(script).toContain('#compdef testcli');
	});
});

// ===================================================================
// generateZshCompletion — subcommand completions
// ===================================================================

describe('generateZshCompletion — subcommand completions', () => {
	it('lists subcommands with _describe', () => {
		const schema = minimalSchema({
			commands: [
				erased(commandSchema({ name: 'deploy', description: 'Deploy app' })),
				erased(commandSchema({ name: 'build', description: 'Build project' })),
			],
		});
		const script = generateZshCompletion(schema);

		expect(script).toContain("_describe 'command' subcmds");
		expect(script).toContain("'deploy:Deploy app'");
		expect(script).toContain("'build:Build project'");
	});

	it('excludes hidden commands from completions', () => {
		const schema = minimalSchema({
			commands: [
				erased(commandSchema({ name: 'deploy', description: 'Deploy app' })),
				erased(commandSchema({ name: 'secret', hidden: true })),
			],
		});
		const script = generateZshCompletion(schema);

		expect(script).toContain('deploy');
		expect(script).not.toContain('secret');
	});

	it('includes command aliases in case pattern', () => {
		const schema = minimalSchema({
			commands: [erased(commandSchema({ name: 'deploy', aliases: ['d', 'ship'] }))],
		});
		const script = generateZshCompletion(schema);

		expect(script).toContain('deploy|d|ship)');
	});

	it('uses command name as description when description is undefined', () => {
		const schema = minimalSchema({
			commands: [erased(commandSchema({ name: 'deploy', description: undefined }))],
		});
		const script = generateZshCompletion(schema);

		expect(script).toContain("'deploy:deploy'");
	});

	it('escapes colons in descriptions', () => {
		const schema = minimalSchema({
			commands: [erased(commandSchema({ name: 'deploy', description: 'Deploy: now' }))],
		});
		const script = generateZshCompletion(schema);

		expect(script).toContain("'deploy:Deploy\\: now'");
	});
});

// ===================================================================
// generateZshCompletion — root completion policy
// ===================================================================

describe('generateZshCompletion — root completion policy', () => {
	it('keeps hybrid CLIs command-centric by default', () => {
		const serve = erased(
			commandSchema({
				name: 'serve',
				flags: {
					port: flagSchema({ kind: 'string', aliases: ['p'], description: 'Port' }),
				},
			}),
		);
		const status = erased(commandSchema({ name: 'status', description: 'Status' }));
		const schema = minimalSchema({
			commands: [serve, status],
			defaultCommand: serve,
		});

		const rootFunction = extractZshRootFunction(generateZshCompletion(schema));

		expect(rootFunction).toContain("'--help[Show help text]'");
		expect(rootFunction).toContain("'--version[Show version]'");
		expect(rootFunction).not.toContain("'--port[Port]:value:'");
		expect(rootFunction).toContain("'1: :->subcmd'");
		expect(rootFunction).toContain("'serve:serve'");
		expect(rootFunction).toContain("'status:Status'");
	});

	it('exposes default-command flags at the root in surface mode', () => {
		const serve = erased(
			commandSchema({
				name: 'serve',
				flags: {
					port: flagSchema({ kind: 'string', aliases: ['p'], description: 'Port' }),
					verbose: flagSchema({ kind: 'boolean', propagate: true, description: 'Verbose' }),
				},
				commands: [
					commandSchema({
						name: 'inspect',
						flags: {
							childOnly: flagSchema({ kind: 'boolean', description: 'Child only' }),
						},
					}),
				],
			}),
		);
		const status = erased(commandSchema({ name: 'status' }));
		const schema = minimalSchema({
			commands: [serve, status],
			defaultCommand: serve,
		});

		const rootFunction = extractZshRootFunction(
			generateZshCompletion(schema, { rootMode: 'surface' }),
		);

		expect(rootFunction).toContain("'(-p --port)'{-p,--port}'[Port]:value:'");
		expect(rootFunction).toContain("'--verbose[Verbose]'");
		expect(rootFunction).not.toContain("'--childOnly[Child only]'");
	});

	it('exposes default-command flags for a single visible default even in subcommands mode', () => {
		const serve = erased(
			commandSchema({
				name: 'serve',
				flags: {
					port: flagSchema({ kind: 'string', aliases: ['p'], description: 'Port' }),
				},
			}),
		);
		const schema = minimalSchema({
			commands: [serve],
			defaultCommand: serve,
		});

		const rootFunction = extractZshRootFunction(generateZshCompletion(schema));

		expect(rootFunction).toContain("'(-p --port)'{-p,--port}'[Port]:value:'");
	});
});

// ===================================================================
// generateZshCompletion — flag completions
// ===================================================================

describe('generateZshCompletion — flag completions', () => {
	it('generates _arguments specs for command flags', () => {
		const schema = minimalSchema({
			commands: [
				erased(
					commandSchema({
						name: 'deploy',
						flags: {
							region: flagSchema({ kind: 'string', description: 'AWS region' }),
						},
					}),
				),
			],
		});
		const script = generateZshCompletion(schema);

		expect(script).toContain('_arguments');
		expect(script).toContain('--region[AWS region]');
	});

	it('generates mutual exclusion group for short aliases', () => {
		const schema = minimalSchema({
			commands: [
				erased(
					commandSchema({
						name: 'deploy',
						flags: {
							force: flagSchema({ kind: 'boolean', aliases: ['f'], description: 'Force' }),
						},
					}),
				),
			],
		});
		const script = generateZshCompletion(schema);

		expect(script).toContain("(-f --force)'{-f,--force}'[Force]");
	});

	it('omits value part for boolean flags', () => {
		const schema = minimalSchema({
			commands: [
				erased(
					commandSchema({
						name: 'deploy',
						flags: {
							force: flagSchema({ kind: 'boolean', description: 'Force deploy' }),
						},
					}),
				),
			],
		});
		const script = generateZshCompletion(schema);

		// Boolean flag should end at the description, no :value: part
		expect(script).toContain("'--force[Force deploy]'");
	});

	it('adds :value: for string flags', () => {
		const schema = minimalSchema({
			commands: [
				erased(
					commandSchema({
						name: 'deploy',
						flags: {
							name: flagSchema({ kind: 'string', description: 'Name' }),
						},
					}),
				),
			],
		});
		const script = generateZshCompletion(schema);

		expect(script).toContain("'--name[Name]:value:'");
	});

	it('adds enum values for enum flags', () => {
		const schema = minimalSchema({
			commands: [
				erased(
					commandSchema({
						name: 'deploy',
						flags: {
							region: flagSchema({
								kind: 'enum',
								description: 'Region',
								enumValues: ['us-east-1', 'eu-west-1'],
							}),
						},
					}),
				),
			],
		});
		const script = generateZshCompletion(schema);

		expect(script).toContain('--region[Region]:value:(us-east-1 eu-west-1)');
	});

	it('uses flag name as description when description is undefined', () => {
		const schema = minimalSchema({
			commands: [
				erased(
					commandSchema({
						name: 'deploy',
						flags: {
							verbose: flagSchema({ kind: 'boolean', description: undefined }),
						},
					}),
				),
			],
		});
		const script = generateZshCompletion(schema);

		expect(script).toContain("'--verbose[verbose]'");
	});
});

// ===================================================================
// generateZshCompletion — enum value escaping
// ===================================================================

describe('generateZshCompletion — enum value escaping', () => {
	it('passes simple values through unescaped', () => {
		const schema = minimalSchema({
			commands: [
				erased(
					commandSchema({
						name: 'deploy',
						flags: {
							region: flagSchema({
								kind: 'enum',
								description: 'Region',
								enumValues: ['us-east-1', 'eu-west-1'],
							}),
						},
					}),
				),
			],
		});
		const script = generateZshCompletion(schema);

		expect(script).toContain(':value:(us-east-1 eu-west-1)');
	});

	it('escapes spaces in enum values with backslash', () => {
		const schema = minimalSchema({
			commands: [
				erased(
					commandSchema({
						name: 'deploy',
						flags: {
							env: flagSchema({
								kind: 'enum',
								description: 'Environment',
								enumValues: ['hello world', 'foo'],
							}),
						},
					}),
				),
			],
		});
		const script = generateZshCompletion(schema);

		expect(script).toContain(':value:(hello\\ world foo)');
	});

	it('escapes single quotes in enum values', () => {
		const schema = minimalSchema({
			commands: [
				erased(
					commandSchema({
						name: 'deploy',
						flags: {
							msg: flagSchema({
								kind: 'enum',
								description: 'Message',
								enumValues: ["it's", 'normal'],
							}),
						},
					}),
				),
			],
		});
		const script = generateZshCompletion(schema);

		expect(script).toContain(":value:(it\\'s normal)");
	});

	it('escapes backslashes in enum values', () => {
		const schema = minimalSchema({
			commands: [
				erased(
					commandSchema({
						name: 'deploy',
						flags: {
							path: flagSchema({
								kind: 'enum',
								description: 'Path',
								enumValues: ['C:\\Users', 'normal'],
							}),
						},
					}),
				),
			],
		});
		const script = generateZshCompletion(schema);

		expect(script).toContain(':value:(C:\\\\Users normal)');
	});

	it('escapes parentheses in enum values', () => {
		const schema = minimalSchema({
			commands: [
				erased(
					commandSchema({
						name: 'deploy',
						flags: {
							expr: flagSchema({
								kind: 'enum',
								description: 'Expr',
								enumValues: ['(a)', 'normal'],
							}),
						},
					}),
				),
			],
		});
		const script = generateZshCompletion(schema);

		expect(script).toContain(':value:(\\(a\\) normal)');
	});

	it('handles mixed pathological values', () => {
		const schema = minimalSchema({
			commands: [
				erased(
					commandSchema({
						name: 'deploy',
						flags: {
							weird: flagSchema({
								kind: 'enum',
								description: 'Weird',
								enumValues: ["it's here", 'C:\\path', 'normal'],
							}),
						},
					}),
				),
			],
		});
		const script = generateZshCompletion(schema);

		expect(script).toContain("it\\'s\\ here");
		expect(script).toContain('C:\\\\path');
		expect(script).toContain('normal');
	});
});

// ===================================================================
// generateZshCompletion — no commands (flags-only CLI)
// ===================================================================

describe('generateZshCompletion — no commands', () => {
	it('generates script with only --help when no commands', () => {
		const script = generateZshCompletion(minimalSchema({ version: undefined }));

		expect(script).toContain('_arguments');
		expect(script).toContain("'--help[Show help text]'");
		expect(script).not.toContain('subcmds');
		expect(script).not.toContain('_describe');
	});
});

// ===================================================================
// generateZshCompletion — name sanitization
// ===================================================================

describe('generateZshCompletion — name sanitization', () => {
	it('replaces hyphens in CLI name for function identifier', () => {
		const schema = minimalSchema({ name: 'my-cli-tool' });
		const script = generateZshCompletion(schema);

		expect(script).toMatch(/_my_cli_tool_[0-9a-f]{8}\(\) \{/);
		// compdef still uses original name
		expect(script).toContain('#compdef my-cli-tool');
	});

	it('replaces dots in CLI name for function identifier', () => {
		const schema = minimalSchema({ name: 'app.cli' });
		const script = generateZshCompletion(schema);

		expect(script).toMatch(/_app_cli_[0-9a-f]{8}\(\) \{/);
	});
});

// ===================================================================
// generateZshCompletion — name escaping (shell injection prevention)
// ===================================================================

describe('generateZshCompletion — name escaping', () => {
	it('leaves shell-safe names unquoted in #compdef', () => {
		const script = generateZshCompletion(minimalSchema({ name: 'my-cli' }));

		expect(script).toContain('#compdef my-cli');
	});

	it('single-quotes names with spaces in #compdef', () => {
		const script = generateZshCompletion(minimalSchema({ name: 'my cli' }));

		expect(script).toContain("#compdef 'my cli'");
	});

	it('escapes single quotes in CLI name for #compdef', () => {
		const script = generateZshCompletion(minimalSchema({ name: "it's" }));

		expect(script).toContain("#compdef 'it'\\''s'");
	});

	it('single-quotes names with backticks in #compdef', () => {
		const script = generateZshCompletion(minimalSchema({ name: 'cli`whoami`' }));

		expect(script).toContain("#compdef 'cli`whoami`'");
	});

	it('single-quotes names with dollar signs in #compdef', () => {
		const script = generateZshCompletion(minimalSchema({ name: '$HOME' }));

		expect(script).toContain("#compdef '$HOME'");
	});
});

// ===================================================================
// generateCompletion — unified dispatcher
// ===================================================================

describe('generateCompletion — dispatcher', () => {
	it('delegates bash to generateBashCompletion', () => {
		const schema = minimalSchema();
		const script = generateCompletion(schema, 'bash');

		expect(script).toContain('_testcli_completions() {');
		expect(script).toContain('complete -F _testcli_completions testcli');
	});

	it('delegates zsh to generateZshCompletion', () => {
		const schema = minimalSchema();
		const script = generateCompletion(schema, 'zsh');

		expect(script).toContain('#compdef testcli');
		expect(script).toContain('_testcli() {');
	});

	it('passes completion options through to shell generators', () => {
		const serve = erased(
			commandSchema({
				name: 'serve',
				flags: {
					port: flagSchema({ kind: 'string', aliases: ['p'], description: 'Port' }),
				},
			}),
		);
		const status = erased(commandSchema({ name: 'status' }));
		const schema = minimalSchema({
			commands: [serve, status],
			defaultCommand: serve,
		});

		const script = generateCompletion(schema, 'bash', { rootMode: 'surface' });
		const rootWords = extractBashRootWords(script);

		expect(rootWords).toContain('--port');
		expect(rootWords).toContain('-p');
	});

	it('throws CLIError for fish (unsupported)', () => {
		const schema = minimalSchema();

		let caught: unknown;
		try {
			generateCompletion(schema, 'fish');
		} catch (e: unknown) {
			caught = e;
		}
		expect(caught).toBeDefined();
		expect(isCLIError(caught)).toBe(true);
		if (isCLIError(caught)) {
			expect(caught.code).toBe('UNSUPPORTED_OPERATION');
			expect(caught.message).toContain('fish');
			expect(caught.message).toContain('not yet supported');
		}
	});

	it('throws CLIError for powershell (unsupported)', () => {
		const schema = minimalSchema();

		let caught: unknown;
		try {
			generateCompletion(schema, 'powershell');
		} catch (e: unknown) {
			caught = e;
		}
		expect(caught).toBeDefined();
		expect(isCLIError(caught)).toBe(true);
		if (isCLIError(caught)) {
			expect(caught.code).toBe('UNSUPPORTED_OPERATION');
			expect(caught.message).toContain('powershell');
			expect(caught.message).toContain('not yet supported');
		}
	});

	it('passes options through to bash generator', () => {
		const schema = minimalSchema();
		const options: CompletionOptions = { functionPrefix: '_custom' };
		const script = generateCompletion(schema, 'bash', options);

		expect(script).toContain('__custom_completions() {');
	});
});

// ===================================================================
// Nested command completion helpers
// ===================================================================

/** Build a nested command tree for testing. */
function nestedSchema(overrides: MinimalSchemaOverrides = {}): CLISchema {
	const migrateCmd = commandSchema({
		name: 'migrate',
		description: 'Run migrations',
		flags: {
			'dry-run': flagSchema({ kind: 'boolean', description: 'Dry run mode' }),
		},
	});

	const seedCmd = commandSchema({
		name: 'seed',
		description: 'Seed database',
		aliases: ['s'],
		flags: {
			count: flagSchema({ kind: 'number', description: 'Number of records' }),
		},
	});

	const dbCmd = commandSchema({
		name: 'db',
		description: 'Database operations',
		aliases: ['database'],
		flags: {
			verbose: flagSchema({
				kind: 'boolean',
				description: 'Verbose output',
				aliases: ['v'],
				propagate: true,
			}),
		},
		commands: [migrateCmd, seedCmd],
	});

	const deployCmd = commandSchema({
		name: 'deploy',
		description: 'Deploy app',
		flags: {
			force: flagSchema({ kind: 'boolean', description: 'Force deploy' }),
		},
	});

	return minimalSchema({
		commands: [erased(dbCmd), erased(deployCmd)],
		...overrides,
	});
}

/** 3-level deep nested schema: root → db → table → create */
function deepNestedSchema(): CLISchema {
	const createCmd = commandSchema({
		name: 'create',
		description: 'Create table',
		flags: {
			'if-not-exists': flagSchema({ kind: 'boolean', description: 'Skip if exists' }),
		},
	});

	const listCmd = commandSchema({
		name: 'list',
		description: 'List tables',
	});

	const tableCmd = commandSchema({
		name: 'table',
		description: 'Table operations',
		flags: {
			schema: flagSchema({ kind: 'string', description: 'Schema name' }),
		},
		commands: [createCmd, listCmd],
	});

	const dbCmd = commandSchema({
		name: 'db',
		description: 'Database operations',
		flags: {
			verbose: flagSchema({
				kind: 'boolean',
				description: 'Verbose',
				aliases: ['v'],
				propagate: true,
			}),
			host: flagSchema({
				kind: 'string',
				description: 'Database host',
				propagate: true,
			}),
		},
		commands: [tableCmd],
	});

	return minimalSchema({ commands: [erased(dbCmd)] });
}

// ===================================================================
// generateBashCompletion — nested command completions
// ===================================================================

describe('generateBashCompletion — nested subcommand path detection', () => {
	it('generates subcmd_path variable for nested commands', () => {
		const script = generateBashCompletion(nestedSchema());

		expect(script).toContain('subcmd_path=""');
	});

	it('detects top-level commands including aliases', () => {
		const script = generateBashCompletion(nestedSchema());

		// Top-level detection should include db, database, deploy
		expect(script).toContain('db|database)');
		expect(script).toContain('deploy)');
	});

	it('generates path extension for group commands with children', () => {
		const script = generateBashCompletion(nestedSchema());

		// When subcmd_path is "db", should match child names
		expect(script).toContain('migrate)');
		expect(script).toContain('seed|s)');
	});

	it('generates case branches for nested command paths', () => {
		const script = generateBashCompletion(nestedSchema());

		// Should have case branch for "db migrate"
		expect(script).toContain('"db migrate"');
		// Should have case branch for "db seed"
		expect(script).toContain('"db seed"');
	});

	it('includes flags for nested leaf commands', () => {
		const script = generateBashCompletion(nestedSchema());

		// db migrate should have --dry-run
		const lines = script.split('\n');
		const migrateIdx = lines.findIndex((l) => l.includes('"db migrate"'));
		expect(migrateIdx).toBeGreaterThan(-1);
		const migrateBlock = lines.slice(migrateIdx, migrateIdx + 10).join('\n');
		expect(migrateBlock).toContain('--dry-run');
	});

	it('includes subcommand names for group commands', () => {
		const script = generateBashCompletion(nestedSchema());

		// db command should complete its children (migrate, seed) plus its own flags
		const lines = script.split('\n');
		const dbBranchIdx = lines.findIndex(
			(l) => l.trim().startsWith('db|database)') || l.trim() === 'db|database)',
		);
		expect(dbBranchIdx).toBeGreaterThan(-1);
		const dbBlock = lines.slice(dbBranchIdx, dbBranchIdx + 15).join('\n');
		expect(dbBlock).toContain('migrate');
		expect(dbBlock).toContain('seed');
	});
});

describe('generateBashCompletion — nested propagated flags', () => {
	it('includes propagated flags in nested leaf completions', () => {
		const script = generateBashCompletion(nestedSchema());

		// db migrate should inherit --verbose from db (propagate: true)
		const lines = script.split('\n');
		const migrateIdx = lines.findIndex((l) => l.includes('"db migrate"'));
		expect(migrateIdx).toBeGreaterThan(-1);
		const migrateBlock = lines.slice(migrateIdx, migrateIdx + 15).join('\n');
		expect(migrateBlock).toContain('--verbose');
		expect(migrateBlock).toContain('-v');
	});

	it('propagated flags appear alongside own flags', () => {
		const script = generateBashCompletion(nestedSchema());

		const lines = script.split('\n');
		const migrateIdx = lines.findIndex((l) => l.includes('"db migrate"'));
		expect(migrateIdx).toBeGreaterThan(-1);
		const migrateBlock = lines.slice(migrateIdx, migrateIdx + 15).join('\n');
		// Both own flag (--dry-run) and propagated flag (--verbose)
		expect(migrateBlock).toContain('--dry-run');
		expect(migrateBlock).toContain('--verbose');
	});

	it('propagated flags flow through 3 levels', () => {
		const script = generateBashCompletion(deepNestedSchema());

		// db → table → create should inherit --verbose and --host from db
		const lines = script.split('\n');
		const createIdx = lines.findIndex((l) => l.includes('"db table create"'));
		expect(createIdx).toBeGreaterThan(-1);
		const createBlock = lines.slice(createIdx, createIdx + 15).join('\n');
		expect(createBlock).toContain('--verbose');
		expect(createBlock).toContain('--host');
		expect(createBlock).toContain('--if-not-exists');
	});

	it('3-level path detection works', () => {
		const script = generateBashCompletion(deepNestedSchema());

		expect(script).toContain('"db table create"');
		expect(script).toContain('"db table list"');
		expect(script).toContain('"db table"');
	});
});

describe('generateBashCompletion — nested hidden commands', () => {
	it('excludes hidden nested commands from completions', () => {
		const hiddenChild = commandSchema({
			name: 'hidden-cmd',
			hidden: true,
		});

		const dbCmd = commandSchema({
			name: 'db',
			description: 'Database',
			commands: [commandSchema({ name: 'migrate', description: 'Migrate' }), hiddenChild],
		});

		const schema = minimalSchema({ commands: [erased(dbCmd)] });
		const script = generateBashCompletion(schema);

		expect(script).toContain('migrate');
		expect(script).not.toContain('hidden-cmd');
	});
});

// ===================================================================
// generateZshCompletion — nested command completions
// ===================================================================

describe('generateZshCompletion — nested helper functions', () => {
	it('generates helper function for group commands', () => {
		const script = generateZshCompletion(nestedSchema());

		// Should have a _testcli_db() helper function
		expect(script).toContain('_testcli_db() {');
	});

	it('helper function uses _arguments -C for group with children', () => {
		const script = generateZshCompletion(nestedSchema());

		// _testcli_db should use _arguments -C (it has subcommands)
		const lines = script.split('\n');
		const dbFuncIdx = lines.findIndex((l) => l.includes('_testcli_db() {'));
		expect(dbFuncIdx).toBeGreaterThan(-1);
		const dbFunc = lines.slice(dbFuncIdx, dbFuncIdx + 30).join('\n');
		expect(dbFunc).toContain('_arguments -C');
	});

	it('helper function lists subcommands via _describe', () => {
		const script = generateZshCompletion(nestedSchema());

		const lines = script.split('\n');
		const dbFuncIdx = lines.findIndex((l) => l.includes('_testcli_db() {'));
		const dbFunc = lines.slice(dbFuncIdx, dbFuncIdx + 30).join('\n');
		expect(dbFunc).toContain("'migrate:Run migrations'");
		expect(dbFunc).toContain("'seed:Seed database'");
		expect(dbFunc).toContain("_describe 'command' subcmds");
	});

	it('delegates to leaf helper for nested commands', () => {
		const script = generateZshCompletion(nestedSchema());

		const lines = script.split('\n');
		const dbFuncIdx = lines.findIndex((l) => l.includes('_testcli_db() {'));
		const dbFunc = lines.slice(dbFuncIdx, dbFuncIdx + 40).join('\n');
		expect(dbFunc).toContain('_testcli_db_migrate');
		expect(dbFunc).toContain('_testcli_db_seed');
	});

	it('generates leaf helper functions for nested commands', () => {
		const script = generateZshCompletion(nestedSchema());

		expect(script).toContain('_testcli_db_migrate() {');
		expect(script).toContain('_testcli_db_seed() {');
	});

	it('leaf helper includes own flags', () => {
		const script = generateZshCompletion(nestedSchema());

		const lines = script.split('\n');
		const migrateIdx = lines.findIndex((l) => l.includes('_testcli_db_migrate() {'));
		const migrateFunc = lines.slice(migrateIdx, migrateIdx + 10).join('\n');
		expect(migrateFunc).toContain('--dry-run');
	});

	it('root function dispatches to group helper', () => {
		const script = generateZshCompletion(nestedSchema());

		// In the main function's args case, db should dispatch to _testcli_db
		const lines = script.split('\n');
		const mainFuncIdx = lines.findIndex((l) => l.includes('_testcli() {'));
		const mainFunc = lines.slice(mainFuncIdx).join('\n');
		expect(mainFunc).toContain('_testcli_db');
	});
});

describe('generateZshCompletion — nested propagated flags', () => {
	it('includes propagated flags in leaf helper functions', () => {
		const script = generateZshCompletion(nestedSchema());

		const lines = script.split('\n');
		const migrateIdx = lines.findIndex((l) => l.includes('_testcli_db_migrate() {'));
		expect(migrateIdx).toBeGreaterThan(-1);
		const migrateFunc = lines.slice(migrateIdx, migrateIdx + 10).join('\n');
		// Should have both own flag (--dry-run) and propagated (--verbose/-v)
		expect(migrateFunc).toContain('--dry-run');
		expect(migrateFunc).toContain('--verbose');
	});

	it('propagated flags use proper zsh spec format', () => {
		const script = generateZshCompletion(nestedSchema());

		const lines = script.split('\n');
		const migrateIdx = lines.findIndex((l) => l.includes('_testcli_db_migrate() {'));
		const migrateFunc = lines.slice(migrateIdx, migrateIdx + 10).join('\n');
		// --verbose has short alias -v, so should have mutual exclusion group
		expect(migrateFunc).toMatch(/\(-v --verbose\)/);
	});

	it('propagated flags flow through 3 levels in zsh', () => {
		const script = generateZshCompletion(deepNestedSchema());

		// db table create should have: --if-not-exists (own) + --verbose, --host (propagated)
		const lines = script.split('\n');
		const createIdx = lines.findIndex((l) => l.includes('_testcli_db_table_create() {'));
		expect(createIdx).toBeGreaterThan(-1);
		const createFunc = lines.slice(createIdx, createIdx + 10).join('\n');
		expect(createFunc).toContain('--if-not-exists');
		expect(createFunc).toContain('--verbose');
		expect(createFunc).toContain('--host');
	});

	it('generates chained helper functions for 3-level nesting', () => {
		const script = generateZshCompletion(deepNestedSchema());

		expect(script).toContain('_testcli_db() {');
		expect(script).toContain('_testcli_db_table() {');
		expect(script).toContain('_testcli_db_table_create() {');
		expect(script).toContain('_testcli_db_table_list() {');
	});

	it('intermediate group helper dispatches to child helpers', () => {
		const script = generateZshCompletion(deepNestedSchema());

		const lines = script.split('\n');
		const tableIdx = lines.findIndex((l) => l.includes('_testcli_db_table() {'));
		const tableFunc = lines.slice(tableIdx, tableIdx + 30).join('\n');
		expect(tableFunc).toContain('_testcli_db_table_create');
		expect(tableFunc).toContain('_testcli_db_table_list');
	});
});

describe('generateZshCompletion — multi-short-alias exclusion groups', () => {
	it('includes all short aliases in exclusion group', () => {
		const schema = minimalSchema({
			commands: [
				erased(
					commandSchema({
						name: 'deploy',
						flags: {
							verbose: flagSchema({
								kind: 'boolean',
								aliases: ['v', 'V'],
								description: 'Verbose',
							}),
						},
					}),
				),
			],
		});
		const script = generateZshCompletion(schema);

		// Both -v and -V must appear in the exclusion group and comma list
		expect(script).toContain("(-v -V --verbose)'{-v,-V,--verbose}'[Verbose]");
	});

	it('single short alias still works', () => {
		const schema = minimalSchema({
			commands: [
				erased(
					commandSchema({
						name: 'deploy',
						flags: {
							force: flagSchema({ kind: 'boolean', aliases: ['f'], description: 'Force' }),
						},
					}),
				),
			],
		});
		const script = generateZshCompletion(schema);

		expect(script).toContain("(-f --force)'{-f,--force}'[Force]");
	});
});

describe('generateBashCompletion — shell escaping', () => {
	it('escapes single quotes in subcommand names', () => {
		const schema = minimalSchema({
			commands: [erased(commandSchema({ name: "it's-cool", description: 'Has quote' }))],
		});
		const script = generateBashCompletion(schema);

		// The single quote must be escaped via '\'' idiom
		expect(script).toContain("it'\\''s-cool");
		// Must not contain a bare unescaped it's-cool inside the compgen string
		expect(script).not.toMatch(/compgen -W '[^']*it's-cool/);
	});

	it('leaves simple names unescaped', () => {
		const schema = minimalSchema({
			commands: [erased(commandSchema({ name: 'deploy', description: 'Deploy' }))],
		});
		const script = generateBashCompletion(schema);

		expect(script).toContain("compgen -W 'deploy --help --version'");
	});
});

describe('generateZshCompletion — nested hidden commands', () => {
	it('excludes hidden nested commands from zsh completions', () => {
		const hiddenChild = commandSchema({
			name: 'hidden-cmd',
			hidden: true,
		});

		const dbCmd = commandSchema({
			name: 'db',
			description: 'Database',
			commands: [commandSchema({ name: 'migrate', description: 'Migrate' }), hiddenChild],
		});

		const schema = minimalSchema({ commands: [erased(dbCmd)] });
		const script = generateZshCompletion(schema);

		expect(script).toContain('migrate');
		expect(script).not.toContain('hidden-cmd');
	});
});

describe('generateZshCompletion — nested aliases', () => {
	it('includes aliases in child command dispatch patterns', () => {
		const script = generateZshCompletion(nestedSchema());

		const lines = script.split('\n');
		const dbFuncIdx = lines.findIndex((l) => l.includes('_testcli_db() {'));
		const dbFunc = lines.slice(dbFuncIdx, dbFuncIdx + 40).join('\n');
		// seed has alias 's'
		expect(dbFunc).toContain('seed|s)');
	});
});
