<script setup lang="ts">
import { data } from './generated-surfaces.data.ts';
</script>

# Generated Surfaces

This page is the stable hand-authored entrypoint for source-backed reference artifacts.

- Public API entrypoints discovered: `{{ data.publicApiCount }}`
- Public API symbols indexed: `{{ data.publicSymbolCount }}`
- Symbol pages rendered: `{{ data.symbolPageCount }}`
- Public generated pages: [`/reference/changelog`](/reference/changelog), [`/reference/docs-health`](/reference/docs-health)

## Prepared Artifacts

<ul>
	<li v-for="surface in data.referenceSurfaces" :key="surface.id">
		<strong>{{ surface.title }}</strong>
		<span> - {{ surface.artifactPath }}</span>
		<span>. {{ surface.notes }}</span>
	</li>
</ul>

## Cross-Linked Routes

- [Examples](/examples/) -> generated example detail pages -> symbol pages
- [API Reference](/reference/api) -> subpath pages and symbol pages
- [Example Hover](/reference/example-hover-prototype) -> generated example source blocks
- [Changelog](/reference/changelog) <-> [Docs Health](/reference/docs-health)
- [Semantic Delta Log](/reference/semantic-delta-log) -> support and rationale follow-up pages
