/**
 * Typed YAML-backed mock data for the walkthrough `gh` example.
 *
 * @module
 */
import rawIssues from '$gh/data/issues.yaml' with { type: 'yaml' };
import rawPullRequests from '$gh/data/pull-requests.yaml' with { type: 'yaml' };

import type { Issue, PR } from '$gh/data/types.ts';

export const pullRequests: readonly PR[] = rawPullRequests;
export const issues: readonly Issue[] = rawIssues;
