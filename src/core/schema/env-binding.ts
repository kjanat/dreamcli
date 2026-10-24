/**
 * Indexed environment bindings: one input read from a numbered family of
 * environment variables.
 *
 * `.env('NAME')` reads one variable. Some protocols spread one logical value
 * across a counted family instead, the way Git's config environment does:
 *
 * ```text
 * GIT_CONFIG_COUNT=2
 * GIT_CONFIG_KEY_0=user.name   GIT_CONFIG_VALUE_0=Kaj
 * GIT_CONFIG_KEY_1=user.email  GIT_CONFIG_VALUE_1=kaj@example.com
 * ```
 *
 * An {@link IndexedEnvBinding} describes such a family as one env source: a
 * count variable that owns indices `0..count-1`, and one variable template per
 * entry (`value`) or per record field (`fields`). The binding stores logical
 * names only; expansion substitutes the base-10 index for `{index}` and nothing
 * else, so any name-level policy applied to the logical names (such as a
 * CLI-wide prefix) commutes with expansion.
 *
 * @module dreamcli/core/schema/env-binding
 */

import { CLIError } from '#internals/core/errors/index.ts';

/** The placeholder a member template expands with the zero-based entry index. */
const ENV_INDEX_PLACEHOLDER = '{index}';

/**
 * The largest count an indexed env family may declare.
 *
 * A count is read from the environment, so a typo or a hostile value must not
 * turn one variable into an unbounded number of lookups and allocations.
 *
 * @internal
 */
const MAX_INDEXED_ENV_COUNT = 10_000;

/**
 * An indexed env family whose entries are single values.
 *
 * ```text
 * SERVER_COUNT=2  SERVER_0=a.example.com  SERVER_1=b.example.com
 * ```
 *
 * reads as `['a.example.com', 'b.example.com']`.
 */
interface IndexedValueEnvBinding {
	/**
	 * Variable holding how many entries the family declares, as a canonical
	 * non-negative integer. When it is unset the env source supplies nothing;
	 * `0` supplies an explicit empty list.
	 */
	readonly count: string;
	/** Variable template for one entry, with `{index}` standing for the zero-based index. */
	readonly value: string;
	/** Not available on a value family; see {@link IndexedRecordEnvBinding}. */
	readonly fields?: never;
}

/**
 * An indexed env family whose entries are records, one variable per field.
 *
 * ```text
 * CONFIG_COUNT=1  CONFIG_KEY_0=user.name  CONFIG_VALUE_0=Kaj
 * ```
 *
 * with `fields: { key: 'CONFIG_KEY_{index}', value: 'CONFIG_VALUE_{index}' }`
 * reads as `[{ key: 'user.name', value: 'Kaj' }]`.
 */
interface IndexedRecordEnvBinding {
	/**
	 * Variable holding how many entries the family declares, as a canonical
	 * non-negative integer. When it is unset the env source supplies nothing;
	 * `0` supplies an explicit empty list.
	 */
	readonly count: string;
	/**
	 * One variable template per record field, each with `{index}` standing for
	 * the zero-based index. Every field is required for every declared entry.
	 */
	readonly fields: Readonly<Record<string, string>>;
	/** Not available on a record family; see {@link IndexedValueEnvBinding}. */
	readonly value?: never;
}

/**
 * A numbered family of environment variables read as one input's env source.
 *
 * Pass it to `.env()` in place of a variable name. The count variable decides
 * whether the env stage supplied a value at all, and how many entries it owns;
 * a declared entry with a missing member is an error, never a fallback to a
 * later source.
 */
type IndexedEnvBinding = IndexedValueEnvBinding | IndexedRecordEnvBinding;

/**
 * Why a variable name or template cannot take part in an indexed binding.
 *
 * @param name - The proposed count name or member template.
 * @param template - Whether the name is a member template, which must carry
 *   the placeholder.
 * @returns A description of the fault, or `undefined` when the name is valid.
 */
function envNameFault(name: unknown, template: boolean): string | undefined {
	if (typeof name !== 'string' || name.length === 0) return 'must be a non-empty string';
	if (name.includes('=') || name.includes('\0')) return "must not contain '=' or NUL";
	const rest = name.split(ENV_INDEX_PLACEHOLDER);
	const placeholders = rest.length - 1;
	if (rest.some((part) => part.includes('{') || part.includes('}'))) {
		return `must not contain braces other than the ${ENV_INDEX_PLACEHOLDER} placeholder`;
	}
	if (template && placeholders === 0) {
		return `must contain the ${ENV_INDEX_PLACEHOLDER} placeholder`;
	}
	if (!template && placeholders > 0) {
		return `must not contain the ${ENV_INDEX_PLACEHOLDER} placeholder`;
	}
	return undefined;
}

/**
 * The `'INVALID_SCHEMA'` error for one malformed part of an indexed binding.
 *
 * @param part - Which part of the binding is malformed (`count`, `value`, or `fields.<name>`).
 * @param fault - What is wrong with it.
 * @param suggest - How to fix it.
 * @returns The error to throw.
 */
function invalidBindingError(part: string, fault: string, suggest: string): CLIError {
	return new CLIError(`Indexed env binding '${part}' ${fault}`, {
		code: 'INVALID_SCHEMA',
		details: { field: 'envIndexed', part },
		suggest,
	});
}

