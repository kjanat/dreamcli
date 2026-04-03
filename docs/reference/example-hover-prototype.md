# Example Hover

DreamCLI now ships Twoslash-backed hover on generated example pages.

- Build path: VitePress `codeTransformers` + `@shikijs/vitepress-twoslash`
- Runtime UI: default Twoslash tooltip layer
- Rollout scope: generated example source blocks only

## Why This Scope Exists

The re-foundation wanted IDE-like hover, but only where it earns its keep.
Examples were the right first target because they are already source-backed and easier to keep calm than prose-heavy guide pages.

## What Ships Now

- Every generated example page now renders its source block with `ts twoslash` during the normal docs build.
- Example imports resolve against the local `dreamcli` source tree instead of a published package.
- The default hover UI is sufficient; no custom tooltip runtime is needed.

## Current Constraints

- Hover stays limited to the generated TypeScript source block on each example page.
- Example pages still lead with summary, usage, and links so readability does not depend on hover.
- Guide pages, shell transcripts, and partial snippets remain non-interactive.

## Origin

This page started as the prototype note for `prototype-hover-path`. The follow-up task `enable-example-hover` moved the same Twoslash path onto the real generated example routes.

## Related Pages

- [Examples](/examples/)
- [API Reference](/reference/api)
- [Support Matrix](/reference/support-matrix)
