<script setup lang="ts">
import {
	docsHealthSnapshot,
	generatedPublicApi,
	generatedReferenceSurfaces,
} from '../.generated/site-data.ts';
</script>

# Generated Surfaces

This page is the stable hand-authored entrypoint for source-backed reference artifacts prepared by `bun run docs:prepare`.

- Generated root: `docs/.generated/`
- Public API entrypoints discovered: `{{ generatedPublicApi.length }}`
- Public API symbols indexed: `{{ docsHealthSnapshot.publicSymbolCount }}`
- Symbol pages rendered: `{{ docsHealthSnapshot.symbolPageCount }}`
- Public generated pages: [`/reference/changelog`](/reference/changelog), [`/reference/docs-health`](/reference/docs-health)

## Prepared Artifacts

<ul>
	<li v-for="surface in generatedReferenceSurfaces" :key="surface.id">
		<strong>{{ surface.title }}</strong>
		<span> - {{ surface.artifactPath }}</span>
		<span>. {{ surface.notes }}</span>
	</li>
</ul>

## Current Snapshot

- Authored markdown pages: `{{ docsHealthSnapshot.authoredPageCount }}`
- Generated artifacts: `{{ docsHealthSnapshot.generatedArtifactCount }}`
- Source-backed examples: `{{ docsHealthSnapshot.exampleCount }}`
- Public API entrypoints: `{{ docsHealthSnapshot.publicEntrypointCount }}`
- Public API symbols: `{{ docsHealthSnapshot.publicSymbolCount }}`
- Symbol reference pages: `{{ docsHealthSnapshot.symbolPageCount }}`
