/**
 * TypeScript declaration for the walkthrough issue YAML data.
 *
 * @module
 */

type Issue = {
	readonly number: number;
	readonly title: string;
	readonly state: 'open' | 'closed';
	readonly author: string;
	readonly labels: readonly string[];
};

declare const contents: readonly Issue[];

export = contents;
