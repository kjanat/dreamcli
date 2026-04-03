<script setup lang="ts">
import { generatedExamples } from '../.generated/site-data.ts';
</script>

# Examples

DreamCLI's examples pages are rebuilt by `bun run docs:prepare` from the repo's real source examples.

- Source of truth: `examples/*.ts`
- Generated inventory: `docs/.generated/examples/index.md`
- Generated detail routes: `docs/examples/<slug>.md`

Each example now gets its own searchable page with usage snippets, source, and related API links.

## Source-Backed Examples

<ul>
	<li v-for="example in generatedExamples" :key="example.slug">
		<strong><a :href="example.routePath">{{ example.title }}</a></strong>
		<span> - {{ example.summary }}</span>
		<span> (`{{ example.sourcePath }}`)</span>
	</li>
</ul>
