/**
 * Emit the definition meta-schema as `dreamcli.schema.json` at the package root.
 *
 * Detects the runtime to set the registry-specific `$id`:
 * - Deno → JSR URL
 * - Bun/Node → npm CDN URL
 */

import { writeFileSync } from 'node:fs';
import { definitionMetaSchema } from '../src/index.ts';

const isDeno = typeof globalThis.Deno !== 'undefined';
const schemaId = isDeno
	? 'https://jsr.io/@kjanat/dreamcli/schema'
	: 'https://cdn.jsdelivr.net/npm/@kjanat/dreamcli/schema';

const schema = { ...definitionMetaSchema, $id: schemaId };
writeFileSync('dreamcli.schema.json', JSON.stringify(schema, null, '\t'));
