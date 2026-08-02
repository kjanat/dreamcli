/**
 * Build-time guard for command flags the CLI root already owns.
 *
 * `--json`, `--quiet`/`-q` and `--help`/`-h` never reach a command handler, and
 * `--version`/`-V` joins them once the CLI declares a version. A command flag
 * spelled the same way can never be set, so registering one throws
 * {@linkcode CLIError} `RESERVED_FLAG` here rather than building a CLI whose
 * flag silently stays at its default (#84).
 *
 * @module dreamcli/core/cli/reserved-flags
 * @internal
 */

import { CLIError } from '#internals/core/errors/index.ts';
import type { CommandSchema } from '#internals/core/schema/command.ts';
import type { FlagSchema } from '#internals/core/schema/flag.ts';
import { getFlagAliasNames, getFlagNegatedName } from '#internals/core/schema/flag.ts';
import type { RootOutputFlagName } from './root-output-flags.ts';
import { ROOT_OUTPUT_TOKENS } from './root-output-flags.ts';

/** What the root does with a token, and how a colliding command flag is fixed. @internal */
interface ReservedFlag {
	/** Spelling of the root flag that owns the token. */
	readonly rootSpelling: string;
	/** Clause explaining why the command cannot receive the token. */
	readonly effect: string;
	/** Remedy offered as the error's `suggest`. */
	readonly remedy: string;
}

/** Remedy for every reserved token whose only fix is a different spelling. */
const RENAME = 'Rename the flag';

/** Remedy for the `--quiet`/`-q` tokens, which have a framework equivalent. */
const RENAME_OR_STATUS =
	'Rename the flag, or use out.status() for output that root --quiet suppresses';

/** Remedy per root output flag, keyed by the canonical name the root strips under. */
const ROOT_OUTPUT_REMEDIES: Readonly<Record<RootOutputFlagName, string>> = {
	json: RENAME,
	quiet: RENAME_OR_STATUS,
};

/** Reservations for the tokens {@linkcode ROOT_OUTPUT_TOKENS} strips from argv. */
const OUTPUT_RESERVED: readonly (readonly [string, ReservedFlag])[] = [...ROOT_OUTPUT_TOKENS].map(
	([token, name]) => [
		token,
		{
			rootSpelling: `--${name}`,
			effect: 'The root strips that token before dispatch',
			remedy: ROOT_OUTPUT_REMEDIES[name],
		},
	],
);

/**
 * Reservation for `--help`/`-h`.
 *
 * The root intercepts the token when it precedes any command token, and the
 * command executor renders help ahead of `parse()` otherwise, so neither path
 * assigns the flag a value.
 */
const HELP_RESERVED: ReservedFlag = {
	rootSpelling: '--help',
	effect: 'A help request renders before flags are parsed',
	remedy: RENAME,
};

/** Reservation for `--version`/`-V`, active once the CLI declares a version. */
const VERSION_RESERVED: ReservedFlag = {
	rootSpelling: '--version',
	effect: 'The root intercepts that token before dispatch',
	remedy: RENAME,
};

/** Tokens the root owns on every CLI, keyed by their bare spelling. */
const ALWAYS_RESERVED: readonly (readonly [string, ReservedFlag])[] = [
	...OUTPUT_RESERVED,
	['help', HELP_RESERVED],
	['h', HELP_RESERVED],
];

/** Tokens the root owns only once a version is configured. */
const VERSION_TOKENS: readonly (readonly [string, ReservedFlag])[] = [
	['version', VERSION_RESERVED],
	['V', VERSION_RESERVED],
];

/** Reserved tokens with a version declared. */
const RESERVED_WITH_VERSION: ReadonlyMap<string, ReservedFlag> = new Map([
	...ALWAYS_RESERVED,
	...VERSION_TOKENS,
]);

/** Reserved tokens without a version declared. */
const RESERVED_WITHOUT_VERSION: ReadonlyMap<string, ReservedFlag> = new Map(ALWAYS_RESERVED);

/** Which declaration on a flag produced a colliding spelling. @internal */
type CollisionOrigin = 'name' | 'alias' | 'negation';

