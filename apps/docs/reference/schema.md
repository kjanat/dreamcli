# Schema

`@kjanat/dreamcli/schema` is the package's published JSON Schema export.
It resolves to `dreamcli.schema.json`, the same definition schema referenced by
`generateSchema()` output.

Use it when you want local or offline validation of dreamcli definition metadata without depending
on the CDN `$schema` URL.

## Importing The Schema

```ts twoslash
import schema from '@kjanat/dreamcli/schema';

schema.$schema;
schema.$defs.command;
```

In TypeScript, this works with `resolveJsonModule`.
At runtime, your loader needs to support JSON imports for the target environment.

## Common Uses

- Validate the output of `generateSchema(myCli.schema)` in tests or tooling.
- Ship an offline `$schema` target in repos that do not want network lookups.
- Feed the schema into JSON Schema tooling such as Ajv or IDE integrations.

## Pairing With `generateSchema()`

```ts twoslash
import schema from '@kjanat/dreamcli/schema';
import {
  cli,
  command,
  generateSchema,
} from '@kjanat/dreamcli';

const app = cli('mycli').command(command('deploy'));
const definition = generateSchema(app.schema);

definition.$schema;
schema.$id;
```

`definition.$schema` points at the public schema URL, while the package export gives you the same
definition locally from the installed package.

## Related Pages

- [Schema Export](/guide/schema-export)
- [@kjanat/dreamcli](/reference/main)
