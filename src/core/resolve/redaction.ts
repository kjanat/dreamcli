/**
 * The one rule every resolution diagnostic applies to the value it reports on.
 *
 * A token typed on the command line is already on the user's screen, so a
 * message quotes it and `details.value` carries it. Every other stage, an
 * explicit `-` included, delivers bytes a user may consider secret, so the
 * message quotes {@link REDACTED} and `details` omits the value. Coercion
 * failures, Standard Schema issues, and filesystem checks all read this.
 *
 * @module dreamcli/core/resolve/redaction
 * @internal
 */

import type { ResolutionProvenance } from '#internals/core/schema/provenance.ts';

/** What a diagnostic prints in place of a value it may not echo. */
const REDACTED = '<redacted>';

/**
 * Whether a diagnostic may quote the value a stage produced.
 *
 * @param source - Where the value came from, or `undefined` when unrecorded.
 * @returns `true` when the value is safe to echo.
 */
function echoesValue(source: ResolutionProvenance | undefined): boolean {
	return source !== undefined && source.stage === 'cli' && !('via' in source);
}

export { echoesValue, REDACTED };
