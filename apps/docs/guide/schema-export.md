# Schema Export

dreamcli can export the complete CLI schema as JSON — for tooling,
documentation generation, IDE integration, or config file validation.

## Two Export Formats

### Definition Metadata

`generateSchema()` produces a JSON document describing the full CLI tree:
commands, flags, args, types, constraints, env bindings, prompts, and more.

```ts twoslash
// @errors: 2591
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

Output includes a `$schema` URL pointing at the CDN-hosted definition
schema. For offline or CI-friendly setups, use the local copy instead:

```json
{
  "$schema": "./node_modules/@kjanat/dreamcli/dreamcli.schema.json"
}
```

The schema is also importable as `@kjanat/dreamcli/schema`.

Full example output:

```json
{
  "$schema": "https://cdn.jsdelivr.net/npm/@kjanat/dreamcli/dreamcli.schema.json",
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
// @errors: 2591
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

Per command: `name`, `description`, `aliases`, `hidden`, `examples`,
`flags`, `args`, nested `commands`.

Per flag: `kind`, `presence`, `defaultValue`, `aliases`, `envVar`,
`configPath`, `description`, `enumValues`, `elementSchema`, `prompt`,
`deprecated`, `propagate`.

Per arg: `name`, `kind`, `presence`, `variadic`, `stdinMode`,
`defaultValue`, `description`, `envVar`, `enumValues`, `deprecated`.

### What's Omitted

Non-serializable runtime values are always excluded:

- Parse functions (`parseFn`)
- Middleware handlers
- Interactive resolvers
- Action handlers

## What's Next?

- [Shell Completions](/guide/completions) — another schema-driven export
- [Config Files](/guide/config) — validate config with input schemas
