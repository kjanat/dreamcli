# errors: CLIError and redaction

`CLIError` carries `code`, `exitCode`, `suggest`, and `details`. `ParseError` and `ValidationError` set category defaults. `ErrorCode` is `ParseErrorCode | ValidationErrorCode | (string & {})`.

## FILES

| File                  | Role                                                         |
| --------------------- | ------------------------------------------------------------ |
| `index.ts`            | `CLIError`, `ParseError`, `ValidationError`, code unions     |
| `diagnostic-value.ts` | `diagnosticValue()`. Sensitive inputs contribute no raw text |
| `json-safe.ts`        | `toJsonSafeRecord()` for JSON error bodies                   |

## ANTI-PATTERNS

- Do not put a resolved secret in `message`, `details`, or `suggest`. Call `diagnosticValue()` with the schema's `sensitive` flag
- Do not invent a parallel error type for parse or resolve failures
- Do not close `ValidationErrorCode` over `PATH_CHECK_SKIPPED`. That code is a `CLIError` thrown before aggregated validation

## NOTES

- Parse codes include `UNKNOWN_FLAG`, `UNKNOWN_COMMAND`, `MISSING_VALUE`, `INVALID_VALUE`, `INVALID_SCHEMA`, `DUPLICATE_FLAG`, `UNEXPECTED_POSITIONAL`
- Validation codes include `REQUIRED_FLAG`, `REQUIRED_ARG`, `MISSING_STDIN`, `INVALID_ENUM`, `TYPE_MISMATCH`, `CONSTRAINT_VIOLATED`
- Custom parser and Standard Schema messages stay verbatim. They are the caller's trust boundary
