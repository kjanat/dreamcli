# Errors

dreamcli provides structured errors with codes, suggestions, and JSON serialization.

## CLIError

```ts twoslash
import { CLIError } from '@kjanat/dreamcli';

const target = 'production';
const region = 'us';

throw new CLIError('Deployment failed', {
  code: 'DEPLOY_FAILED',
  exitCode: 1,
  suggest: 'Check your credentials with `mycli login`',
  details: { target, region },
});
```

### Fields

| Field      | Type                 | Description                                |
| ---------- | -------------------- | ------------------------------------------ |
| `message`  | `string`             | Human-readable error message               |
| `code`     | `string`             | Stable machine identifier                  |
| `exitCode` | `number`             | Process exit code (default varies by type) |
| `suggest`  | `string`             | Actionable hint for the user               |
| `details`  | `unknown`            | Structured payload for JSON output         |
| `cause`    | `Error \| undefined` | Underlying cause (optional)                |

## Error Types

```ts twoslash
import {
  CLIError,
  ParseError,
  ValidationError,
} from '@kjanat/dreamcli';
```

- **`CLIError`** — base error for application-level failures
- **`ParseError`** — argv parsing failures (unknown flags, bad syntax)
- **`ValidationError`** — value validation failures (wrong type, missing required)

Parse and validation errors include "did you mean?" suggestions automatically.

## Type Guards

```ts twoslash
import {
  cli,
  isCLIError,
  isParseError,
  isValidationError,
} from '@kjanat/dreamcli';

const myCli = cli('mycli');

try {
  await myCli.run();
} catch (err) {
  if (isParseError(err)) {
    // handle parse error
  } else if (isValidationError(err)) {
    // handle validation error
  } else if (isCLIError(err)) {
    // handle generic CLI error
  }
}
```

## JSON Mode

In `--json` mode, errors serialize to structured JSON:

```json
{
  "error": {
    "message": "Deployment failed",
    "code": "DEPLOY_FAILED",
    "suggest": "Check your credentials with `mycli login`",
    "details": { "target": "production", "region": "us" }
  }
}
```

## What's Next?

- [Middleware](/guide/middleware) — error handling in middleware chains
- [Output](/guide/output) — output channel behavior
