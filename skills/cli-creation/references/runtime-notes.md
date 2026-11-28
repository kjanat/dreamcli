# Runtime Notes

## Bun-first commands

- Run CLI entrypoint: `bun mycli.ts --help`
- Run tests: `bun test mycli.test.ts` for `bun:test`, or `bunx vitest run mycli.test.ts` for Vitest.

Use the generated paths printed by `dreamcli create` when `--out` points to another directory.
The scaffolder auto-detects test style:

- Bun project + no detected Vitest usage: generate `bun:test` template.
- Otherwise: generate Vitest template.
- Package manager detection checks lockfiles (including `pnpm-*.yaml/.yml`) and manifest `packageManager` entries in `package.json`, `package.json5`, and `package.yaml/.yml`.

## npm/Node alternative

- Run CLI entrypoint in an ESM package (`"type": "module"`): `node mycli.ts --help`
- Run tests: `npx vitest run mycli.test.ts`

## Deno alternative

- Run CLI entrypoint: `deno run -A mycli.ts --help`
- Run tests: use Bun/Node test tooling unless the project already has Deno test wiring.

## Prompt behavior

DreamCLI skips prompts in non-interactive contexts (CI/piped input). When tests depend on prompts, inject answers with `runCommand(..., { answers: [...] })`.
