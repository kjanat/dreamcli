/**
 * Runs before each test file's imports. ansispeck treats any non-empty
 * FORCE_COLOR/FORCE_HYPERLINKS value, including '0', as force-on and checks
 * them before NO_COLOR, so inherited values must be deleted, not overwritten.
 */

delete process.env.FORCE_COLOR;
delete process.env.FORCE_HYPERLINKS;
