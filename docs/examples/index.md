<script setup lang="ts">
  import { data as examples } from './examples.data.ts';
</script>

# Examples

DreamCLI's examples pages are generated at build time from the repo's real source examples via dynamic routes.

- Source of truth: `examples/*.ts`
- Route loader: `docs/examples/[slug].paths.ts`
- Data loader: `docs/examples/examples.data.ts`
- Generated example source blocks use `ts twoslash` against local `dreamcli` source

Each example gets its own searchable page with usage snippets, hover-enabled source, and related API links.
Hover stays scoped to the generated example source blocks; guide pages and shell transcripts remain plain docs.

## Source-Backed Examples

<ul>
	<li v-for="example in examples" :key="example.slug">
		<strong><a :href="example.routePath">{{ example.title }}</a></strong>
		<span> - {{ example.demonstrates ?? example.summary }}</span>
		<span> (<code>{{ example.sourcePath }}</code>)</span>
	</li>
</ul>
