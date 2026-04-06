<script setup lang="ts">
import { data } from './api.data.ts';

const symbolRouteById = new Map(
	data.symbolPages.map((page) => [`${page.entrypoint}:${page.name}`, page.routePath]),
);

const detailPageHrefByEntrypoint: Readonly<Record<string, string>> = {
	'@kjanat/dreamcli': '/reference/main',
	'@kjanat/dreamcli/testkit': '/reference/testkit',
	'@kjanat/dreamcli/runtime': '/reference/runtime',
};

function symbolHref(entrypoint: string, name: string): string {
	return symbolRouteById.get(`${entrypoint}:${name}`) ?? '/reference/api';
}
</script>

# API Reference

This page is rebuilt at docs build time from the public entrypoints declared in `package.json`.
Use it to see the complete public surface grouped by subpath and export kind, then jump into the
subpath-specific detail pages.

The reference surface is source-backed: symbol routes and example links are derived from `src/**`
and `examples/**` during docs build.

- Public entrypoints: `{{ data.publicEntrypointCount }}`
- Public symbols indexed: `{{ data.publicSymbolCount }}`
- Symbol pages rendered: `{{ data.symbolPageCount }}`

## Choose an Import

| Import                     | Use it for                                                                             | Start here                                       |
| -------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `@kjanat/dreamcli`         | schema builders, CLI assembly, parsing, resolution, errors, completions, schema export | [`@kjanat/dreamcli`](/reference/main)            |
| `@kjanat/dreamcli/testkit` | command tests, output capture, scripted prompts, test adapters                         | [`@kjanat/dreamcli/testkit`](/reference/testkit) |
| `@kjanat/dreamcli/runtime` | runtime detection, explicit adapters, runtime-only helpers                             | [`@kjanat/dreamcli/runtime`](/reference/runtime) |
| `@kjanat/dreamcli/schema`  | generated CLI definition meta-schema JSON                                              | schema asset only                                |

## Generated Index

<div v-for="entrypoint in data.publicApi" :key="entrypoint.entrypoint">
	<h3><code>{{ entrypoint.entrypoint }}</code></h3>
	<p><strong>Source entrypoint:</strong> <code>{{ entrypoint.sourcePath }}</code></p>
	<p v-if="detailPageHrefByEntrypoint[entrypoint.entrypoint]">
		<a :href="detailPageHrefByEntrypoint[entrypoint.entrypoint]">
			{{ entrypoint.entrypoint }} detailed page
		</a>
	</p>
	<div v-for="group in entrypoint.kindGroups" :key="`${entrypoint.entrypoint}-${group.kind}`">
		<h4>{{ group.title }} ({{ group.symbols.length }})</h4>
		<table>
			<thead>
				<tr>
					<th>Symbol</th>
					<th>Source</th>
				</tr>
			</thead>
			<tbody>
				<tr v-for="symbol in group.symbols" :key="`${entrypoint.entrypoint}-${symbol.name}`">
					<td><a :href="symbolHref(entrypoint.entrypoint, symbol.name)"><code>{{ symbol.name }}</code></a></td>
					<td><code>{{ symbol.sourcePath }}</code></td>
				</tr>
			</tbody>
		</table>
	</div>
</div>

## Related Guides

- [CLI Semantics](/guide/semantics) — exact parser, resolver, and root-surface behavior
- [Examples](/examples/) — source-backed examples with Twoslash hover and related symbol links
- [Planner Contract](/reference/planner-contract) — internal dispatch outcomes and matched-command handoff
- [Resolver Contract](/reference/resolver-contract) — internal precedence, diagnostics, and resolved-value handoff
- [Output Contract](/reference/output-contract) — internal routing, activity mode, and cleanup policy facts
- [Testing Commands](/guide/testing) — higher-level testkit usage patterns
- [Runtime Support](/guide/runtime) — runtime packages and adapter expectations
- [Changelog](/reference/changelog) — release history mirrored inside the docs site
- [Support Matrix](/reference/support-matrix) — audited support status, evidence, and deferred work

## Detailed Reference

- [`@kjanat/dreamcli`](/reference/main) — main package API
- [`@kjanat/dreamcli/testkit`](/reference/testkit) — testing utilities
- [`@kjanat/dreamcli/runtime`](/reference/runtime) — runtime adapters
