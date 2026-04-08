---
layout: home

hero:
  name: dreamcli
  text: Schema-first CLI framework
  tagline: Fully typed TypeScript CLIs with zero runtime dependencies. Define once, infer everywhere.
  image:
    light: /logo-light.svg
    dark: /logo-dark.svg
    alt: dreamcli
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: Why dreamcli?
      link: /guide/why
    - theme: alt
      text: CLI Concepts
      link: /concepts/anatomy
    - theme: alt
      text: GitHub
      link: https://github.com/kjanat/dreamcli

features:
  - icon:
      light: /icons/type-inference-light.svg
      dark: /icons/type-inference-dark.svg
      height: 48
    title: Full Type Inference
    details: Flag and argument types flow from schema to handler. No manual interfaces, no generic gymnastics.
  - icon:
      light: /icons/resolution-chain-light.svg
      dark: /icons/resolution-chain-dark.svg
      height: 48
    title: Resolution Chain
    details: <code>CLI → env → config → prompt → default</code><br> Every step opt-in. Every step preserves types.
  - icon:
      light: /icons/test-harness-light.svg
      dark: /icons/test-harness-dark.svg
      height: 48
    title: Built-in Test Harness
    details: Run commands in-process with full control.<br> No subprocesses, no <code>process.argv</code> mutation.
  - icon:
      light: /icons/middleware-light.svg
      dark: /icons/middleware-dark.svg
      height: 48
    title: Typed Middleware
    details: Context accumulates through the middleware chain via type intersection.<br> No manual interface merging.
  - icon:
      light: /icons/zero-deps-light.svg
      dark: /icons/zero-deps-dark.svg
      height: 48
    title: Zero Dependencies
    details: Lean core with no runtime dependencies.<br> ESM-only. Runs on Node, Bun, and Deno.
  - icon:
      light: /icons/structured-output-light.svg
      dark: /icons/structured-output-dark.svg
      height: 48
    title: Structured Output
    details: 'Spinners, progress bars, tables, JSON mode. Adapts automatically:<br><code>TTY → pretty, piped → stable</code>'
---

<style>
	:root {
		--vp-c-brand-1: #d6a24a;
		--vp-c-brand-2: #c4922e;
		--vp-c-brand-3: #b0841e;
		--vp-c-brand-light: #f0d08c;
		--vp-c-brand-soft: rgba(214, 162, 74, 0.14);
		--vp-home-hero-name-color: transparent;
		--vp-home-hero-name-background: linear-gradient(135deg, var(--vp-c-brand-3) 30%, var(--vp-c-brand-1));
	}

	.dark {
		--vp-home-hero-name-color: transparent;
		--vp-home-hero-name-background: linear-gradient(135deg, var(--vp-c-brand-1) 30%, var(--vp-c-brand-light));
	}
</style>
