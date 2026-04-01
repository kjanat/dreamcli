/**
 * Data model types for the walkthrough `gh` example.
 *
 * @module
 */

export type PR = {
	readonly number: number;
	readonly title: string;
	readonly state: 'open' | 'closed' | 'merged';
	readonly author: string;
	readonly labels: readonly string[];
	readonly draft: boolean;
};

export type Issue = {
	readonly number: number;
	readonly title: string;
	readonly state: 'open' | 'closed';
	readonly author: string;
	readonly labels: readonly string[];
};
