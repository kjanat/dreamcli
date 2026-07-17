#!/usr/bin/env bun
import { writeImportMap } from 'importmapify';
import pkg from '#package.json';

const n = 'ansispeck';
const version = pkg['dependencies'][n].replace(/^(?:npm:)?ansispeck@/, '');
const ansispeck = `jsr:@kjanat/${n}@${version}`;

const out = writeImportMap({
	root: import.meta.dirname,
	out: 'import_map.json',
	additionalImports: {
		ansispeck,
		'#dreamcli/schema': './src/schema.ts',
	},
	scopes: {
		'./tests/': {
			'dreamcli/testkit': 'jsr:@kjanat/dreamcli@^3/testkit',
		},
	},
});

console.log('Wrote import map to', out);
