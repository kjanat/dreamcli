/**
 * Generated definition meta-schema descriptions from normalized TypeDoc output.
 *
 * @module
 */

const definitionMetaSchemaDescriptions = {
	root: {
		description:
			'Runtime descriptor for the CLI program.\n\nStores the program name, version, description, and registered commands.\\\nBuilt incrementally by CLIBuilder.',
		properties: {
			name: {
				description: 'Program name (used in help text, usage lines, and completion scripts).',
			},
			version: {
				description: 'Program version (shown by `--version`).',
			},
			description: {
				description: 'Program description (shown in root help).',
			},
			defaultCommand: {
				description:
					'Default command dispatched when no subcommand matches.\n\nWhen set, the CLI root behaves like a hybrid command group: subcommands\ndispatch by name as usual, but empty argv or flags-only argv falls\nthrough to this command instead of showing root help.\n\nSet via the .default() builder method.',
			},
			commands: {
				description: 'Registered commands (type-erased for heterogeneous storage).',
			},
		},
	},
	defs: {
		command: {
			description:
				"Runtime descriptor produced by CommandBuilder.\n\nConsumers (parser, help generator, CLI dispatcher) read this to\nunderstand the command's shape — flags, args, aliases, subcommands,\nmiddleware, and interactive resolver.",
			properties: {
				name: {
					description: "The command name (used for dispatch, e.g. `'deploy'`).",
				},
				description: {
					description: 'Human-readable description for help text.',
				},
				aliases: {
					description: 'Alternative names for this command.',
				},
				hidden: {
					description: 'Whether this command is hidden from help listings.',
				},
				examples: {
					description: 'Usage examples for help text.',
				},
				flags: {
					description: 'Named flag schemas, keyed by flag name.',
				},
				args: {
					description: 'Ordered positional arg entries (name + schema).',
				},
				commands: {
					description:
						'Nested subcommand schemas (for help rendering and completion).\n\nPure data — no execution closures. Populated by `.command()` on\n`CommandBuilder`. Empty for leaf commands.',
				},
			},
		},
		flag: {
			description:
				"The runtime descriptor stored inside every FlagBuilder. Consumers (parser,\nhelp generator, resolution chain) read this to understand the flag's shape\nwithout touching generics.",
			properties: {
				kind: {
					description: 'What kind of value this flag accepts.',
				},
				presence: {
					description:
						"Presence describes whether a flag value is guaranteed to exist when the\naction handler runs:\n\n- `'optional'`  — not required; unresolved value follows the kind-specific\n  optional fallback (`undefined` for most flags, `[]` for arrays)\n- `'required'`  — must be supplied; error if missing\n- `'defaulted'` — always present (falls back to default value)",
				},
				defaultValue: {
					description: 'Runtime default value (if any).',
				},
				aliases: {
					description: "Short/long aliases (e.g. `[{ name: 'f', hidden: false }]` for `--force`).",
				},
				envVar: {
					description: 'Environment variable name for v0.2+ resolution.',
				},
				configPath: {
					description: "Dotted config path for v0.2+ resolution (e.g. `'deploy.region'`).",
				},
				description: {
					description: 'Human-readable description for help text.',
				},
				enumValues: {
					description: "Allowed literal values when `kind === 'enum'`.",
				},
				elementSchema: {
					description: "Element schema when `kind === 'array'`.",
				},
				prompt: {
					description: 'Interactive prompt configuration for v0.3+ resolution.',
				},
				deprecated: {
					description:
						'Deprecation marker.\n\n- `undefined` — not deprecated (default)\n- `true` — deprecated with no migration message\n- `string` — deprecated with a reason/migration message\n\nWhen a deprecated flag is used, a warning is emitted to stderr.\nHelp text shows `[deprecated]` or `[deprecated: <reason>]`.',
				},
				propagate: {
					description:
						'Whether this flag propagates to subcommands in nested command trees.\n\nWhen `true`, the flag is automatically available to all descendant\ncommands. A child command that defines a flag with the same name\nshadows the propagated parent flag.',
				},
			},
		},
		arg: {
			description:
				"The runtime descriptor stored inside every ArgBuilder. Consumers (parser,\nhelp generator) read this to understand the arg's shape without touching\ngenerics.",
			properties: {
				name: {
					description:
						'A named positional argument entry in the command schema.\n\nPairs a user-facing arg name with its ArgSchema descriptor.\nThe array ordering in CommandSchema.args determines CLI position.',
				},
				kind: {
					description: 'What kind of value this arg accepts.',
				},
				presence: {
					description:
						"Presence describes whether a positional arg is guaranteed to exist when the\naction handler runs:\n\n- `'required'`  — must be supplied; error if missing (default)\n- `'optional'`  — may be `undefined` if not supplied\n- `'defaulted'` — always present (falls back to default value)",
				},
				variadic: {
					description: 'Whether this arg consumes all remaining positionals.',
				},
				stdinMode: {
					description: 'Whether this arg may read from stdin during resolution.',
				},
				defaultValue: {
					description: 'Runtime default value (if any).',
				},
				description: {
					description: 'Human-readable description for help text.',
				},
				envVar: {
					description:
						"Environment variable name for env resolution.\n\nWhen set and the CLI value is absent, the resolver reads this env var\nand coerces the string to the arg's declared kind.",
				},
				enumValues: {
					description: "Allowed literal values when `kind === 'enum'`.",
				},
				deprecated: {
					description:
						'Deprecation marker.\n\n- `undefined` — not deprecated (default)\n- `true` — deprecated with no migration message\n- `string` — deprecated with a reason/migration message\n\nWhen a deprecated arg is used, a warning is emitted to stderr.\nHelp text shows `[deprecated]` or `[deprecated: <reason>]`.',
				},
			},
		},
		prompt: {
			description:
				"Discriminated union of all prompt configurations.\n\nUse the `kind` field to narrow:\n```ts\nif (config.kind === 'select') {\n  config.choices // readonly SelectChoice[] | undefined\n}\n```",
			properties: {
				kind: {
					description:
						"The kind of interactive prompt to present.\n\n- `'confirm'`     — yes/no boolean question\n- `'input'`       — free-text string input\n- `'select'`      — single selection from a list\n- `'multiselect'` — multiple selections from a list",
				},
				message: {
					description: 'The question displayed to the user.',
				},
				placeholder: {
					description: 'Placeholder text shown before user types (informational only).',
				},
				choices: {
					description:
						'Available choices. When omitted for `enum` flags, the enum values\nfrom the flag schema are used automatically.',
				},
				min: {
					description: 'Minimum number of selections required.',
				},
				max: {
					description: 'Maximum number of selections allowed.',
				},
			},
		},
		choice: {
			description:
				'A selectable option for SelectPromptConfig and MultiselectPromptConfig prompts.',
			properties: {
				value: {
					description: 'The value returned when this choice is selected.',
				},
				label: {
					description: 'Display label shown to the user.',
				},
				description: {
					description: 'Optional description shown alongside the choice.',
				},
			},
		},
		example: {
			description: 'A single usage example shown in help text.',
			properties: {
				command: {
					description: "The command invocation (e.g. `'deploy production --force'`).",
				},
				description: {
					description: 'Optional description of what this example does.',
				},
			},
		},
	},
} as const;

export { definitionMetaSchemaDescriptions };
