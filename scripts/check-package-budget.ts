#!/usr/bin/env bun
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, posix } from 'node:path';
import { gunzipSync } from 'node:zlib';

interface TarEntry {
	readonly path: string;
	readonly size: number;
	readonly body: Buffer;
}

interface Budget {
	readonly tarballBytes: number;
	readonly unpackedBytes: number;
	readonly files: number;
	readonly runtimeJsBytes: number;
	readonly declarationBytes: number;
	readonly hotPathBytes: number;
	readonly hotPathModules: number;
}

const BUDGET: Budget = {
	tarballBytes: 200_000,
	unpackedBytes: 750_000,
	files: 60,
	runtimeJsBytes: 350_000,
	declarationBytes: 400_000,
	hotPathBytes: 300_000,
	hotPathModules: 2,
};

const HOT_PATH_ENTRIES = ['package/dist/index.mjs'];
const HOT_PATH_EXTERNALS = ['ansispeck'];
const FORBIDDEN_PREFIXES = ['package/examples/', 'package/CHANGELOG.md'];

function readOctal(header: Buffer, offset: number, length: number): number {
	const text = header
		.toString('utf8', offset, offset + length)
		.replace(/\0.*$/s, '')
		.trim();
	return text === '' ? 0 : Number.parseInt(text, 8);
}

function readString(header: Buffer, offset: number, length: number): string {
	return header.toString('utf8', offset, offset + length).replace(/\0.*$/s, '');
}

function parseTar(archive: Buffer): TarEntry[] {
	const entries: TarEntry[] = [];
	let cursor = 0;
	let longName: string | undefined;
	while (cursor + 512 <= archive.length) {
		const header = archive.subarray(cursor, cursor + 512);
		if (header.every((byte) => byte === 0)) break;
		const size = readOctal(header, 124, 12);
		const typeflag = readString(header, 156, 1);
		const prefix = readString(header, 345, 155);
		const name = readString(header, 0, 100);
		const path = longName ?? (prefix === '' ? name : `${prefix}/${name}`);
		longName = undefined;
		const bodyStart = cursor + 512;
		const body = archive.subarray(bodyStart, bodyStart + size);
		if (typeflag === 'L') {
			longName = body.toString('utf8').replace(/\0.*$/s, '');
		} else if (typeflag === '' || typeflag === '0') {
			entries.push({ path, size, body });
		}
		cursor = bodyStart + Math.ceil(size / 512) * 512;
	}
	return entries;
}

function packTarball(): { readonly path: string; readonly cleanup: () => void } {
	const destination = mkdtempSync(join(tmpdir(), 'dreamcli-pack-'));
	const result = Bun.spawnSync(
		['bun', 'pm', 'pack', '--quiet', '--ignore-scripts', '--destination', destination],
		{ stdout: 'pipe', stderr: 'inherit' },
	);
	if (result.exitCode !== 0) {
		rmSync(destination, { recursive: true, force: true });
		throw new Error(`bun pm pack exited with ${result.exitCode}`);
	}
	const filename = result.stdout.toString().trim();
	return {
		path: isAbsolute(filename) ? filename : join(destination, filename),
		cleanup: () => rmSync(destination, { recursive: true, force: true }),
	};
}

function sumBytes(entries: readonly TarEntry[]): number {
	return entries.reduce((total, entry) => total + entry.size, 0);
}

function countJsDocComments(entries: readonly TarEntry[]): number {
	let count = 0;
	for (const entry of entries) {
		const text = entry.body.toString('utf8');
		count += text.split('/**').length - 1;
	}
	return count;
}

interface StaticImports {
	readonly local: readonly string[];
	readonly external: readonly string[];
}

function staticImports(transpiler: Bun.Transpiler, from: string, code: Buffer): StaticImports {
	const local: string[] = [];
	const external: string[] = [];
	for (const item of transpiler.scanImports(code)) {
		if (item.kind !== 'import-statement') continue;
		if (item.path.startsWith('.')) {
			local.push(posix.normalize(posix.join(dirname(from), item.path)));
		} else if (!item.path.startsWith('node:')) {
			external.push(item.path);
		}
	}
	return { local, external };
}

interface HotPath {
	readonly modules: readonly TarEntry[];
	readonly externals: readonly string[];
}

function hotPath(entries: readonly TarEntry[], roots: readonly string[]): HotPath {
	const byPath = new Map(entries.map((entry) => [entry.path, entry]));
	const transpiler = new Bun.Transpiler({ loader: 'js' });
	const seen = new Set<string>();
	const externals = new Set<string>();
	const queue = [...roots];
	const modules: TarEntry[] = [];
	while (queue.length > 0) {
		const path = queue.shift();
		if (path === undefined || seen.has(path)) continue;
		seen.add(path);
		const entry = byPath.get(path);
		if (entry === undefined) throw new Error(`hot path root or import is missing: ${path}`);
		modules.push(entry);
		const imports = staticImports(transpiler, path, entry.body);
		queue.push(...imports.local);
		for (const external of imports.external) externals.add(external);
	}
	return { modules, externals: [...externals].sort() };
}

