/**
 * GitHub Project helper entrypoint for the DreamCLI re-foundation workflow.
 *
 * @module
 */

import { ghProject } from '#gh-project';

if (import.meta.main) {
	void ghProject.run();
}
