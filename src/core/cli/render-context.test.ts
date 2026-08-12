/**
 * Tests for resolveRenderContext — the pre-`run()` probe exposing the same
 * output decisions (`jsonMode`/`isTTY`/`color`/hyperlinks) the framework
 * makes when building the output channel.
 */
import { describe, expect, it } from 'vitest';
import { resolveRenderContext } from './index.ts';

// === JSON mode detection

describe('resolveRenderContext — jsonMode', () => {
	it('detects a pre-separator --json', () => {
		expect(resolveRenderContext(['deploy', '--json']).jsonMode).toBe(true);
	});

	it('ignores a post-separator --json literal', () => {
		expect(resolveRenderContext(['deploy', '--', '--json']).jsonMode).toBe(false);
	});

	it('honors an explicit jsonMode override', () => {
		expect(resolveRenderContext([], { jsonMode: true }).jsonMode).toBe(true);
	});

	it('reads an explicit --json value (#85)', () => {
		expect(resolveRenderContext(['--json=true']).jsonMode).toBe(true);
		expect(resolveRenderContext(['--json=1']).jsonMode).toBe(true);
		expect(resolveRenderContext(['--json=false']).jsonMode).toBe(false);
		expect(resolveRenderContext(['--json=0']).jsonMode).toBe(false);
	});

	it('lets an explicit --json=false win over the jsonMode override', () => {
		expect(resolveRenderContext(['--json=false'], { jsonMode: true }).jsonMode).toBe(false);
	});

	it('ignores a post-separator --json=true literal', () => {
		expect(resolveRenderContext(['deploy', '--', '--json=true']).jsonMode).toBe(false);
	});

	it('takes the last --json occurrence', () => {
		expect(resolveRenderContext(['--json', '--json=false']).jsonMode).toBe(false);
		expect(resolveRenderContext(['--json=false', '--json']).jsonMode).toBe(true);
	});

	it('falls back to the defaults when a value is invalid', () => {
		const ctx = resolveRenderContext(['--json=banana']);
		expect(ctx.jsonMode).toBe(false);
		expect(ctx.verbosity).toBe('normal');
	});
});

// === Verbosity detection

describe('resolveRenderContext — verbosity', () => {
	it('defaults to normal verbosity', () => {
		expect(resolveRenderContext([]).verbosity).toBe('normal');
	});

	it('detects pre-separator --quiet and -q', () => {
		expect(resolveRenderContext(['deploy', '--quiet']).verbosity).toBe('quiet');
		expect(resolveRenderContext(['-q', 'deploy']).verbosity).toBe('quiet');
	});

	it('ignores a post-separator --quiet literal', () => {
		expect(resolveRenderContext(['deploy', '--', '--quiet']).verbosity).toBe('normal');
	});

	it('honors an explicit verbosity override when argv is not quiet', () => {
		expect(resolveRenderContext([], { verbosity: 'quiet' }).verbosity).toBe('quiet');
	});

	it('lets a pre-separator quiet flag override explicit normal verbosity', () => {
		expect(resolveRenderContext(['--quiet'], { verbosity: 'normal' }).verbosity).toBe('quiet');
	});

	it('reads an explicit --quiet value (#85)', () => {
		expect(resolveRenderContext(['--quiet=true']).verbosity).toBe('quiet');
		expect(resolveRenderContext(['--quiet=1']).verbosity).toBe('quiet');
		expect(resolveRenderContext(['--quiet=false']).verbosity).toBe('normal');
		expect(resolveRenderContext(['--quiet=0']).verbosity).toBe('normal');
	});

	it('lets an explicit --quiet=false win over the verbosity override', () => {
		expect(resolveRenderContext(['--quiet=false'], { verbosity: 'quiet' }).verbosity).toBe(
			'normal',
		);
	});

	it('does not read -q=true, which is not a short-flag value form', () => {
		expect(resolveRenderContext(['-q=true']).verbosity).toBe('normal');
	});

	it('ignores a post-separator --quiet=true literal', () => {
		expect(resolveRenderContext(['deploy', '--', '--quiet=true']).verbosity).toBe('normal');
	});

	it('takes the last --quiet occurrence', () => {
		expect(resolveRenderContext(['--quiet', '--quiet=false']).verbosity).toBe('normal');
		expect(resolveRenderContext(['--quiet=false', '-q']).verbosity).toBe('quiet');
	});
});

// === TTY and color gate

describe('resolveRenderContext — color', () => {
	it('defaults isTTY to false and disables color', () => {
		const ctx = resolveRenderContext([]);
		expect(ctx.isTTY).toBe(false);
		expect(ctx.color.isColorSupported).toBe(false);
		expect(ctx.color.red('x')).toBe('x');
	});

	it('JSON mode disables color even on a TTY', () => {
		const ctx = resolveRenderContext(['--json'], { isTTY: true });
		expect(ctx.color.isColorSupported).toBe(false);
	});

	it('explicit color: true wins over the auto-gate', () => {
		const ctx = resolveRenderContext(['--json'], { color: true });
		expect(ctx.color.isColorSupported).toBe(true);
		expect(ctx.color.red('x')).not.toBe('x');
	});
});

// === Hyperlink gate

describe('resolveRenderContext — hyperlinks', () => {
	it('falls back to isTTY', () => {
		expect(resolveRenderContext([]).isHyperlinkSupported).toBe(false);
		expect(resolveRenderContext([], { isTTY: true }).isHyperlinkSupported).toBe(true);
	});

	it('NO_HYPERLINKS forces off on a TTY', () => {
		const ctx = resolveRenderContext([], { isTTY: true, env: { NO_HYPERLINKS: '1' } });
		expect(ctx.isHyperlinkSupported).toBe(false);
	});

	it('FORCE_HYPERLINKS forces on without a TTY', () => {
		const ctx = resolveRenderContext([], { env: { FORCE_HYPERLINKS: '1' } });
		expect(ctx.isHyperlinkSupported).toBe(true);
	});

	it('--no-hyperlinks before the separator forces off', () => {
		const ctx = resolveRenderContext(['--no-hyperlinks'], { isTTY: true });
		expect(ctx.isHyperlinkSupported).toBe(false);
	});

	it('--no-hyperlinks after the separator is a literal', () => {
		const ctx = resolveRenderContext(['--', '--no-hyperlinks'], { isTTY: true });
		expect(ctx.isHyperlinkSupported).toBe(true);
	});
});
