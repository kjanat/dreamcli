<script setup lang="ts">
import { docsHealthSnapshot, generatedPublicApi, generatedSymbolPages } from '../.generated/site-data.ts';

const symbolRouteById = new Map(
	generatedSymbolPages.map((page) => [`${page.entrypoint}:${page.name}`, page.routePath]),
);

function symbolHref(entrypoint: string, name: string): string {
	return symbolRouteById.get(`${entrypoint}:${name}`) ?? '/reference/api';
}
</script>

# API Reference

This page is rebuilt by `bun run docs:prepare` from the public entrypoints declared in `package.json`.
Use it to see the complete public surface grouped by subpath and export kind, then jump into the
subpath-specific detail pages.

- Public entrypoints: `{{ docsHealthSnapshot.publicEntrypointCount }}`
- Public symbols indexed: `{{ docsHealthSnapshot.publicSymbolCount }}`
- Symbol pages rendered: `{{ docsHealthSnapshot.symbolPageCount }}`
- Generated artifacts: `docs/.generated/api/index.md`, `docs/.generated/api/public-exports.json`, `docs/.generated/api/typedoc.json`, `docs/.generated/api/typedoc-normalized.json`

## Choose an Import

| Import             | Use it for                                                                             | Start here                               |
| ------------------ | -------------------------------------------------------------------------------------- | ---------------------------------------- |
| `dreamcli`         | schema builders, CLI assembly, parsing, resolution, errors, completions, schema export | [`dreamcli`](/reference/main)            |
| `dreamcli/testkit` | command tests, output capture, scripted prompts, test adapters                         | [`dreamcli/testkit`](/reference/testkit) |
| `dreamcli/runtime` | runtime detection, explicit adapters, runtime-only helpers                             | [`dreamcli/runtime`](/reference/runtime) |
| `dreamcli/schema`  | generated CLI definition meta-schema JSON                                              | schema asset only                        |

## Generated Index

<div v-for="entrypoint in generatedPublicApi" :key="entrypoint.entrypoint">
	<h3><code>{{ entrypoint.entrypoint }}</code></h3>
	<p><strong>Source entrypoint:</strong> <code>{{ entrypoint.sourcePath }}</code></p>
	<p v-if="entrypoint.entrypoint === 'dreamcli'">
		<a href="/reference/main">dreamcli detailed page</a>
	</p>
	<p v-else-if="entrypoint.entrypoint === 'dreamcli/testkit'">
		<a href="/reference/testkit">dreamcli/testkit detailed page</a>
	</p>
	<p v-else-if="entrypoint.entrypoint === 'dreamcli/runtime'">
		<a href="/reference/runtime">dreamcli/runtime detailed page</a>
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
- [Planner Contract](/reference/planner-contract) — internal dispatch outcomes and matched-command handoff
- [Resolver Contract](/reference/resolver-contract) — internal precedence, diagnostics, and resolved-value handoff
- [Output Contract](/reference/output-contract) — internal routing, activity mode, and cleanup policy facts
- [Testing Commands](/guide/testing) — higher-level testkit usage patterns
- [Runtime Support](/guide/runtime) — runtime packages and adapter expectations
- [Support Matrix](/reference/support-matrix) — audited support status, evidence, and deferred work

## Detailed Reference

- [`dreamcli`](/reference/main) — main package API
- [`dreamcli/testkit`](/reference/testkit) — testing utilities
- [`dreamcli/runtime`](/reference/runtime) — runtime adapters
