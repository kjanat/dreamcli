<script setup lang="ts">
import { data } from './docs-health.data.ts';
</script>

# Docs Health

This page is rebuilt at build time from the docs tree and source artifacts. It stays factual on purpose: counts and surface coverage, not vanity scoring.

- Source inputs: `docs/**/*.md`, `examples/*.ts`, public entrypoints in `package.json`
- Related pages: [Changelog](/reference/changelog), [Generated Surfaces](/reference/generated-surfaces), [Support Matrix](/reference/support-matrix), [API Reference](/reference/api), [Examples](/examples/)

## Current Snapshot

| Metric                  | Value                             |
| ----------------------- | --------------------------------- |
| Authored markdown pages | {{ data.authoredPageCount }}      |
| Generated artifacts     | {{ data.generatedArtifactCount }} |
| Source-backed examples  | {{ data.exampleCount }}           |
| Public API entrypoints  | {{ data.publicEntrypointCount }}  |
| Public API symbols      | {{ data.publicSymbolCount }}      |
| Symbol reference pages  | {{ data.symbolPageCount }}        |

## Reading This Page

- Authored markdown pages tracks the human-written docs footprint.
- Generated artifacts tracks source-backed docs outputs emitted by the docs pipeline.
- Source-backed examples, public API symbols, and symbol reference pages show how much of the docs surface is derived directly from repo truth.
