#!/usr/bin/env bun

/**
 * Thin wrapper for the GitHub project helper.
 *
 * @module
 */

import { ghProject } from './gh-project/main.ts';

if (import.meta.main) {
	void ghProject.run();
}
