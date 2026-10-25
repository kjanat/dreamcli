# Upgrading From 4.x To 5.0

DreamCLI 5.0 adds indexed environment families, CLI-wide environment namespaces,
optional kebab-case help, and visibility into skipped filesystem checks. It also
fixes Deno permission handling and nested command help.

The major version reflects changes to public TypeScript contracts. Review these
two migrations when upgrading from 4.x.

## Narrow Environment Provenance Before Reading `envVar`

`ResolutionProvenance` now represents both named environment variables and
indexed families. A named binding still reports `{ stage: 'env', envVar }`.
An indexed binding reports `{ stage: 'env', via: 'indexed', count, envVars }`,
where `count` names the count variable and `envVars` lists the member variables
read. An explicit zero count has an empty `envVars` list.

Checking `stage === 'env'` alone no longer guarantees an `envVar` property:

```ts twoslash
import type { ResolutionProvenance } from '@kjanat/dreamcli';

function environmentVariables(source: ResolutionProvenance): readonly string[] {
	if (source.stage !== 'env') return [];
	if ('envVar' in source) return [source.envVar];
	return [source.count, ...source.envVars];
}
```

Apply this narrowing wherever you inspect handler `sources`,
`ResolveResult.provenance`, or the `readFlags()` `onSources` callback.
See [CLI Semantics](/guide/semantics#which-source-won).

## Include `skippedPathChecks` In Constructed Results

`RunResult` and `ResolveResult` now require `skippedPathChecks`. Results returned
by DreamCLI populate it automatically. If you construct result objects yourself,
including in fixtures and mocks, add `skippedPathChecks: []` when no declared
filesystem check was skipped.

The list records path inputs whose declared checks could not run because a
`stat` or `mkdir` probe was unavailable. The default `pathChecks: 'lenient'`
continues running the command and reports those checks. Set
`pathChecks: 'strict'` to fail with `PATH_CHECK_SKIPPED` instead, or provide the
probes needed to exercise the checks. See
[Testing](/guide/testing#filesystem-checks).

## Adopt The New Features When Needed

- `.env({ count, value })` and `.env({ count, fields })` resolve numbered
  environment families into lists and correlated records.
- `cli('app').envPrefix()` derives a namespace, while `.envPrefix('APP_')`
  supplies one explicitly. `.env()` derives an input's variable name, and
  `.env('HOME', { absolute: true })` bypasses the namespace for that binding.
- `.help({ flagSpelling: 'kebab' })` renders camelCase flag names in kebab-case
  while handlers keep their declared keys.
- Deno imports and environment bindings work with missing or scoped
  `--allow-env` grants. A required input whose variable is ungranted explains
  which grant it needs.

See the [changelog](https://github.com/kjanat/dreamcli/blob/master/CHANGELOG.md)
for the complete release notes.
