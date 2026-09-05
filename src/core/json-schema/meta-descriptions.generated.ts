/**
 * Generated definition meta-schema descriptions from normalized TypeDoc output.
 *
 * @module
 */

const definitionMetaSchemaDescriptions = {
	root: {
		description:
			'Runtime descriptor for the CLI program.\n\nStores the program name, version, description, and registered command schemas.\\\nSealed by createCLISchema and rebuilt by each CLIBuilder step.',
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
					'Schema of the default command dispatched when no subcommand matches.\n\nWhen set, the CLI root behaves like a hybrid command group: subcommands\ndispatch by name as usual, but empty argv or flags-only argv falls\nthrough to this command instead of showing root help.\n\nSet via the .default() builder method\nor the `defaultCommand` field of CLIDefinition.',
			},
			commands: {
				description: 'Schemas of the registered commands, in registration order.',
			},
		},
	},
	defs: {
		command: {
			description:
				"Runtime descriptor produced by CommandBuilder.\n\nConsumers (parser, help generator, CLI dispatcher) read this to\nunderstand the command's shape — flags, args, aliases, subcommands,\nand interactive resolver.",
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
		commandDocument: {
			description:
				'A single-command definition document, version 1.\n\nProduced by generateCommandSchema. Same shape as a\nCommandDefinitionFragmentV1 plus the `schemaVersion` every standalone\ndocument carries.',
			properties: {
				schemaVersion: {
					description:
						'Version of the definition document format emitted by `generateSchema()`\nand `generateCommandSchema()`.',
				},
				name: {
					description: 'The command name used for dispatch.',
				},
				description: {
					description: 'Human-readable description for help text.',
				},
				aliases: {
					description: 'Alternative names accepted for this command.',
				},
				hidden: {
					description: 'Whether the command is omitted from help listings.',
				},
				examples: {
					description: 'Usage examples attached to the command.',
				},
				flags: {
					description: 'Named flag definitions keyed by flag name.',
				},
				args: {
					description: 'Positional argument definitions in CLI order.',
				},
				commands: {
					description: 'Nested subcommand definitions.',
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
				stdin: {
					description:
						'Stdin binding set by `.stdin()` (`undefined` when the flag never reads\nstdin). See StdinBinding.',
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
					description: "Element schema when `kind === 'array'` or `kind === 'keyValue'`.",
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
						'Whether this flag propagates to subcommands in nested command trees.\n\nWhen `true`, the flag is automatically available to all descendant\ncommands. A child command that defines a flag with the same name\nshadows the propagated parent flag.\n\nDefault: `false`',
				},
				negation: {
					description:
						"Negation settings when `kind === 'boolean'` and `.negatable()` was\ncalled (`undefined` otherwise). See FlagNegation.",
				},
				duplicates: {
					description:
						"How repeated CLI occurrences of a singleton flag combine.\n\n- `'last'`  — last occurrence wins (matches historic behavior)\n- `'first'` — first occurrence wins; later ones parse but are ignored\n- `'error'` — a second occurrence is a `ParseError` (`DUPLICATE_FLAG`)\n\nApplies to CLI token occurrences only — env/config/prompt/default\nresolution keeps its precedence semantics and never raises duplicates.\nOccurrences are counted per *logical* flag: aliases and the negated\nspelling all count toward the same flag.\n\nDefault: `'last'`",
				},
				defaultDescription: {
					description:
						'Human-readable replacement for the default value in help, or `false` to\nomit the default annotation.',
				},
				sensitive: {
					description:
						'Whether values from this input must be kept out of user-facing projections.',
				},
			},
		},
		flagElement: {
			description: "Element schema when `kind === 'array'` or `kind === 'keyValue'`.",
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
				stdin: {
					description:
						'Stdin binding set by `.stdin()` (`undefined` when the flag never reads\nstdin). See StdinBinding.',
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
					description: "Element schema when `kind === 'array'` or `kind === 'keyValue'`.",
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
						'Whether this flag propagates to subcommands in nested command trees.\n\nWhen `true`, the flag is automatically available to all descendant\ncommands. A child command that defines a flag with the same name\nshadows the propagated parent flag.\n\nDefault: `false`',
				},
				negation: {
					description:
						"Negation settings when `kind === 'boolean'` and `.negatable()` was\ncalled (`undefined` otherwise). See FlagNegation.",
				},
				duplicates: {
					description:
						"How repeated CLI occurrences of a singleton flag combine.\n\n- `'last'`  — last occurrence wins (matches historic behavior)\n- `'first'` — first occurrence wins; later ones parse but are ignored\n- `'error'` — a second occurrence is a `ParseError` (`DUPLICATE_FLAG`)\n\nApplies to CLI token occurrences only — env/config/prompt/default\nresolution keeps its precedence semantics and never raises duplicates.\nOccurrences are counted per *logical* flag: aliases and the negated\nspelling all count toward the same flag.\n\nDefault: `'last'`",
				},
			},
		},
		stdin: {
			description: 'The normalized stdin axis of a flag or an arg.',
			properties: {
				when: {
					description: 'When this input reads the stdin stream.',
				},
				consume: {
					description: 'Whether this input consumes the stream alone.',
				},
				trim: {
					description: 'Whether one trailing line terminator is dropped from a single value.',
				},
			},
		},
		negation: {
			description:
				'Negation settings for a boolean flag (set by `.negatable()`).\n\nThe negated spelling and the positive form are two spellings of ONE\nlogical flag: they share duplicate policy, and the last CLI occurrence\nwins across both. The negated spelling is presence-only — `--no-foo=x`\nis rejected.',
			properties: {
				alias: {
					description:
						"Explicit negated spelling without the `--` prefix (e.g. `'no-sandbox'`).\n`undefined` synthesizes `no-<flagName>` wherever the flag name is known.",
				},
				hidden: {
					description: 'Hide the negated spelling from help, completions, and suggestions.',
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
				stdin: {
					description:
						'Stdin binding set by `.stdin()` (`undefined` when the arg never reads\nstdin). See StdinBinding.',
				},
				defaultValue: {
					description: 'Runtime default value (if any).',
				},
				defaultDescription: {
					description:
						'Human-readable replacement for the default value in help, or `false` to\nomit the default annotation.',
				},
				sensitive: {
					description:
						'Whether values from this input must be kept out of user-facing projections.',
				},
				description: {
					description: 'Human-readable description for help text.',
				},
				envVar: {
					description:
						"Environment variable name for env resolution.\n\nWhen set and the CLI value is absent, the resolver reads this env var\nand coerces the string to the arg's declared kind.",
				},
				configPath: {
					description: "Dotted config path for config resolution (e.g. `'deploy.region'`).",
				},
				prompt: {
					description: 'Interactive prompt configuration.',
				},
				enumValues: {
					description: "Allowed literal values when `kind === 'enum'`.",
				},
				elementSchema: {
					description:
						"Element schema when `kind === 'keyValue'`.\n\nDescribes the value of each entry, so `arg.keyValue(arg.number())` decodes\n`A=1` to the number `1`. `undefined` leaves entry values as strings.",
				},
				deprecated: {
					description:
						'Deprecation marker.\n\n- `undefined` — not deprecated (default)\n- `true` — deprecated with no migration message\n- `string` — deprecated with a reason/migration message\n\nWhen a deprecated arg is used, a warning is emitted to stderr.\nHelp text shows `[deprecated]` or `[deprecated: <reason>]`.',
				},
			},
		},
		argElement: {
			description:
				"Element schema when `kind === 'keyValue'`.\n\nDescribes the value of each entry, so `arg.keyValue(arg.number())` decodes\n`A=1` to the number `1`. `undefined` leaves entry values as strings.",
			properties: {
				kind: {
					description: 'What kind of value this arg accepts.',
				},
				presence: {
					description:
						'Entry values are required once their containing key-value argument is present.',
				},
				enumValues: {
					description: "Allowed literal values when `kind === 'enum'`.",
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
					description: 'Minimum number of selections required.\n\nDefault: `0`',
				},
				max: {
					description: 'Maximum number of selections allowed.\n\nDefault: `Infinity`',
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
					description: 'Display label shown to the user.\n\nDefault: value',
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
