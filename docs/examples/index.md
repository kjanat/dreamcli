<script setup lang="ts">
import { generatedExamples } from '../.generated/site-data.ts';
</script>

# Examples

DreamCLI's examples pages are rebuilt by `bun run docs:prepare` from the repo's real source examples.

- Source of truth: `examples/*.ts`
- Generated inventory: `docs/.generated/examples/index.md`
- Generated detail routes: `docs/examples/<slug>.md`
- Hover prototype route: `/examples/hover-prototype`

Each example now gets its own searchable page with usage snippets, source, and related API links.
The hover prototype stays separate until the examples-only rollout is proven calm enough to enable broadly.

## Source-Backed Examples

<ul>
	<li v-for="example in generatedExamples" :key="example.slug">
		<strong><a :href="example.routePath">{{ example.title }}</a></strong>
		<span> - {{ example.summary }}</span>
		<span> (`{{ example.sourcePath }}`)</span>
	</li>
</ul>
