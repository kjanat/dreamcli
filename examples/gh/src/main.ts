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
 *   bun --cwd=examples/gh src/main.ts auth login
 *   bun --cwd=examples/gh src/main.ts auth status
 *   bun --cwd=examples/gh src/main.ts --help
 *
 * @module
 */

import { cli } from 'dreamcli';

import { auth } from '$gh/commands/auth.ts';
import { issue } from '$gh/commands/issue.ts';
import { pr } from '$gh/commands/pr.ts';

// Define the CLI, set the name to 'gh'.
const gh = cli('gh')
	// Set the name, version, and description from package.json.
	//
	// Note! The name defined above is overridden by the name in package.json.
	//
	// If you'd like instead for the cli name to be inferred from the distributed filename,
	// use: `packageJson({inferName: true})`.
	// E.g.: `bin: { "yoyoyo": "dist/b-ass-nigga.js" }`, would infer the name to be `b-ass-nigga.js`,
	// because of the built filename: `b-ass-nigga.js`.
	.packageJson();

// Register commands. The order here determines the order in `--help` output.
void gh.command(auth).command(pr).command(issue).completions().run();
