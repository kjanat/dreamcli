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
 * and `generateCommandSchema()`.
 */
const DEFINITION_SCHEMA_VERSION = 1;

export { DEFINITION_SCHEMA_URL, DEFINITION_SCHEMA_VERSION };
