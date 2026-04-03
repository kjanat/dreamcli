# Example Hover Prototype

DreamCLI now carries a narrow hover proof at [`/examples/hover-prototype`](/examples/hover-prototype).

- Build path: VitePress `codeTransformers` + `@shikijs/vitepress-twoslash`
- Runtime UI: default Twoslash tooltip layer
- Validation target: a real generated example importing local `dreamcli` source

## Why This Exists

The re-foundation wants IDE-like hover, but only where it earns its keep.
Examples are the highest-value first target because they are already source-backed and easier to keep calm than prose-heavy guide pages.

## What The Prototype Proves

- Twoslash can render a generated example page during the normal docs build.
- The example can import `dreamcli` from the local repo source tree instead of a published package.
- The default hover UI is sufficient for an initial rollout; no custom tooltip runtime is needed yet.

## Current Constraints

- Only the dedicated prototype page uses `ts twoslash` today.
- Normal example pages still render plain source fences so readability does not depend on hover.
- Guide pages, shell transcripts, and partial snippets remain non-interactive.

## Next Step

The follow-up task is `enable-example-hover`: move from this proof page to the real generated example routes without making hover noisy or required for comprehension.
