#!/usr/bin/env node
import { appendFileSync, readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { argv, cwd, env, exit } from 'node:process';

type Manifest = {
	name?: string;
	version?: string;
};

const fail = (message: string): never => {
	console.error(message);
	exit(1);
};

const readJson = <T>(path: string): T => {
	try {
		return JSON.parse(readFileSync(path, 'utf8')) as T;
	} catch {
		throw new Error(`failed to read ${path}`);
	}
};

const requireField = (value: string | undefined, file: string, field: 'name' | 'version'): string =>
	value ?? fail(`${file} missing .${field}`);

const validateReleaseTag = (version: string) => {
	if (env.GITHUB_EVENT_NAME !== 'release') return;

	const tag = env.RELEASE_TAG ?? fail('release event missing tag_name');
	const expected = `v${version}`;

	if (tag !== expected) {
		fail(`Release tag '${tag}' does not match package version '${expected}'`);
	}
};

const target = argv[2];
if (target !== 'npm' && target !== 'jsr') {
	fail(`usage: ${relative(cwd(), import.meta.filename)} <npm|jsr>`);
}

const output = env.GITHUB_OUTPUT ?? fail('GITHUB_OUTPUT is not set');

const packageJson = readJson<Manifest>('packages/dreamcli/package.json');

let pkgName: string;
let version: string;
let url: string;

if (target === 'npm') {
	pkgName = requireField(packageJson.name, 'package.json', 'name');
	version = requireField(packageJson.version, 'package.json', 'version');
	url = `https://www.npmjs.com/package/${pkgName}/v/${version}`;
} else {
	const denoJson = readJson<Manifest>('packages/dreamcli/deno.json');

	const denoName = requireField(denoJson.name, 'deno.json', 'name');
	const denoVersion = requireField(denoJson.version, 'deno.json', 'version');
	const packageName = requireField(packageJson.name, 'package.json', 'name');
	const packageVersion = requireField(packageJson.version, 'package.json', 'version');

	if (denoName !== packageName) {
		fail(`Name mismatch: deno.json=${denoName} package.json=${packageName}`);
	}

	if (denoVersion !== packageVersion) {
		fail(`Version mismatch: deno.json=${denoVersion} package.json=${packageVersion}`);
	}

	pkgName = denoName;
	version = denoVersion;
	url = `https://jsr.io/${pkgName}@${version}`;
}

validateReleaseTag(version);

appendFileSync(
	output,
	`meta=${JSON.stringify({
		package: pkgName,
		version,
		url,
	})}\n`,
);
