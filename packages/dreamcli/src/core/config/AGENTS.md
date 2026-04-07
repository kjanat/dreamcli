# config — Config discovery + package.json metadata walk-up

## OVERVIEW

Config loading is adapter-driven and side-effect free from the module's perspective. It covers both
user config discovery and `packageJson()` metadata inference.

## FILES

| File                   | Purpose                                             |
| ---------------------- | --------------------------------------------------- |
| `index.ts`             | config search paths, loaders, parsing, discovery    |
| `package-json.ts`      | nearest `package.json` walk-up + CLI name inference |
| `config.test.ts`       | discovery and load behavior                         |
| `package-json.test.ts` | metadata inference                                  |

## WHERE TO LOOK

| Task                            | Location                                  | Notes                                                 |
| ------------------------------- | ----------------------------------------- | ----------------------------------------------------- |
| Change default config locations | `buildConfigSearchPaths()`                | cwd dotfile, cwd explicit config, platform config dir |
| Change custom format loading    | `FormatLoader`, `buildLoaderMap()`        | JSON built in; later loaders override earlier ones    |
| Change main discovery flow      | `discoverConfig()`                        | first found path wins, parses through adapter         |
| Change CLI metadata inference   | `discoverPackageJson()`, `inferCliName()` | backs `CLIBuilder.packageJson()`                      |

## CONVENTIONS

- All I/O flows through a narrow `RuntimeAdapter` surface; keep it testable with virtual filesystems
- Config roots must be plain objects even if a loader can parse other JSON or YAML values
- JSON is always built in and ordered first in search-path and loader resolution
- `package-json.ts` is a convenience feature: malformed or missing package metadata returns `null`,
  not a hard failure

## ANTI-PATTERNS

- Do not import `node:path` or `process.cwd()` into core config code
- Do not skip plain-object validation at the discovery boundary
- Do not couple config discovery to command schema or resolve precedence logic

## NOTES

- Path joining and parent-walk helpers intentionally work via string logic to stay runtime-neutral
- This directory is the bridge between host filesystem layout and pure resolution logic
