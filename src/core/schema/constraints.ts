/**
 * Command-level relationships between already-resolved inputs.
 * @module dreamcli/core/schema/constraints
 */

import { CLIError } from '#internals/core/errors/index.ts';
import type { CommandSchema } from './command.ts';
import type { StandardSchemaV1 } from './standard.ts';

/** A canonical reference to one declared flag or positional argument. */
type ConstraintInput = { readonly kind: 'flag' | 'arg'; readonly name: string };

/** A declarative relationship between two or more command inputs. */
type CommandConstraint =
	| {
			readonly kind: 'conflicts' | 'requires';
			readonly inputs: readonly [ConstraintInput, ConstraintInput];
	  }
	| {
			readonly kind: 'exactlyOne' | 'atMostOne' | 'allOrNone';
			readonly inputs: readonly [ConstraintInput, ConstraintInput, ...ConstraintInput[]];
	  };

/** Discriminants shared by runtime and definition-document validation. @internal */
const CONSTRAINT_KINDS = [
	'conflicts',
	'requires',
	'exactlyOne',
	'atMostOne',
	'allOrNone',
] as const satisfies readonly CommandConstraint['kind'][];

/** Whether supplying one member excludes others during completion. @internal */
function excludesOtherInputs(constraint: CommandConstraint): boolean {
	return (
		constraint.kind === 'conflicts' ||
		constraint.kind === 'atMostOne' ||
		constraint.kind === 'exactlyOne'
	);
}

type InputName<F extends string, A extends string> =
	| F
	| A
	| { readonly kind: 'flag'; readonly name: F }
	| { readonly kind: 'arg'; readonly name: A };

/** Build relationships using the names declared on a command. */
interface ConstraintBuilder<F extends string, A extends string> {
	/** Reference a flag explicitly when a positional argument has the same name. */
	flag<N extends F>(name: N): { readonly kind: 'flag'; readonly name: N };
	/** Reference a positional argument explicitly. */
	arg<N extends A>(name: N): { readonly kind: 'arg'; readonly name: N };
	/** Disallow supplying both inputs. */
	conflicts(left: InputName<F, A>, right: InputName<F, A>): CommandConstraint;
	/** Require the second input when the first is supplied. */
	requires(input: InputName<F, A>, dependency: InputName<F, A>): CommandConstraint;
	/** Require exactly one of the inputs. */
	exactlyOne(
		...inputs: [InputName<F, A>, InputName<F, A>, ...InputName<F, A>[]]
	): CommandConstraint;
	/** Allow at most one of the inputs. */
	atMostOne(...inputs: [InputName<F, A>, InputName<F, A>, ...InputName<F, A>[]]): CommandConstraint;
	/** Require every member when any member is supplied. */
	allOrNone(...inputs: [InputName<F, A>, InputName<F, A>, ...InputName<F, A>[]]): CommandConstraint;
}

/** Select the object passed to a command-level Standard Schema validator. */
interface CommandValidationOptions {
	/** Validate the flags object, or validate an object containing flags, args, and sources. */
	readonly input?: 'flags' | 'resolved';
}

/** Registered validator and its input selection. @internal */
interface CommandValidator {
	readonly schema: StandardSchemaV1;
	readonly input: NonNullable<CommandValidationOptions['input']>;
}

function constraintBuilder<F extends string, A extends string>(
	schema: Pick<CommandSchema, 'flags'>,
): ConstraintBuilder<F, A> {
	const ref = (input: InputName<F, A>): ConstraintInput =>
		typeof input === 'string'
			? { kind: Object.hasOwn(schema.flags, input) ? 'flag' : 'arg', name: input }
			: input;
	return {
		flag: (name) => ({ kind: 'flag', name }),
		arg: (name) => ({ kind: 'arg', name }),
		conflicts: (left, right) => ({ kind: 'conflicts', inputs: [ref(left), ref(right)] }),
		requires: (input, dependency) => ({ kind: 'requires', inputs: [ref(input), ref(dependency)] }),
		exactlyOne: (first, second, ...rest) => ({
			kind: 'exactlyOne',
			inputs: [ref(first), ref(second), ...rest.map(ref)],
		}),
		atMostOne: (first, second, ...rest) => ({
			kind: 'atMostOne',
			inputs: [ref(first), ref(second), ...rest.map(ref)],
		}),
		allOrNone: (first, second, ...rest) => ({
			kind: 'allOrNone',
			inputs: [ref(first), ref(second), ...rest.map(ref)],
		}),
	};
}

/** Render a constraint input as it appears on the command line. @internal */
function constraintInputLabel(input: ConstraintInput): string {
	return input.kind === 'flag' ? `--${input.name}` : `<${input.name}>`;
}

/** Render the same relationship in help and validation errors. @internal */
function describeConstraint(constraint: CommandConstraint): string {
	const [left, right, ...rest] = constraint.inputs.map(constraintInputLabel);
	const list = [left, right, ...rest].join(', ');
	switch (constraint.kind) {
		case 'conflicts':
			return `${left} conflicts with ${right}`;
		case 'requires':
			return `${left} requires ${right}`;
		case 'exactlyOne':
			return `Supply exactly one of ${list}`;
		case 'atMostOne':
			return `Supply at most one of ${list}`;
		case 'allOrNone':
			return `Supply all or none of ${list}`;
	}
}

/** Reject constraints that cannot be evaluated against the command. @internal */
function checkCommandConstraints(
	schema: Pick<CommandSchema, 'name' | 'flags' | 'args' | 'constraints'>,
): void {
	for (const constraint of schema.constraints ?? []) {
		const { kind, inputs } = constraint;
		if (
			!CONSTRAINT_KINDS.includes(kind) ||
			!Array.isArray(inputs) ||
			inputs.some(
				(input) =>
					input === null ||
					typeof input !== 'object' ||
					typeof input.name !== 'string' ||
					(input.kind !== 'flag' && input.kind !== 'arg'),
			)
		) {
			throw new CLIError('Invalid command constraint', {
				code: 'INVALID_SCHEMA',
				details: { command: schema.name },
			});
		}
		if (
			inputs.length < 2 ||
			((kind === 'conflicts' || kind === 'requires') && inputs.length !== 2) ||
			new Set(inputs.map(constraintInputLabel)).size !== inputs.length
		) {
			throw new CLIError('A command constraint needs distinct inputs', {
				code: 'INVALID_SCHEMA',
				details: { command: schema.name, kind },
			});
		}
		for (const input of inputs) {
			const declared =
				input.kind === 'flag'
					? Object.hasOwn(schema.flags, input.name)
					: schema.args.some((arg) => arg.name === input.name);
			if (!declared) {
				throw new CLIError(
					`Constraint references undeclared input ${constraintInputLabel(input)}`,
					{
						code: 'INVALID_SCHEMA',
						details: { command: schema.name, kind, input },
					},
				);
			}
		}
	}
}

export type {
	CommandConstraint,
	CommandValidationOptions,
	CommandValidator,
	ConstraintBuilder,
	ConstraintInput,
};
export {
	CONSTRAINT_KINDS,
	checkCommandConstraints,
	constraintBuilder,
	constraintInputLabel,
	describeConstraint,
	excludesOtherInputs,
};
