/** Post-resolution validation for the command's complete input set. */
import { CLIError } from '#internals/core/errors/index.ts';
import type { ResolveResult } from '#internals/core/resolve/contracts.ts';
import type { CommandSchema } from '#internals/core/schema/command.ts';
import type { CommandConstraint, ConstraintInput } from '#internals/core/schema/constraints.ts';
import { describeConstraint } from '#internals/core/schema/constraints.ts';
import { wasExplicit } from '#internals/core/schema/provenance.ts';
import type { StandardSchemaV1Issue } from '#internals/core/schema/standard.ts';

function isSupplied(
	input: ConstraintInput,
	schema: CommandSchema,
	resolved: ResolveResult,
): boolean {
	const surface = input.kind === 'flag' ? 'flags' : 'args';
	const sources = resolved.provenance[surface];
	if (!Object.hasOwn(sources, input.name) || !wasExplicit(sources[input.name])) return false;
	return (
		input.kind !== 'flag' ||
		schema.flags[input.name]?.kind !== 'boolean' ||
		resolved.flags[input.name] === true
	);
}

function constraintError(
	constraint: CommandConstraint,
	isActive: (input: ConstraintInput) => boolean,
): CLIError | undefined {
	const supplied = constraint.inputs.filter(isActive);
	const violation = (code: string) =>
		new CLIError(describeConstraint(constraint), { code, details: { constraint, supplied } });
	switch (constraint.kind) {
		case 'conflicts':
			return supplied.length === 2 ? violation('CONFLICTING_FLAGS') : undefined;
		case 'requires':
			return supplied[0] === constraint.inputs[0] && supplied.length === 1
				? violation('MISSING_DEPENDENT_FLAG')
				: undefined;
		case 'exactlyOne':
			return supplied.length !== 1 ? violation('EXACTLY_ONE_REQUIRED') : undefined;
		case 'atMostOne':
			return supplied.length > 1 ? violation('CONFLICTING_FLAGS') : undefined;
		case 'allOrNone':
			return supplied.length !== 0 && supplied.length !== constraint.inputs.length
				? violation('INCOMPLETE_INPUT_GROUP')
				: undefined;
	}
}

function validationIssue(
	issue: StandardSchemaV1Issue,
	resolvedInput: boolean,
): {
	readonly message: string;
	readonly path: readonly string[];
	readonly label?: string;
} {
	const path = (issue.path ?? []).map((segment) =>
		String(typeof segment === 'object' ? segment.key : segment),
	);
	const [first, second] = path;
	const label = resolvedInput
		? first === 'flags' && second !== undefined
			? `--${second}`
			: first === 'args' && second !== undefined
				? `<${second}>`
				: undefined
		: first === undefined
			? undefined
			: `--${first}`;
	return { message: issue.message, path, ...(label !== undefined ? { label } : {}) };
}

/** Check constraints and run validation without replacing resolved values. @internal */
async function validateCommandInputs(
	schema: CommandSchema,
	resolved: ResolveResult,
): Promise<void> {
	for (const constraint of schema.constraints ?? []) {
		const error = constraintError(constraint, (input) => isSupplied(input, schema, resolved));
		if (error !== undefined) throw error;
	}
	for (const validator of schema.validators ?? []) {
		const resolvedInput = validator.input === 'resolved';
		const flags = { ...resolved.flags };
		const input = resolvedInput
			? { flags, args: { ...resolved.args }, sources: resolved.provenance }
			: flags;
		let result: readonly StandardSchemaV1Issue[] | undefined;
		try {
			result = (await validator.schema['~standard'].validate(input)).issues;
		} catch (cause) {
			throw new CLIError('Command validator threw', { code: 'COMMAND_VALIDATION_FAILED', cause });
		}
		if (result === undefined) continue;
		const issues = result.map((issue) => validationIssue(issue, resolvedInput));
		throw new CLIError(
			issues
				.map(({ message, label }) => (label === undefined ? message : `${label}: ${message}`))
				.join('\n') || 'Command inputs failed validation',
			{ code: 'COMMAND_VALIDATION_FAILED', details: { issues } },
		);
	}
}

export { validateCommandInputs };
