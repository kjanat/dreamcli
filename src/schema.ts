/**
 * JSON Schema for DreamCLI definition files.
 *
 * Re-exports the generated `dreamcli.schema.json` meta-schema so tooling,
 * editors, and validation libraries can import it as a typed module.
 *
 * @example
 * ```ts
 * import schema from '@kjanat/dreamcli/schema';
 *
 * console.log(schema.$id); // "dreamcli.schema.json"
 * ```
 *
 * @ignore
 * @module @kjanat/dreamcli/schema
 */
export { default } from '#schema' with { type: 'json' };
