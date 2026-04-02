<script setup lang="ts">
import { generatedExamples } from '../.generated/site-data.ts';
</script>

# Examples

DreamCLI's generated examples foundation is prepared by `bun run docs:prepare`.

- Source of truth: `examples/*.ts`
- Generated inventory: `docs/.generated/examples/index.md`

The full per-example page pipeline is still tracked separately. This page keeps the IA stable now so later example generation can plug into an existing docs surface instead of introducing another structural change.

## Prepared Inventory

<ul>
	<li v-for="example in generatedExamples" :key="example.slug">
		<strong>{{ example.title }}</strong>
		<span> - {{ example.summary }}</span>
		<span> (`{{ example.sourcePath }}`)</span>
	</li>
</ul>
