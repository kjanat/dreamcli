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
