# @kjanat/dreamcli/json-schema

Definition documents and input JSON Schema generation. `--help --json` loads this module on demand;
import it directly to emit documents from build scripts and tooling.

```ts twoslash
import {
  generateSchema,
  generateCommandSchema,
  generateInputSchema,
  definitionMetaSchema,
  DEFINITION_SCHEMA_URL,
  DEFINITION_SCHEMA_VERSION,
} from '@kjanat/dreamcli/json-schema';
import type { DefinitionDocument, InputSchemaDocument } from '@kjanat/dreamcli/json-schema';
```

The document types (`DefinitionDocument`, `CommandDefinitionDocument`, every `*FragmentV1`, and
`InputSchemaDocument`) are also exported from the root entry, so code that only names the shapes
does not need this subpath.


### `generateSchema(schema, options?)`

Generate a definition metadata document describing the CLI's structure.

- `schema`: `CLISchema` from `cli.schema`
- `options.includeHidden?`: include hidden commands (default: `true`)
- `options.includePrompts?`: include prompt config on flags (default: `true`)

```ts twoslash
import { cli, command } from '@kjanat/dreamcli';
import { generateSchema } from '@kjanat/dreamcli/json-schema';

const myCli = cli('mycli').command(command('deploy'));

const definition = generateSchema(myCli.schema);
```

### `generateInputSchema(schema, options?)`

Generate a JSON Schema (draft 2020-12) for validating CLI input as JSON.

- `schema`: `CLISchema` or `CommandSchema`
- `options.includeHidden?`: include hidden commands (default: `true`)

Accepts a full `CLISchema` (discriminated union across commands) or a
single `CommandSchema` (flat object schema).

```ts twoslash
import { cli, command } from '@kjanat/dreamcli';
import { generateInputSchema } from '@kjanat/dreamcli/json-schema';

const myCli = cli('mycli').command(command('deploy'));

const inputSchema = generateInputSchema(myCli.schema);
```

### `generateCommandSchema(schema, options?)`

Generate a standalone definition document for one `CommandSchema`. `--help --json` on a command
serializes through it. Options match `generateSchema()`.

### `definitionMetaSchema`

The definition meta-schema as a value, identical to the bytes of
[`@kjanat/dreamcli/schema`](/reference/schema) and the hosted copy at `DEFINITION_SCHEMA_URL`.

### `DEFINITION_SCHEMA_URL` and `DEFINITION_SCHEMA_VERSION`

The `$schema` URL every definition document carries and the format version it reports as
`schemaVersion`. Both constants are also exported from the root entry.
