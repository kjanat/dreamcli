# help: schema-driven help text

`formatHelp()` and `formatHelpTopic()` read `CommandSchema`. Width, theme, and ANSI measurement stay here. TTY color decisions stay in `output/`.

## FILES

| File        | Role                                                   |
| ----------- | ------------------------------------------------------ |
| `index.ts`  | `formatHelp()`, usage, args, flags, examples, wrapping |
| `header.ts` | program name, version, OSC 8 links                     |
| `theme.ts`  | `HelpTheme`, built-in theme, `HelpThemeFactory`        |
| `ansi.ts`   | visible width and padding                              |

## CONVENTIONS

- Default width is 80
- Short aliases sort before long-only flags, then alphabetically
- Boolean defaults stay implicit. Other defaults render through `formatDisplayValue()` from `output/`
- Tests assert the formatted string

## ANTI-PATTERNS

- Do not read the TTY or pick colors in this directory
- Do not special-case a caller when the schema already carries the metadata
- Do not change `wrapText()` continuation indent without the narrow-width tests

## NOTES

- `isDefaultHelp` marks help merged from the root default command
- `cli/root-help.ts` renders the root page and calls into this formatter for command bodies
