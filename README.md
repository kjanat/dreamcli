# dreamcli

Monorepo for [@kjanat/dreamcli](https://www.npmjs.com/package/@kjanat/dreamcli) — a schema-first, fully typed TypeScript CLI framework.

[![NPM](https://img.shields.io/npm/v/@kjanat/dreamcli?logo=npm&labelColor=CB3837&color=black)][npm]
[![JSR](https://img.shields.io/jsr/v/@kjanat/dreamcli?logoColor=083344&logo=jsr&logoSize=auto&label=&labelColor=f7df1e&color=black)][jsr]

## Packages

| Package                                 | Description                                |
| --------------------------------------- | ------------------------------------------ |
| [`@kjanat/dreamcli`](packages/dreamcli) | Core CLI framework                         |
| [`@kjanat/dreamcli-docs`](apps/docs)    | Documentation site ([dreamcli.kjanat.com]) |

## Development

```bash
bun install
bun run ci          # full check suite
bun run dev         # build watch + docs dev server
bun run test        # tests across all workspaces
bun run docs:dev    # docs dev server only
```

## License

[MIT][LICENSE] © 2026 Kaj Kowalski

[LICENSE]: https://github.com/kjanat/dreamcli/blob/master/LICENSE
[npm]: https://npm.im/@kjanat/dreamcli
[jsr]: https://jsr.io/@kjanat/dreamcli
[dreamcli.kjanat.com]: https://dreamcli.kjanat.com
