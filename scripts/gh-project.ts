#!/usr/bin/env bun
/**
 * Thin wrapper for the GitHub project helper.
 *
 * @module
 */

import { run } from './gh-project/main.ts';

if (import.meta.main) {
	void run();
}
