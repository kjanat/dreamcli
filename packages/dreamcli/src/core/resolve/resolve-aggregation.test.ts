import { describe, expect, it } from 'vitest';
import { isValidationError, type ValidationError } from '#internals/core/errors/index.ts';
import type { ParseResult } from '#internals/core/parse/index.ts';
import { createArgSchema } from '#internals/core/schema/arg.ts';
import type { CommandSchema } from '#internals/core/schema/command.ts';
import { createSchema } from '#internals/core/schema/flag.ts';
import { resolve } from './index.ts';

function makeSchema(overrides: Partial<CommandSchema> = {}): CommandSchema {
	return {
		name: 'test',
		description: undefined,
		aliases: [],
		hidden: false,
		examples: [],
		flags: {},
		args: [],
		hasAction: false,
		interactive: undefined,
		middleware: [],
		commands: [],
		...overrides,
	};
}

function makeParsed(overrides: Partial<ParseResult> = {}): ParseResult {
	return {
		flags: {},
		args: {},
		...overrides,
	};
}

async function catchValidationError(
	schema: CommandSchema,
	parsed: ParseResult,
	options?: Parameters<typeof resolve>[2],
): Promise<ValidationError> {
	try {
		await resolve(schema, parsed, options);
		expect.unreachable('should have thrown');
	} catch (error) {
		if (!isValidationError(error)) {
			expect.fail(`Expected ValidationError but got ${String(error)}`);
		}
		return error;
	}
}

function readIssueSummaries(
	error: ValidationError,
): ReadonlyArray<Readonly<Record<string, unknown>>> {
	const details = error.details;
	if (details === undefined) {
		return [];
	}

	const issues = details.issues;
	if (!Array.isArray(issues)) {
		return [];
	}

	return issues.filter(
		(issue): issue is Readonly<Record<string, unknown>> =>
			issue !== null && typeof issue === 'object',
	);
}

describe('resolve — aggregate diagnostics', () => {
	it('summarizes mixed flag and arg failures with per-issue labels', async () => {
		const schema = makeSchema({
			flags: {
				port: createSchema('number', { envVar: 'PORT' }),
				region: createSchema('string', { presence: 'required' }),
			},
			args: [
				{
					name: 'count',
					schema: createArgSchema('number', { stdinMode: true }),
				},
			],
		});

		const error = await catchValidationError(schema, makeParsed(), {
			env: { PORT: 'bad-port' },
			stdinData: 'bad-count',
		});

		expect(error.message).toContain('Multiple validation errors (2 flags, 1 arg)');
		expect(error.message).toContain(
			"flag --port [env PORT]: Invalid number value 'bad-port' from env PORT for flag --port",
		);
		expect(error.message).toContain('flag --region: Missing required flag --region');
		expect(error.message).toContain(
			"argument <count> [stdin]: Invalid number value '<redacted>' from stdin for argument <count>",
		);
		expect(error.suggest).toBe('Fix the listed validation errors and retry');

		expect(readIssueSummaries(error)).toEqual([
			{
				code: 'TYPE_MISMATCH',
				inputKind: 'flag',
				name: 'port',
				label: 'flag --port',
				message: "Invalid number value 'bad-port' from env PORT for flag --port",
				sourceKind: 'env',
				sourceLabel: 'env PORT',
			},
			{
				code: 'REQUIRED_FLAG',
				inputKind: 'flag',
				name: 'region',
				label: 'flag --region',
				message: 'Missing required flag --region',
			},
			{
				code: 'TYPE_MISMATCH',
				inputKind: 'arg',
				name: 'count',
				label: 'argument <count>',
				message: "Invalid number value '<redacted>' from stdin for argument <count>",
				sourceKind: 'stdin',
				sourceLabel: 'stdin',
			},
		]);
	});

	it('keeps nested flag and arg aggregates flattened in summary details', async () => {
		const schema = makeSchema({
			flags: {
				token: createSchema('string', { presence: 'required', envVar: 'API_TOKEN' }),
			},
			args: [
				{
					name: 'target',
					schema: createArgSchema('string', {
						presence: 'required',
						stdinMode: true,
						envVar: 'DEPLOY_TARGET',
					}),
				},
			],
		});

		const error = await catchValidationError(schema, makeParsed(), { env: {} });
		const issueSummaries = readIssueSummaries(error);

		expect(issueSummaries).toHaveLength(2);
		expect(issueSummaries).toEqual([
			{
				code: 'REQUIRED_FLAG',
				inputKind: 'flag',
				name: 'token',
				label: 'flag --token',
				message: 'Missing required flag --token',
			},
			{
				code: 'REQUIRED_ARG',
				inputKind: 'arg',
				name: 'target',
				label: 'argument <target>',
				message: 'Missing required argument <target>',
			},
		]);
	});
});
