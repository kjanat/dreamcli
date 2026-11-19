/**
 * Load optional CLI features on first use. Direct runtimes use
 * dynamic imports so unused features stay off the startup path.
 * @module dreamcli/core/feature-loaders
 * @internal
 */
export const loadCompletion = () =>
	import('./completion/index.ts').then(({ generateCompletion }) => generateCompletion);
export const loadDynamicCompletion = () =>
	import('./completion/dynamic.ts').then(({ completeRequest }) => completeRequest);
export const loadConfig = () =>
	import('./config/index.ts').then(({ discoverConfig }) => discoverConfig);
export const loadManifest = () => import('./config/package-json.ts');
export const loadJsonSchema = () =>
	import('./json-schema/index.ts').then(({ generateSchema, generateCommandSchema }) => ({
		generateSchema,
		generateCommandSchema,
	}));
export const loadPromptSession = () =>
	import('./prompt/session.ts').then(({ createPromptSession }) => createPromptSession);
export const loadTerminal = () =>
	import('./prompt/terminal.ts').then(({ createTerminalPrompter }) => createTerminalPrompter);
export const loadTestPrompter = () =>
	import('./prompt/test-prompter.ts').then(({ createTestPrompter }) => createTestPrompter);
