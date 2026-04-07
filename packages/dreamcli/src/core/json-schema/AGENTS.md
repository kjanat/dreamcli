# json-schema — Definition metadata + input schema generation

## OVERVIEW

Single large module plus one generated companion file. It emits both DreamCLI definition metadata
and draft-2020-12 input schemas, and it bridges the string-literal schema DSL into JSON Schema
output.

## FILES

| File                             | Purpose                                                            |
| -------------------------------- | ------------------------------------------------------------------ |
| `index.ts`                       | `generateSchema()`, `generateInputSchema()`, serialization helpers |
| `meta-descriptions.generated.ts` | generated descriptions injected into the definition meta-schema    |
| `json-schema.test.ts`            | behavior contract for both outputs                                 |

## WHERE TO LOOK

| Task                             | Location                                                                              | Notes                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Change definition schema shape   | `generateSchema()`                                                                    | CLI tree, flags, args, examples, hidden and prompt filtering |
| Change input validation schema   | `generateInputSchema()`                                                               | JSON Schema 2020-12 for config/editor use cases              |
| Change DSL -> JSON Schema bridge | `parseSchema()`, `nodeToJsonSchema()` in `index.ts`                                   | feeds custom and DSL flag shapes                             |
| Regenerate descriptions          | `meta-descriptions.generated.ts`, `../../../../../scripts/build-meta-descriptions.ts` | script is source of truth                                    |

## CONVENTIONS

- Output must stay JSON-serializable; runtime handlers, middleware, and interactive functions are
  omitted by design
- `includeHidden` and `includePrompts` are the public switches; preserve their semantics across
  both schema generators
- `@internal` JSDoc tags matter: docs and meta-description tooling filter on them
- Build-time schema description data comes from docs data modules, not hand-maintained constants

## ANTI-PATTERNS

- Do not hand-edit `meta-descriptions.generated.ts`
- Do not leak non-serializable runtime values into schema output
- Do not forget the package-level schema artifact: build emits root `dreamcli.schema.json` from
  this surface

## NOTES

- Definition schema URL points at `@kjanat/dreamcli/dreamcli.schema.json` on the CDN
- This module sits on the boundary between public API docs, config validation, and build artifacts
