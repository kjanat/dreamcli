# pwsh-demo

PowerShell completion playground for `@kjanat/dreamcli`.

This example is intentionally shaped to exercise a broad slice of the completion surface:

- Native PowerShell registration via `Register-ArgumentCompleter`
- Root-surface completion from a default command
- Top-level command aliases like `ship` and `st`
- Nested subcommands under `config`
- Enum flag value completion like `--region`, `--strategy`, `--view`, and `--profile`
- Hidden command and hidden flag-alias omission from completions

## Try It

From this directory:

```powershell
$env:PATH = "$(Get-Location);$env:PATH"
bun src/main.ts completions powershell | Out-String | Invoke-Expression
```

Then try these interactively:

```powershell
pwsh-demo de<Tab>
pwsh-demo ship --str<Tab>
pwsh-demo deploy --region <Tab>
pwsh-demo st --view <Tab>
pwsh-demo --pro<Tab>
pwsh-demo config se<Tab>
```

Or run the automated smoke check:

```powershell
bun run smoke:powershell
```
