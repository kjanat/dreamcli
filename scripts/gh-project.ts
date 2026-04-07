#!/usr/bin/env bun

/**
 * Thin wrapper for the GitHub project helper.
 *
 * @module
 */

import { ghProject } from '@kjanat/gh-project';

if (import.meta.main) {
	void ghProject.run();
}
