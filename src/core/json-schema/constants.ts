/**
 * Identifiers of the definition document format.
 *
 * @module dreamcli/core/json-schema/constants
 */

/**
 * `$schema` URL for definition documents.
 *
 * Self-hosted. The `v1` segment is the definition format version, the value
 * every document reports as `schemaVersion`, so it resolves for every package
 * release that emits `schemaVersion: 1`. Two mirrors carry identical bytes:
 * `./node_modules/@kjanat/dreamcli/dreamcli.schema.json` for offline or
 * local-first workflows, and
 * `https://cdn.jsdelivr.net/npm/@kjanat/dreamcli/dreamcli.schema.json` on the
 * npm CDN.
 */
const DEFINITION_SCHEMA_URL = 'https://dreamcli.kjanat.dev/schemas/definition/v1.schema.json';

/**
 * Version of the definition document format emitted by `generateSchema()`
 * and `generateCommandSchema()` from `@kjanat/dreamcli/json-schema`.
 */
const DEFINITION_SCHEMA_VERSION = 1;

/** Meta-schema URL for JSON Schema draft 2020-12 (input validation). */
const JSON_SCHEMA_DRAFT = 'https://json-schema.org/draft/2020-12/schema';

export { DEFINITION_SCHEMA_URL, DEFINITION_SCHEMA_VERSION, JSON_SCHEMA_DRAFT };
