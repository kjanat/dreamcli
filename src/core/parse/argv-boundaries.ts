/** Positions where tokens were removed during preflight or dispatch. */
const boundaries = new WeakMap<readonly string[], ReadonlySet<number>>();

/** Dash-prefixed tokens owned by the preceding option during built-in flag scans. */
const operands = new WeakMap<readonly string[], Set<number>>();

/** Original positions of selected tokens during speculative routing. */
const sourceIndices = new WeakMap<readonly string[], Map<number, number>>();

function trackArgvToken(argv: readonly string[], token: string): readonly string[] {
	const indices = new Map<number, number>();
	for (const [index, arg] of argv.entries()) {
		if (arg === token) indices.set(index, index);
	}
	if (indices.size === 0) return argv;
	const copy = sliceArgv(argv, 0);
	sourceIndices.set(copy, indices);
	return copy;
}

function argvSourceIndex(argv: readonly string[], index: number): number | undefined {
	return sourceIndices.get(argv)?.get(index);
}

function copyArgvSourceIndex(target: readonly string[], index: number, sourceIndex: number): void {
	const indices = sourceIndices.get(target);
	if (indices === undefined) sourceIndices.set(target, new Map([[index, sourceIndex]]));
	else indices.set(index, sourceIndex);
}

function isHyphenOperand(argv: readonly string[], index: number): boolean {
	return operands.get(argv)?.has(index) === true;
}

/**
 * Whether `token` appears in argv before the `--` end-of-options separator.
 *
 * Everything at or after the first `--` is a literal positional, so root-level
 * flag interception (`--help` / `--version` / `--json`) must use this instead of
 * a naive `Array.includes()` — otherwise a post-separator literal (`-- --json`)
 * is wrongly treated as the flag.
 *
 * @param argv - Raw argument strings.
 * @param token - Exact flag token to look for (e.g. `--version`).
 * @returns `true` if `token` occurs before any `--` separator.
 */
function includesBeforeSeparator(argv: readonly string[], token: string): boolean {
	for (const [index, arg] of argv.entries()) {
		if (isHyphenOperand(argv, index)) continue;
		if (arg === '--') return false;
		if (arg === token) return true;
	}
	return false;
}

function markHyphenOperand(argv: readonly string[], index: number): void {
	const existing = operands.get(argv);
	if (existing) existing.add(index);
	else operands.set(argv, new Set([index]));
}

/** Append a retained token while preserving its operand role across a filter. */
function pushArgvToken(
	target: string[],
	argv: readonly string[],
	index: number,
	token: string,
): void {
	if (isHyphenOperand(argv, index)) markHyphenOperand(target, target.length);
	const sourceIndex = argvSourceIndex(argv, index);
	if (sourceIndex !== undefined) copyArgvSourceIndex(target, target.length, sourceIndex);
	target.push(token);
}

function markArgvBoundaries(argv: readonly string[], positions: ReadonlySet<number>): void {
	if (positions.size > 0) boundaries.set(argv, positions);
}

function hasArgvBoundary(argv: readonly string[], index: number): boolean {
	return boundaries.get(argv)?.has(index) === true;
}

function adjacentArgvValue(argv: readonly string[], index: number): string | undefined {
	return hasArgvBoundary(argv, index + 1) ? undefined : argv[index + 1];
}

/** Copy an argv range, translating retained metadata to the new indexes. */
function sliceArgv(argv: readonly string[], start: number, end?: number): string[] {
	const sliced = argv.slice(start, end);
	const offset = start < 0 ? Math.max(0, argv.length + start) : start;
	const limit = offset + sliced.length;
	const positions = boundaries.get(argv);
	if (positions !== undefined) {
		const retainedBoundaries = new Set<number>();
		for (const position of positions) {
			if (position >= offset && position <= limit) retainedBoundaries.add(position - offset);
		}
		markArgvBoundaries(sliced, retainedBoundaries);
	}
	for (const operand of operands.get(argv) ?? []) {
		if (operand >= offset && operand < limit) markHyphenOperand(sliced, operand - offset);
	}
	for (const [index, sourceIndex] of sourceIndices.get(argv) ?? []) {
		if (index >= offset && index < limit) copyArgvSourceIndex(sliced, index - offset, sourceIndex);
	}
	return sliced;
}

