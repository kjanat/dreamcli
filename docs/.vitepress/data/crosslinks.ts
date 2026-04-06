/**
 * Shared docs cross-link helpers.
 *
 * @module
 */

export interface DocsLink {
	label: string;
	href: string;
}

export function collectRelatedGuides(exampleSlug: string): readonly DocsLink[] {
	switch (exampleSlug) {
		case 'basic':
			return [
				{ label: 'Commands guide', href: '/guide/commands' },
				{ label: 'Flags guide', href: '/guide/flags' },
				{ label: 'Arguments guide', href: '/guide/arguments' },
			];
		case 'interactive':
			return [
				{ label: 'Interactive Prompts', href: '/guide/prompts' },
				{ label: 'Config Files', href: '/guide/config' },
				{ label: 'CLI Semantics', href: '/guide/semantics' },
			];
		case 'json-mode':
			return [
				{ label: 'Output', href: '/guide/output' },
				{ label: 'Errors', href: '/guide/errors' },
				{ label: 'CLI Semantics', href: '/guide/semantics' },
			];
		case 'middleware':
			return [
				{ label: 'Middleware', href: '/guide/middleware' },
				{ label: 'Testing', href: '/guide/testing' },
			];
		case 'multi-command':
			return [
				{ label: 'Commands guide', href: '/guide/commands' },
				{ label: 'Shell Completions', href: '/guide/completions' },
				{ label: 'CLI Semantics', href: '/guide/semantics' },
			];
		case 'spinner-progress':
			return [
				{ label: 'Output', href: '/guide/output' },
				{ label: 'Testing', href: '/guide/testing' },
			];
		case 'testing':
			return [
				{ label: 'Testing', href: '/guide/testing' },
				{ label: 'Interactive Prompts', href: '/guide/prompts' },
				{ label: 'Output', href: '/guide/output' },
			];
		default:
			return [];
	}
}
