/**
 * TypeScript declaration for the walkthrough pull request YAML data.
 *
 * @module
 */

type PR = {
	readonly number: number;
	readonly title: string;
	readonly state: 'open' | 'closed' | 'merged';
	readonly author: string;
	readonly labels: readonly string[];
	readonly draft: boolean;
};

declare const contents: readonly PR[];

export = contents;
