/** Positions where a root option was removed before command dispatch. */
const boundaries = new WeakMap<readonly string[], ReadonlySet<number>>();

function markArgvBoundaries(argv: readonly string[], positions: ReadonlySet<number>): void {
	if (positions.size > 0) boundaries.set(argv, positions);
}

function hasArgvBoundary(argv: readonly string[], index: number): boolean {
	return boundaries.get(argv)?.has(index) === true;
}

function sliceArgvHead(argv: readonly string[], end: number): readonly string[] {
	const head = argv.slice(0, end);
	const positions = boundaries.get(argv);
	if (positions !== undefined) markArgvBoundaries(head, positions);
	return head;
}

function removeArgvToken(argv: readonly string[], index: number): readonly string[] {
	const remaining = [...argv.slice(0, index), ...argv.slice(index + 1)];
	const positions = boundaries.get(argv);
	if (positions !== undefined) {
		markArgvBoundaries(
			remaining,
			new Set([...positions].map((position) => (position > index ? position - 1 : position))),
		);
	}
	return remaining;
}

export { hasArgvBoundary, markArgvBoundaries, removeArgvToken, sliceArgvHead };
