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

	const messages = errors.map((error) => error.message);
	throw new ValidationError(`Multiple validation errors:\n  - ${messages.join('\n  - ')}`, {
		code: errors[0].code,
		details: {
			errors: errors.map((error) => error.toJSON()),
			count: errors.length,
		},
		suggest: 'Fix all missing required values listed above',
	});
}

export { collectValidationErrors, isNonEmpty, throwAggregatedErrors };