function sliceArgvHead(argv: readonly string[], end: number): readonly string[] {
	return sliceArgv(argv, 0, end);
}

/** Map preserved token pairs, anchoring the unchanged prefix and suffix before the interior. */
function mapRetainedArgvEdges(
	argv: readonly string[],
	rewritten: readonly string[],
	positions: ReadonlySet<number>,
): ReadonlyMap<number, number> {
	let prefixLength = 0;
	const sharedLength = Math.min(argv.length, rewritten.length);
	while (prefixLength < sharedLength && argv[prefixLength] === rewritten[prefixLength]) {
		prefixLength++;
	}
	const unchanged = prefixLength === argv.length && prefixLength === rewritten.length;
	let oldTail = argv.length;
	let newTail = rewritten.length;
	while (
		oldTail > prefixLength &&
		newTail > prefixLength &&
		argv[oldTail - 1] === rewritten[newTail - 1]
	) {
		oldTail--;
		newTail--;
	}

	const mapped = new Map<number, number>();
	const interior = new Map<string, { original: number[]; rewritten: number[] }>();
	function edgeKey(tokens: readonly string[], index: number): string {
		return JSON.stringify([tokens[index - 1], tokens[index]]);
	}
	for (const index of positions) {
		if (unchanged || index < prefixLength) {
			mapped.set(index, index);
		} else if (index > oldTail) {
			mapped.set(index, index + newTail - oldTail);
		} else if (index > 0 && index < argv.length) {
			interior.set(edgeKey(argv, index), { original: [], rewritten: [] });
		}
	}
	if (interior.size === 0) return mapped;

	function findInteriorEdges(
		tokens: readonly string[],
		tail: number,
		side: 'original' | 'rewritten',
	) {
		for (let index = Math.max(1, prefixLength); index <= tail && index < tokens.length; index++) {
			interior.get(edgeKey(tokens, index))?.[side].push(index);
		}
	}
	findInteriorEdges(argv, oldTail, 'original');
	findInteriorEdges(rewritten, newTail, 'rewritten');
	for (const matches of interior.values()) {
		// Keep occurrence order when both sides have the same number of matching pairs.
		if (matches.original.length !== matches.rewritten.length) continue;
		for (const [ordinal, nextIndex] of matches.rewritten.entries()) {
			const previousIndex = matches.original[ordinal];
			if (previousIndex !== undefined) mapped.set(previousIndex, nextIndex);
		}
	}
	return mapped;
}

/** Retain metadata where a transform leaves the neighboring tokens intact. */
function copyTransformedArgv(argv: readonly string[], replacement: readonly string[]): string[] {
	const rewritten = [...replacement];
	const positions = boundaries.get(argv);
	const owned = operands.get(argv);
	if (positions === undefined && owned === undefined) return rewritten;

	const mapped = mapRetainedArgvEdges(
		argv,
		rewritten,
		new Set([...(positions ?? []), ...(owned ?? [])]),
	);
	const retainedBoundaries = new Set<number>();
	for (const position of positions ?? []) {
		const index = mapped.get(position);
		if (index !== undefined) retainedBoundaries.add(index);
	}
	markArgvBoundaries(rewritten, retainedBoundaries);
	for (const operand of owned ?? []) {
		const index = mapped.get(operand);
		if (index !== undefined) markHyphenOperand(rewritten, index);
	}
	return rewritten;
}

function removeArgvToken(argv: readonly string[], index: number): readonly string[] {
	const remaining = [...argv.slice(0, index), ...argv.slice(index + 1)];
	const positions = new Set([index]);
	for (const position of boundaries.get(argv) ?? []) {
		positions.add(position > index ? position - 1 : position);
	}
	markArgvBoundaries(remaining, positions);
	for (const operand of operands.get(argv) ?? []) {
		if (operand !== index) markHyphenOperand(remaining, operand > index ? operand - 1 : operand);
	}
	return remaining;
}

export {
	adjacentArgvValue,
	argvSourceIndex,
	copyTransformedArgv,
	hasArgvBoundary,
	includesBeforeSeparator,
	isHyphenOperand,
	markArgvBoundaries,
	markHyphenOperand,
	pushArgvToken,
	removeArgvToken,
	sliceArgv,
	sliceArgvHead,
	trackArgvToken,
};
