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
      text: GitHub
      link: https://github.com/kjanat/dreamcli

features:
  - icon: "🔒"
    title: Full Type Inference
    details: Flag and argument types flow from schema to handler. No manual interfaces, no generic gymnastics.
  - icon: "⛓️"
    title: Resolution Chain
    details: "CLI → env → config → prompt → default. Every step opt-in. Every step preserves types."
  - icon: "🧪"
    title: Built-in Test Harness
    details: Run commands in-process with full control. No subprocesses, no process.argv mutation.
  - icon: "🔌"
    title: Typed Middleware
    details: Context accumulates through the middleware chain via type intersection. No manual interface merging.
  - icon: "📦"
    title: Zero Dependencies
    details: Lean core with no runtime dependencies. Dual ESM/CJS. Runs on Node, Bun, and Deno.
  - icon: "🖥️"
    title: Structured Output
    details: "Spinners, progress bars, tables, JSON mode. Adapts automatically: TTY → pretty, piped → stable."
---

<style>
:root {
  --vp-home-hero-name-color: #2b2b2b;
  --vp-home-hero-name-background: none;
  --vp-c-brand-1: #D6A24A;
  --vp-c-brand-2: #c4922e;
  --vp-c-brand-3: #b0841e;
  --vp-c-brand-soft: rgba(214, 162, 74, 0.14);
}

.dark {
  --vp-home-hero-name-color: #e8e8e8;
}
</style>