/** One declared spelling that lands on a reserved token. @internal */
interface ReservedCollision {
	/** Command that declares the colliding flag. */
	readonly commandName: string;
	/** Canonical name of the colliding flag. */
	readonly flagName: string;
	/** Colliding spelling, dashes included. */
	readonly spelling: string;
	/** Which declaration on the flag produced the spelling. */
	readonly origin: CollisionOrigin;
	/** Root flag that owns the token. */
	readonly reserved: ReservedFlag;
}

/** Render a bare token the way argv spells it. */
function spellingOf(token: string): string {
	return token.length === 1 ? `-${token}` : `--${token}`;
}

/** Every spelling one flag answers to, paired with the declaration it came from. */
function flagSpellings(
	flagName: string,
	flagSchema: FlagSchema,
): readonly (readonly [string, CollisionOrigin])[] {
	const spellings: (readonly [string, CollisionOrigin])[] = [[flagName, 'name']];

	for (const alias of getFlagAliasNames(flagSchema, { includeHidden: true })) {
		spellings.push([alias, 'alias']);
	}

	const negated = getFlagNegatedName(flagName, flagSchema);
	if (negated !== undefined) spellings.push([negated, 'negation']);

	return spellings;
}

/**
 * Find the first flag in a command tree whose spelling is reserved.
 *
 * @param schema - Command to walk, including its nested subcommands.
 * @param reserved - Reserved tokens for the current CLI configuration.
 * @returns The collision, or `undefined` when the tree is clean.
 *
 * @internal
 */
function findReservedCollision(
	schema: CommandSchema,
	reserved: ReadonlyMap<string, ReservedFlag>,
): ReservedCollision | undefined {
	for (const [flagName, flagSchema] of Object.entries(schema.flags)) {
		for (const [token, origin] of flagSpellings(flagName, flagSchema)) {
			const match = reserved.get(token);
			if (match === undefined) continue;

			return {
				commandName: schema.name,
				flagName,
				spelling: spellingOf(token),
				origin,
				reserved: match,
			};
		}
	}

	for (const child of schema.commands) {
		const nested = findReservedCollision(child, reserved);
		if (nested !== undefined) return nested;
	}

	return undefined;
}

/** Describe the colliding declaration the way the error opens. */
function subjectOf(collision: ReservedCollision): string {
	switch (collision.origin) {
		case 'name':
			return `defines a '${collision.spelling}' flag`;
		case 'alias':
			return `defines a '${collision.spelling}' alias on flag '${collision.flagName}'`;
		case 'negation':
			return `defines a '${collision.spelling}' negated spelling on flag '${collision.flagName}'`;
	}
}

/** Build the `RESERVED_FLAG` error for a collision. */
function reservedFlagError(collision: ReservedCollision): CLIError {
	return new CLIError(
		`Command '${collision.commandName}' ${subjectOf(collision)}, which is reserved by the root '${collision.reserved.rootSpelling}' flag. ${collision.reserved.effect}, so the command can never receive it`,
		{
			code: 'RESERVED_FLAG',
			details: { command: collision.commandName, flag: collision.flagName },
			suggest: collision.reserved.remedy,
		},
	);
}

/**
 * Reject command trees declaring a flag the CLI root already owns.
 *
 * @param version - The CLI's declared version; `undefined` leaves
 *   `--version`/`-V` available to commands.
 * @param commands - Command trees to walk. `undefined` entries are skipped so
 *   callers can pass an absent default command directly.
 * @throws {@linkcode CLIError} `RESERVED_FLAG` for the first collision found.
 *
 * @internal
 */
function assertNoReservedFlagCollisions(
	version: string | undefined,
	commands: readonly (CommandSchema | undefined)[],
): void {
	const reserved = version !== undefined ? RESERVED_WITH_VERSION : RESERVED_WITHOUT_VERSION;

	for (const schema of commands) {
		if (schema === undefined) continue;
		const collision = findReservedCollision(schema, reserved);
		if (collision !== undefined) throw reservedFlagError(collision);
	}
}

export { assertNoReservedFlagCollisions };
