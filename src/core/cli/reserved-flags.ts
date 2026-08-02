/**
 * Build-time guard for command flags the CLI root already owns.
 *
 * `--json`, `--quiet`/`-q` and `--help`/`-h` never reach a command handler, and
 * `--version`/`-V` joins them once the CLI declares a version. A command flag
 * spelled the same way can never be set, so registering one throws
 * {@linkcode CLIError} `RESERVED_FLAG` here rather than building a CLI whose
 * flag silently stays at its default (#84).
 *
 * A built-in released through `.builtins({ <name>: 'off' })` drops out of the
 * reserved set, which is what makes the flag declarable (#86).
 *
 * @module dreamcli/core/cli/reserved-flags
 * @internal
 */

import { CLIError } from '#internals/core/errors/index.ts';
import type { CommandSchema } from '#internals/core/schema/command.ts';
import type { FlagSchema } from '#internals/core/schema/flag.ts';
import { getFlagAliasNames, getFlagNegatedName } from '#internals/core/schema/flag.ts';
import type { BuiltinName, BuiltinsConfig } from './builtins.ts';
import { BUILTIN_NAMES, BUILTIN_SPECS, builtinEnabled, builtinTokens } from './builtins.ts';

/** What the root does with a token, and how a colliding command flag is fixed. @internal */
interface ReservedFlag {
	/** Spelling of the root flag that owns the token. */
	readonly rootSpelling: string;
	/** Clause explaining why the command cannot receive the token. */
	readonly effect: string;
	/** Remedy offered as the error's `suggest`. */
	readonly remedy: string;
}

/** Remedy for a reserved token whose only fix is a different spelling. */
const RENAME = 'Rename the flag';

/** Why the root never hands a command the tokens it strips from argv. */
const STRIPPED = 'The root strips that token before dispatch';

/** Why a command never receives `--help`, in either interception path. */
const HELP_INTERCEPTED = 'A help request renders before flags are parsed';

/** Why a command never receives `--version`. */
const VERSION_INTERCEPTED = 'The root intercepts that token before dispatch';

/** Extra clause offered for `--quiet`, which has a framework equivalent. */
const STATUS_ALTERNATIVE = 'use out.status() for output that root --quiet suppresses';

/** Offer the `.builtins()` opt-out alongside renaming. */
function releaseRemedy(name: BuiltinName, ...alternatives: readonly string[]): string {
	return [
		RENAME,
		...alternatives,
		`release the built-in with .builtins({ ${name}: 'off' }) before registering the command`,
	].join(', or ');
}

/** Why the root owns each built-in's tokens. */
const BUILTIN_EFFECTS: Readonly<Record<BuiltinName, string>> = {
	help: HELP_INTERCEPTED,
	json: STRIPPED,
	quiet: STRIPPED,
};

/** How a collision with each built-in is fixed. */
const BUILTIN_REMEDIES: Readonly<Record<BuiltinName, string>> = {
	help: releaseRemedy('help'),
	json: releaseRemedy('json'),
	quiet: releaseRemedy('quiet', STATUS_ALTERNATIVE),
};

/** Reservation for `--version`/`-V`, active once the CLI declares a version. */
const VERSION_RESERVED: ReservedFlag = {
	rootSpelling: '--version',
	effect: VERSION_INTERCEPTED,
	remedy: RENAME,
};

/** Tokens the root owns only once a version is configured. */
const VERSION_TOKENS: readonly string[] = ['version', 'V'];

/**
 * The tokens a CLI's commands may not spell.
 *
 * Built by walking {@link BUILTIN_SPECS}, so the reserved set and the spellings
 * the root actually reads cannot drift, and a released built-in is absent here
 * by construction.
 */
function reservedTokens(
	version: string | undefined,
	builtins: BuiltinsConfig | undefined,
): ReadonlyMap<string, ReservedFlag> {
	const reserved = new Map<string, ReservedFlag>();

	for (const name of BUILTIN_NAMES) {
		if (!builtinEnabled(builtins, name)) continue;
		const entry: ReservedFlag = {
			rootSpelling: BUILTIN_SPECS[name].spelling,
			effect: BUILTIN_EFFECTS[name],
			remedy: BUILTIN_REMEDIES[name],
		};
		for (const token of builtinTokens(name)) reserved.set(token, entry);
	}

	if (version !== undefined) {
		for (const token of VERSION_TOKENS) reserved.set(token, VERSION_RESERVED);
	}

	return reserved;
}

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
 * @param builtins - Built-in state; a released built-in reserves nothing.
 *   `undefined` keeps every built-in on.
 * @throws {@linkcode CLIError} `RESERVED_FLAG` for the first collision found.
 *
 * @internal
 */
function assertNoReservedFlagCollisions(
	version: string | undefined,
	commands: readonly (CommandSchema | undefined)[],
	builtins?: BuiltinsConfig,
): void {
	const reserved = reservedTokens(version, builtins);

	for (const schema of commands) {
		if (schema === undefined) continue;
		const collision = findReservedCollision(schema, reserved);
		if (collision !== undefined) throw reservedFlagError(collision);
	}
}

export { assertNoReservedFlagCollisions };
