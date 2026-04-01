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

const gh = cli('gh')
	// Reads name, version, and description from package.json.
	.packageJson();

// Command order here determines `--help` output order.
void gh.command(auth).command(pr).command(issue).completions().run();
