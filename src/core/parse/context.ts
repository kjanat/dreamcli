/** @module dreamcli/core/parse/context */

/** One spelling of a flag in the arguments passed to the matched command. */
export interface ParseOccurrence {
	/** The flag spelling, including its dashes and excluding any attached value. */
	readonly spelling: string;
	/** Zero-based index in the matched command's argv. Grouped short flags share an index. */
	readonly index: number;
	/** Whether this spelling selected the flag's declared negation. */
	readonly negated: boolean;
}

/** CLI occurrences of one flag, before its duplicate policy selected a value. */
export interface ParseFlagInfo {
	/** Whether the command line supplied the flag. */
	readonly present: boolean;
	/** Number of times the flag appeared, including aliases and negations. */
	readonly count: number;
	/** Flag spellings in command-line order. */
	readonly occurrences: readonly ParseOccurrence[];
}

/** Read-only token information for one command invocation. */
export interface ParseContext {
	/** Metadata accumulated by argv transforms for this invocation, shallowly frozen. */
	readonly metadata: Readonly<Record<string, unknown>>;
	/** Look up a flag by its declared name. An absent flag has zero occurrences. */
	readonly flag: (name: string) => ParseFlagInfo;
}

const absent: ParseFlagInfo = Object.freeze({
	present: false,
	count: 0,
	occurrences: Object.freeze([]),
});

/** @internal Record spellings during the parser walk and expose a read-only view to callbacks. */
export function createOccurrenceRecorder(metadata: Readonly<Record<string, unknown>>) {
	const flags = new Map<string, ParseOccurrence[]>();
	const context: ParseContext = Object.freeze({
		metadata,
		flag(name: string): ParseFlagInfo {
			const occurrences = flags.get(name);
			return occurrences
				? Object.freeze({
						present: true,
						count: occurrences.length,
						occurrences: Object.freeze([...occurrences]),
					})
				: absent;
		},
	});
	return {
		context,
		record(name: string, spelling: string, index: number, negated: boolean): void {
			const occurrence = Object.freeze({ spelling, index, negated });
			const existing = flags.get(name);
			if (existing) existing.push(occurrence);
			else flags.set(name, [occurrence]);
		},
	};
}
