# Schema Export

dreamcli can export the complete CLI schema as JSON — for tooling,
documentation generation, IDE integration, or config file validation.

## Two Export Formats

### Definition Metadata

`generateSchema()` produces a JSON document describing the full CLI tree:
commands, flags, args, types, constraints, env bindings, prompts, and more.

```ts twoslash
import { writeFileSync } from 'node:fs';
import {
  cli,
  command,
  generateSchema,
} from '@kjanat/dreamcli';

const myCli = cli('mycli').command(command('deploy'));

const definition = generateSchema(myCli.schema);
writeFileSync(
  'cli-schema.json',
  JSON.stringify(definition, null, 2),
);
```

Output includes a `$schema` URL pointing at
`https://dreamcli.kjanat.dev/schemas/definition/v1.schema.json`. The `v1` in
that path is the definition format version, the same one the document reports
as `schemaVersion`. Every release that emits `schemaVersion: 1` resolves to it.

Two mirrors carry the same bytes: the copy inside the installed package, and
`https://cdn.jsdelivr.net/npm/@kjanat/dreamcli/dreamcli.schema.json` on the npm
CDN. Emitted documents always carry the canonical URL in `$schema`, and the
meta-schema pins that exact value. For offline or CI-friendly validation, map
the canonical URL to the local copy in your tooling instead of rewriting the
document — in VS Code:

```json
{
  "json.schemas": [
    {
      "url": "./node_modules/@kjanat/dreamcli/dreamcli.schema.json",
      "fileMatch": ["*.definition.json"]
    }
  ]
}
```

The schema is also importable as `@kjanat/dreamcli/schema`.

Full example output:

```json
{
  "$schema": "https://dreamcli.kjanat.dev/schemas/definition/v1.schema.json",
  "schemaVersion": 1,
  "name": "mycli",
  "version": "1.0.0",
  "commands": [
    {
      "name": "deploy",
      "description": "Deploy the app",
      "flags": {
        "region": {
          "kind": "enum",
          "presence": "defaulted",
          "defaultValue": "us",
          "enumValues": ["us", "eu", "ap"],
          "envVar": "REGION"
        }
      },
      "args": [
        {
          "name": "target",
          "kind": "string",
          "presence": "required"
        }
      ],
      "commands": []
    }
  ]
}
```

### Input Validation Schema

`generateInputSchema()` produces a JSON Schema (draft 2020-12) that
validates CLI input as a JSON object — useful for config file validation.

```ts twoslash
import { writeFileSync } from 'node:fs';
import {
  cli,
  command,
  generateInputSchema,
} from '@kjanat/dreamcli';

const myCli = cli('mycli').command(command('deploy'));

const inputSchema = generateInputSchema(myCli.schema);
writeFileSync(
  'input-schema.json',
  JSON.stringify(inputSchema, null, 2),
);
```

For multi-command CLIs, the output is a `oneOf` discriminated union with
a `command` property identifying each branch:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "oneOf": [
    {
      "type": "object",
      "properties": {
        "command": { "const": "deploy" },
        "region": {
          "type": "string",
          "enum": ["us", "eu", "ap"]
        },
        "target": { "type": "string" }
      },
      "required": ["command", "region", "target"]
    }
  ]
}
```

You can also pass a single `CommandSchema` for a flat object schema
without the `command` discriminator.

Nested subcommands use dot-delimited paths (`"deploy.rollback"`).

## Adding a Schema Command

```ts twoslash
import { cli } from '@kjanat/dreamcli';
import {
  command,
  flag,
  generateSchema,
  generateInputSchema,
} from '@kjanat/dreamcli';

const myCli = cli('mycli');

const schema = command('schema')
  .description('Export CLI schema as JSON')
  .flag(
    'input',
    flag
      .boolean()
      .describe('Output JSON Schema for input validation'),
  )
  .action(({ flags, out }) => {
    const result = flags.input
      ? generateInputSchema(myCli.schema)
      : generateSchema(myCli.schema);
    out.json(result);
  });
```

## Options

Both functions accept `JsonSchemaOptions`:

| Option           | Default | Description                                      |
| ---------------- | ------- | ------------------------------------------------ |
| `includeHidden`  | `true`  | Include commands marked as hidden                |
| `includePrompts` | `true`  | Include prompt config on flags (definition only) |

```ts twoslash
import {
  cli,
  command,
  generateSchema,
} from '@kjanat/dreamcli';

const myCli = cli('mycli').command(command('deploy'));

generateSchema(myCli.schema, { includeHidden: false });
```

## What's Included

### Definition Metadata

Version 1 froze with 4.0. Every field below is optional unless noted, and a
field is written only when the schema carries something other than its default.

Per command: `name` (always), `description`, `aliases`, `hidden`, `examples`,
`flags` (always), `args` (always), nested `commands` (always).

Per flag: `kind` and `presence` (both always), `defaultValue`, `aliases`,
`stdin`, `envVar`, `configPath`, `description`, `enumValues`,
`numberConstraints`, `stringConstraints`, `elementSchema`, `separator`,
`split`, `duplicateKeys`, `unique`, `pathChecks`, `valueHint`, `prompt`,
`deprecated`, `propagate`, `negation`, `duplicates`.

Per arg: `name`, `kind`, and `presence` (all three always), `variadic`,
`stdin`, `defaultValue`, `description`, `envVar`, `configPath`, `enumValues`,
`elementSchema`, `numberConstraints`, `stringConstraints`, `pathChecks`,
`valueHint`, `separator`, `split`, `duplicateKeys`, `unique`, `prompt`,
`deprecated`.

The arg surface carries every flag field except the five bound to flag syntax
(`aliases`, `propagate`, `negation`, `duplicates`, and the `count` kind), and
adds `name` and `variadic`. An `elementSchema` on an arg is an
`ArgElementFragmentV1`, which is the arg fragment without the `name` a position
supplies.

### What's Omitted

Non-serializable runtime values are always excluded:

- Parse functions (`parseFn`)
- Standard Schema validators
- Middleware handlers
- Interactive resolvers
- Action handlers

Value provenance is excluded too, and for a different reason: it describes what
one invocation did rather than what the schema declares. See
[Value provenance](/guide/semantics#which-source-won).

## What's Next?

- [Shell Completions](/guide/completions), another schema-driven export
- [Config Files](/guide/config), validate config with input schemas
