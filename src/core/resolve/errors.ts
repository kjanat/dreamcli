/**
 * Internal resolver error helpers.
 *
 * Keeps validation aggregation and nested-error flattening separate from
 * resolution orchestration.
 *
 * @module dreamcli/core/resolve/errors
 * @internal
 */

import type { ValidationErrorCode } from '#internals/core/errors/index.ts';
import { ValidationError } from '#internals/core/errors/index.ts';

type AggregateIssueSourceKind = 'env' | 'config' | 'stdin' | 'prompt';

interface AggregateIssueSummary {
	readonly code: ValidationErrorCode;
	readonly inputKind: 'flag' | 'arg' | 'input';
	readonly name?: string;
	readonly label: string;
	readonly message: string;
	readonly sourceKind?: AggregateIssueSourceKind;
	readonly sourceLabel?: string;
}

function isRecord(value: unknown): value is object {
	if (value === null || typeof value !== 'object') {
		return false;
	}

	return true;
}

function readStringProperty(record: object, key: string): string | undefined {
	const value = Reflect.get(record, key);
	return typeof value === 'string' ? value : undefined;
}

function hasValueProperty(record: object, key: string): boolean {
	return Object.hasOwn(record, key);
}

function describeIssueSource(
	details: object,
): { readonly kind: AggregateIssueSourceKind; readonly label: string } | undefined {
	const explicitSource = readStringProperty(details, 'source');
	if (explicitSource === 'stdin') {
		return { kind: 'stdin', label: 'stdin' };
	}

	if (explicitSource === 'prompt') {
		return { kind: 'prompt', label: 'prompt' };
	}

	if (hasValueProperty(details, 'value')) {
		const envVar = readStringProperty(details, 'envVar');
		if (envVar !== undefined) {
			return { kind: 'env', label: `env ${envVar}` };
		}

		const configPath = readStringProperty(details, 'configPath');
		if (configPath !== undefined) {
			return { kind: 'config', label: `config ${configPath}` };
		}
	}

	return undefined;
}

function summarizeValidationError(error: ValidationError): AggregateIssueSummary {
	const details = error.details;
	if (!isRecord(details)) {
		return {
			code: error.code,
			inputKind: 'input',
			label: 'input',
			message: error.message,
		};
	}

	const flag = readStringProperty(details, 'flag');
	if (flag !== undefined) {
		const source = describeIssueSource(details);
		return {
			code: error.code,
			inputKind: 'flag',
			name: flag,
			label: `flag --${flag}`,
			message: error.message,
			...(source !== undefined ? { sourceKind: source.kind, sourceLabel: source.label } : {}),
		};
	}

	const arg = readStringProperty(details, 'arg');
	if (arg !== undefined) {
		const source = describeIssueSource(details);
		return {
			code: error.code,
			inputKind: 'arg',
			name: arg,
			label: `argument <${arg}>`,
			message: error.message,
			...(source !== undefined ? { sourceKind: source.kind, sourceLabel: source.label } : {}),
		};
	}

	return {
		code: error.code,
		inputKind: 'input',
		label: 'input',
		message: error.message,
	};
}

function formatAggregateHeadline(issues: readonly AggregateIssueSummary[]): string {
	const flagCount = issues.filter((issue) => issue.inputKind === 'flag').length;
	const argCount = issues.filter((issue) => issue.inputKind === 'arg').length;
	const otherCount = issues.length - flagCount - argCount;
	const counts: string[] = [];

	if (flagCount > 0) {
		counts.push(`${flagCount} flag${flagCount === 1 ? '' : 's'}`);
	}

	if (argCount > 0) {
		counts.push(`${argCount} arg${argCount === 1 ? '' : 's'}`);
	}

	if (otherCount > 0) {
		counts.push(`${otherCount} input${otherCount === 1 ? '' : 's'}`);
	}

	return counts.length === 0
		? `Multiple validation errors (${issues.length})`
		: `Multiple validation errors (${counts.join(', ')})`;
}

function formatAggregateLine(issue: AggregateIssueSummary): string {
	const source = issue.sourceLabel !== undefined ? ` [${issue.sourceLabel}]` : '';
	return `${issue.label}${source}: ${issue.message}`;
}

function isNonEmpty<T>(arr: readonly T[]): arr is readonly [T, ...T[]] {
	return arr.length > 0;
}

function isValidationErrorJson(value: unknown): value is {
	readonly code: ValidationErrorCode;
	readonly message: string;
	readonly exitCode: number;
	readonly suggest?: string;
	readonly details?: Readonly<Record<string, unknown>>;
} {
	if (value === null || typeof value !== 'object') {
		return false;
	}

	if (!('code' in value) || !('message' in value) || !('exitCode' in value)) {
		return false;
	}

	if (typeof value.code !== 'string' || typeof value.message !== 'string') {
		return false;
	}

	if (typeof value.exitCode !== 'number') {
		return false;
	}

	if ('suggest' in value && value.suggest !== undefined && typeof value.suggest !== 'string') {
		return false;
	}

	if (
		'details' in value &&
		value.details !== undefined &&
		(value.details === null || typeof value.details !== 'object')
	) {
		return false;
	}

	return true;
}

function collectValidationErrors(error: ValidationError): readonly ValidationError[] {
	const nestedErrors = error.details?.errors;
	if (!Array.isArray(nestedErrors)) {
		return [error];
	}

	const flattened: ValidationError[] = [];
	for (const entry of nestedErrors) {
		if (!isValidationErrorJson(entry)) {
			return [error];
		}

		flattened.push(
			new ValidationError(entry.message, {
				code: entry.code,
				exitCode: entry.exitCode,
				...(entry.suggest !== undefined ? { suggest: entry.suggest } : {}),
				...(entry.details !== undefined ? { details: entry.details } : {}),
			}),
		);
	}

	return flattened;
}

function throwAggregatedErrors(errors: readonly [ValidationError, ...ValidationError[]]): never {
	if (errors.length === 1) {
		throw errors[0];
	}

	const issues = errors.map(summarizeValidationError);
	const lines = issues.map(formatAggregateLine);
	throw new ValidationError(`${formatAggregateHeadline(issues)}:\n  - ${lines.join('\n  - ')}`, {
		code: errors[0].code,
		details: {
			errors: errors.map((error) => error.toJSON()),
			count: errors.length,
			issues,
		},
		suggest: 'Fix the listed validation errors and retry',
	});
}

export { collectValidationErrors, isNonEmpty, throwAggregatedErrors };
