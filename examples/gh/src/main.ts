#!/usr/bin/env bun
/**
 * Walkthrough example package entrypoint for a miniature `gh` clone.
 *
 * Usage:
 *   GH_TOKEN=ghp_abc123 bun --cwd=examples/gh src/main.ts pr list
 *   GH_TOKEN=ghp_abc123 bun --cwd=examples/gh src/main.ts pr list --state all --json
 *   GH_TOKEN=ghp_abc123 bun --cwd=examples/gh src/main.ts pr view 142
 *   GH_TOKEN=ghp_abc123 bun --cwd=examples/gh src/main.ts pr create
 *   GH_TOKEN=ghp_abc123 bun --cwd=examples/gh src/main.ts issue list --label bug
 *   GH_TOKEN=ghp_abc123 bun --cwd=examples/gh src/main.ts issue triage 89
 *   bun --cwd=examples/gh src/main.ts auth login
 *   bun --cwd=examples/gh src/main.ts auth status
 *   bun --cwd=examples/gh src/main.ts --help
 *
 * @module
 */

// oxlint-disable-next-line no-unused-vars -- for CLIBuilder type in JSDoc
import type { CLIBuilder } from '@kjanat/dreamcli';
import { cli } from '@kjanat/dreamcli';

import { auth } from './commands/auth.ts';
import { issue } from './commands/issue.ts';
import { pr } from './commands/pr.ts';

/**
 * Create the example CLI and register commands.
 *
 * {@linkcode CLIBuilder.packageJson | packageJson()} fills `version` and `description` from the nearest `package.json`.\
 * The CLI name still comes from `cli('gh')` unless `packageJson({ inferName: true })` is used.
 *
 * Command registration order determines the order shown in `--help`.
 */
export const gh = cli('gh').packageJson().command(auth).command(pr).command(issue).completions();

// Run the CLI if this file is executed directly (e.g. `bun src/main.ts ...`).
if (import.meta.main) {
	gh.run();
}
