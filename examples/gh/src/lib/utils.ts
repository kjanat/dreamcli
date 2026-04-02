/**
 * Shared helpers for the walkthrough `gh` example.
 *
 * @module
 */

export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export function normalizeLimit(value: number): number {
	if (!Number.isFinite(value)) {
		return 10;
	}

	return Math.max(1, Math.floor(value));
}
