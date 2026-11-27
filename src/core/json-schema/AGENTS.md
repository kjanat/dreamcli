# json-schema: definition metadata and input schemas

Emits the DreamCLI definition document and draft-2020-12 input schemas. The published artifact is root `dreamcli.schema.json`.

## FILES

| File                             | Role                                                                   |
| -------------------------------- | ---------------------------------------------------------------------- |
| `index.ts`                       | `generateSchema()`, `generateCommandSchema()`, `generateInputSchema()` |
| `definition-meta-schema.ts`      | JSON Schema for definition documents                                   |
| `constants.ts`                   | `DEFINITION_SCHEMA_URL`, `DEFINITION_SCHEMA_VERSION`                   |
| `meta-descriptions.generated.ts` | generated descriptions. `bun run meta-descriptions` writes it          |

## ANTI-PATTERNS

- Do not hand-edit `meta-descriptions.generated.ts` or `dreamcli.schema.json`
- Do not put handlers, prompt functions, or other non-JSON values in the output
- Do not static-import this directory from `cli/` or `execution/`. `loadJsonSchema()` is the runtime entry. `scripts/emit-definition-schema.ts` imports it statically

## NOTES

- Canonical URL is `https://dreamcli.kjanat.dev/schemas/definition/v1.schema.json`. The npm `./schema` export and the jsDelivr copy are the same bytes
- `includeHidden` and `includePrompts` apply to both generators
- Descriptions come from `docs/.vitepress/data/`, through `scripts/build-meta-descriptions.ts`
- Consumers import generators from `@kjanat/dreamcli/json-schema`. The root entry re-exports types and `constants.ts`