/**
 * Validate an indexed binding and copy it into the frozen form a schema stores.
 *
 * Exactly one of `value` and `fields` must be present. The count names a plain
 * variable; every member template carries `{index}` and no other braces, so a
 * typo such as `{idx}` fails here rather than reading the literal name. Record
 * fields must be non-empty and use distinct templates, since two fields read
 * from one variable could never disagree.
 *
 * @param binding - The binding a builder or definition declares.
 * @returns A frozen copy, with record fields in declaration order.
 * @throws {CLIError} With code `'INVALID_SCHEMA'` on a malformed binding.
 * @internal
 */
function normalizeIndexedEnvBinding(binding: IndexedEnvBinding): IndexedEnvBinding {
	if (typeof binding !== 'object' || binding === null) {
		throw new CLIError('Indexed env binding must be an object', {
			code: 'INVALID_SCHEMA',
			details: { field: 'envIndexed' },
			suggest: "Pass { count, value } or { count, fields } to '.env()'",
		});
	}

	const countFault = envNameFault(binding.count, false);
	if (countFault !== undefined) {
		throw invalidBindingError(
			'count',
			countFault,
			'Name the variable that holds the number of entries, such as ITEM_COUNT',
		);
	}

	const hasValue = Object.hasOwn(binding, 'value') && binding.value !== undefined;
	const hasFields = Object.hasOwn(binding, 'fields') && binding.fields !== undefined;
	if (hasValue === hasFields) {
		throw new CLIError("Indexed env binding needs exactly one of 'value' and 'fields'", {
			code: 'INVALID_SCHEMA',
			details: { field: 'envIndexed' },
			suggest: "Use 'value' for a list of values or 'fields' for a list of records",
		});
	}

	if (hasValue) {
		const valueFault = envNameFault(binding.value, true);
		if (valueFault !== undefined) {
			throw invalidBindingError(
				'value',
				valueFault,
				`Use a template such as ITEM_${ENV_INDEX_PLACEHOLDER}`,
			);
		}
		return Object.freeze({ count: binding.count, value: binding.value as string });
	}

	const fields: unknown = binding.fields;
	if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) {
		throw invalidBindingError(
			'fields',
			'must be an object mapping field names to templates',
			`Use { key: 'KEY_${ENV_INDEX_PLACEHOLDER}', value: 'VALUE_${ENV_INDEX_PLACEHOLDER}' }`,
		);
	}
	const entries = Object.entries(fields);
	if (entries.length === 0) {
		throw invalidBindingError(
			'fields',
			'must declare at least one field',
			"Declare a field per variable, or use 'value' for a list of values",
		);
	}
	const seen = new Map<string, string>();
	for (const [field, template] of entries) {
		if (field.length === 0) {
			throw invalidBindingError('fields', 'must not use an empty field name', 'Name every field');
		}
		const fault = envNameFault(template, true);
		if (fault !== undefined) {
			throw invalidBindingError(
				`fields.${field}`,
				fault,
				`Use a template such as ${field.toUpperCase()}_${ENV_INDEX_PLACEHOLDER}`,
			);
		}
		const other = seen.get(template as string);
		if (other !== undefined) {
			throw invalidBindingError(
				`fields.${field}`,
				`reuses the template of field '${other}'`,
				'Give every field its own variable template',
			);
		}
		seen.set(template as string, field);
	}
	return Object.freeze({
		count: binding.count,
		fields: Object.freeze(Object.fromEntries(entries) as Record<string, string>),
	});
}

/**
 * Expand a member template for one entry.
 *
 * @param template - A validated member template.
 * @param index - The zero-based entry index.
 * @returns The concrete variable name.
 * @internal
 */
function expandEnvTemplate(template: string, index: number): string {
	return template.replaceAll(ENV_INDEX_PLACEHOLDER, String(index));
}

/**
 * The member templates of a binding, as `[field, template]` pairs.
 *
 * A value family has one member and no field name.
 *
 * @param binding - A normalized indexed binding.
 * @returns The templates each entry reads, in field declaration order.
 * @internal
 */
function indexedEnvMembers(
	binding: IndexedEnvBinding,
): readonly (readonly [field: string | undefined, template: string])[] {
	return binding.fields === undefined
		? [[undefined, binding.value]]
		: Object.entries(binding.fields);
}

/**
 * Render a binding for help: the member templates joined with `+`, then the
 * count variable.
 *
 * @param binding - A normalized indexed binding.
 * @returns Text such as `KEY_{index} + VALUE_{index}, count: CONFIG_COUNT`.
 * @internal
 */
function formatIndexedEnvBinding(binding: IndexedEnvBinding): string {
	const templates = indexedEnvMembers(binding).map(([, template]) => template);
	return `${templates.join(' + ')}, count: ${binding.count}`;
}

export type { IndexedEnvBinding, IndexedRecordEnvBinding, IndexedValueEnvBinding };
export {
	ENV_INDEX_PLACEHOLDER,
	expandEnvTemplate,
	formatIndexedEnvBinding,
	indexedEnvMembers,
	MAX_INDEXED_ENV_COUNT,
	normalizeIndexedEnvBinding,
};
