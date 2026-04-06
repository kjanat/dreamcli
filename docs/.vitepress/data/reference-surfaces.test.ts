/**
 * @module
 */

import { describe, expect, it } from 'vitest';

import {
	buildReferenceSurfaces,
	type DocsHealthSnapshot,
	renderChangelogArtifact,
	renderChangelogPage,
	renderDocsHealthArtifact,
	renderDocsHealthPage,
} from './reference-surfaces.ts';

describe('reference-surfaces', () => {
	const docsHealth: DocsHealthSnapshot = {
		authoredPageCount: 34,
		generatedArtifactCount: 175,
		exampleCount: 7,
		publicEntrypointCount: 4,
		publicSymbolCount: 159,
		symbolPageCount: 158,
	};

	it('describes generated changelog and docs-health surfaces as public-backed artifacts', () => {
		const surfaces = buildReferenceSurfaces(158);

		expect(surfaces.find((surface) => surface.id === 'generated-changelog')).toMatchObject({
			artifactPath: 'docs/.generated/reference/changelog.md',
			notes: expect.stringContaining('/reference/changelog'),
		});
		expect(surfaces.find((surface) => surface.id === 'generated-docs-health')).toMatchObject({
			artifactPath: 'docs/.generated/reference/docs-health.md',
			notes: expect.stringContaining('/reference/docs-health'),
		});
		expect(surfaces.find((surface) => surface.id === 'generated-api-index')).toMatchObject({
			artifactPath: 'docs/.generated/api/index.md',
			notes: expect.stringContaining('typedoc-output.json'),
		});
	});

	it('renders artifact and public changelog pages from the canonical changelog body', () => {
		const changelog = ['# Changelog', '', '## [Unreleased]', '', '## [1.0.0] - 2026-04-02'].join(
			'\n',
		);

		const artifact = renderChangelogArtifact(changelog);
		expect(artifact).toContain('# Generated Changelog Mirror');
		expect(artifact).toContain('# Changelog');

		const page = renderChangelogPage(changelog);
		expect(page).toContain('# Changelog');
		expect(page).toContain('Source of truth: `CHANGELOG.md`');
		expect(page).toContain('[Examples](/examples/)');
		expect(page).toContain('## [Unreleased]');
		expect(page).not.toContain('# Changelog\n\n# Changelog');
	});

	it('renders factual docs-health artifact and public page content', () => {
		const artifact = renderDocsHealthArtifact(docsHealth);
		expect(artifact).toContain('# Generated Docs Health Snapshot');
		expect(artifact).toContain('| Authored markdown pages | 34 |');

		const page = renderDocsHealthPage(docsHealth);
		expect(page).toContain('# Docs Health');
		expect(page).toContain(
			'Generated snapshot artifact: `docs/.generated/reference/docs-health.md`',
		);
		expect(page).toContain('[API Reference](/reference/api)');
		expect(page).toContain('## Current Snapshot');
		expect(page).toContain('| Symbol reference pages | 158 |');
	});
});
