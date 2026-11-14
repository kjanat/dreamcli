/**
 * Color selection from injected execution options.
 * @module dreamcli/core/output/color
 * @internal
 */

interface ExecutionColorOptions {
	readonly color?: boolean;
	readonly isTTY?: boolean;
	readonly jsonMode?: boolean;
	readonly env?: Readonly<Record<string, string | undefined>>;
}

function resolveExecutionColor(options: ExecutionColorOptions): boolean {
	if (options.color !== undefined) return options.color;
	if (options.jsonMode) return false;
	const env = options.env ?? {};
	if (env.NO_COLOR) return false;
	if (env.FORCE_COLOR !== undefined) return env.FORCE_COLOR !== '0';
	return options.isTTY ?? false;
}

export { resolveExecutionColor };