function kb(bytes: number): string {
	return `${(bytes / 1000).toFixed(1)} kB`;
}

function main(): number {
	const args = process.argv.slice(2);
	const tarballFlag = args.indexOf('--tarball');
	const explicit = tarballFlag === -1 ? undefined : args[tarballFlag + 1];
	const packed = explicit === undefined ? packTarball() : undefined;
	const tarballPath = explicit ?? packed?.path;
	if (tarballPath === undefined) throw new Error('no tarball to inspect');
	let entries: TarEntry[];
	let tarballBytes: number;
	try {
		const tarball = readFileSync(tarballPath);
		tarballBytes = tarball.byteLength;
		entries = parseTar(gunzipSync(tarball));
	} finally {
		packed?.cleanup();
	}

	const js = entries.filter(
		(entry) => entry.path.startsWith('package/dist/') && entry.path.endsWith('.mjs'),
	);
	const dts = entries.filter(
		(entry) => entry.path.startsWith('package/dist/') && entry.path.endsWith('.d.mts'),
	);
	const forbidden = entries.filter((entry) =>
		FORBIDDEN_PREFIXES.some((prefix) => entry.path.startsWith(prefix)),
	);
	const reached = hotPath(entries, HOT_PATH_ENTRIES);
	const unexpectedExternals = reached.externals.filter(
		(name) => !HOT_PATH_EXTERNALS.includes(name),
	);
	const metrics = {
		tarballBytes,
		files: entries.length,
		unpackedBytes: sumBytes(entries),
		runtimeJsBytes: sumBytes(js),
		runtimeJsModules: js.length,
		declarationBytes: sumBytes(dts),
		declarationModules: dts.length,
		jsDocComments: countJsDocComments(js),
		hotPathBytes: sumBytes(reached.modules),
		hotPathModules: reached.modules.length,
	};

	const rows: readonly (readonly [string, string, string])[] = [
		['tarball', kb(metrics.tarballBytes), `< ${kb(BUDGET.tarballBytes)}`],
		['files', String(metrics.files), `<= ${BUDGET.files}`],
		['unpacked', kb(metrics.unpackedBytes), `< ${kb(BUDGET.unpackedBytes)}`],
		[
			'runtime js',
			`${kb(metrics.runtimeJsBytes)} in ${metrics.runtimeJsModules} modules`,
			`< ${kb(BUDGET.runtimeJsBytes)}`,
		],
		[
			'declarations',
			`${kb(metrics.declarationBytes)} in ${metrics.declarationModules} modules`,
			`< ${kb(BUDGET.declarationBytes)}`,
		],
		['jsdoc in js', String(metrics.jsDocComments), '0'],
		[
			'hot path (dist)',
			`${kb(metrics.hotPathBytes)} in ${metrics.hotPathModules} modules`,
			`< ${kb(BUDGET.hotPathBytes)}, <= ${BUDGET.hotPathModules} modules`,
		],
		['hot path externals', reached.externals.join(', '), HOT_PATH_EXTERNALS.join(', ')],
		['forbidden', String(forbidden.length), '0'],
	];
	const width = Math.max(...rows.map(([label]) => label.length));
	for (const [label, value, limit] of rows) {
		console.log(`${label.padEnd(width)}  ${value}${limit === '' ? '' : `  (budget ${limit})`}`);
	}

	const violations: string[] = [];
	if (metrics.tarballBytes >= BUDGET.tarballBytes) violations.push('tarball size over budget');
	if (metrics.files > BUDGET.files) violations.push('file count over budget');
	if (metrics.unpackedBytes >= BUDGET.unpackedBytes) violations.push('unpacked size over budget');
	if (metrics.runtimeJsBytes >= BUDGET.runtimeJsBytes) violations.push('runtime js over budget');
	if (metrics.declarationBytes >= BUDGET.declarationBytes) {
		violations.push('declarations over budget');
	}
	if (metrics.jsDocComments > 0) violations.push('runtime js carries jsdoc comments');
	if (metrics.hotPathBytes >= BUDGET.hotPathBytes) violations.push('hot path bytes over budget');
	if (metrics.hotPathModules > BUDGET.hotPathModules) {
		violations.push('hot path module count over budget');
	}
	for (const name of unexpectedExternals) {
		violations.push(`hot path imports an undeclared runtime dependency: ${name}`);
	}
	for (const entry of forbidden) violations.push(`forbidden file published: ${entry.path}`);

	for (const violation of violations) console.error(`budget: ${violation}`);
	return violations.length === 0 ? 0 : 1;
}

process.exitCode = main();
