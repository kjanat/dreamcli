import { defineConfig } from 'importmapify';
import pkg from '#package.json' with { type: 'json' };

const n = 'ansispeck';
const version = pkg['dependencies'][n].replace(/^(?:npm:)?ansispeck@/, '');
const ansispeck = `jsr:@kjanat/${n}@${version}`;

export default defineConfig({
	packages: { ansispeck },
	additionalImports: {
		'#dreamcli/schema': './src/schema.ts',
	},
	scopes: {
		'./tests/': {
			'dreamcli/testkit': 'jsr:@kjanat/dreamcli@^3/testkit',
		},
	},
	extensions: ['ts'],
});
