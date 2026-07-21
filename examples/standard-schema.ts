#!/usr/bin/env bun
/**
 * Standard Schema validation for custom flags and args.
 *
 * Demonstrates: `flag.custom(schema)` accepting any Standard Schema v1
 * validator with inferred output types. Zod 4, Valibot, and ArkType all
 * conform; the inline schema below shows the contract itself with zero
 * dependencies.
 *
 * Usage:
 *   npx tsx examples/standard-schema.ts --port 8080
 *   npx tsx examples/standard-schema.ts --port 99999   # validation error
 *   npx tsx examples/standard-schema.ts --port abc     # validation error
 */

import type { StandardSchemaV1 } from '@kjanat/dreamcli';
import { cli, command, flag } from '@kjanat/dreamcli';

// Any object with `~standard` conforms — this is what zod.dev/valibot.dev
// schemas look like under the hood. With a library: flag.custom(z.coerce.number().int().max(65535)).
const port: StandardSchemaV1<unknown, number> = {
	'~standard': {
		version: 1,
		vendor: 'example',
		validate: (value) => {
			const parsed = Number(value);
			if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
				return { issues: [{ message: `expected a port (1-65535), got ${String(value)}` }] };
			}
			return { value: parsed };
		},
	},
};

const serve = command('serve')
	.description('Serve on a schema-validated port')
	// Validation runs after source resolution — argv, env, config, prompt,
	// and default values all pass through the same schema.
	.flag('port', flag.custom(port).default(3000).env('PORT').describe('Port to bind'))
	.action(({ flags, out }) => {
		// flags.port: number — inferred from the schema's output type.
		out.log(`listening on :${flags.port}`);
	});

void cli('serve').version('1.0.0').default(serve).run();
