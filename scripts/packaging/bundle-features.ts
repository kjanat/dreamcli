// Static edges let bundlers remove an unused feature even when splitting on import().
import { completeRequest } from '../../src/core/completion/dynamic.ts';
import { generateCompletion } from '../../src/core/completion/index.ts';
import { discoverConfig } from '../../src/core/config/index.ts';
import * as manifest from '../../src/core/config/package-json.ts';
import { generateCommandSchema, generateSchema } from '../../src/core/json-schema/index.ts';
import { createPromptSession } from '../../src/core/prompt/session.ts';
import { createTerminalPrompter } from '../../src/core/prompt/terminal.ts';
import { createTestPrompter } from '../../src/core/prompt/test-prompter.ts';

export const loadCompletion = async () => generateCompletion;
export const loadDynamicCompletion = async () => completeRequest;
export const loadConfig = async () => discoverConfig;
export const loadManifest = async () => manifest;
export const loadJsonSchema = async () => ({ generateSchema, generateCommandSchema });
export const loadPromptSession = async () => createPromptSession;
export const loadTerminal = async () => createTerminalPrompter;
export const loadTestPrompter = async () => createTestPrompter;
