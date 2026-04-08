# Schema

`@kjanat/dreamcli/schema` is the package's published definition-schema export.\
It resolves to the same schema referenced by `generateSchema()` output, with a package-target specific mapping:

- npm/package export (`package.json`): `./schema` -> `dreamcli.schema.json`
- Deno/JSR export (`deno.json`): `./schema` -> `src/schema.ts` (which re-exports the same schema)

Use it when you want local or offline validation of dreamcli definition metadata without depending on the CDN `$schema` URL.

## Importing The Schema

```ts twoslash
import schema from '@kjanat/dreamcli/schema';

schema.$schema;
schema.$defs.command;
```

In TypeScript, this works with `resolveJsonModule`.\
Runtime loading behavior depends on the host runtime export target (see notes above).
For Node on the npm/package target, import with `with { type: 'json' }`.

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

`definition.$schema` points at the public schema URL, while the package export gives you the same definition locally from the installed package.

## Related Pages

- [Schema Export](/guide/schema-export)
- [@kjanat/dreamcli](/reference/main)
