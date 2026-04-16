#!/usr/bin/env pwsh

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$env:PATH = "$root;$env:PATH"

$completionScript = & bun "$root/src/main.ts" completions powershell
if (-not $completionScript) {
	throw 'No completion script was generated.'
}

$completionScript | Out-String | Invoke-Expression

function Get-CompletionTexts {
	param([string]$InputScript)

	$expanded = TabExpansion2 -inputScript $InputScript -cursorColumn $InputScript.Length
	return @($expanded.CompletionMatches | ForEach-Object CompletionText)
}

function Assert-Contains {
	param(
		[string]$Label,
		[string[]]$Actual,
		[string[]]$Expected
	)

	$missing = @($Expected | Where-Object { $_ -notin $Actual })
	if ($missing.Count -gt 0) {
		throw "$Label is missing expected completions: $($missing -join ', ')"
	}
}

function Assert-Excludes {
	param(
		[string]$Label,
		[string[]]$Actual,
		[string[]]$Excluded
	)

	$unexpected = @($Excluded | Where-Object { $_ -in $Actual })
	if ($unexpected.Count -gt 0) {
		throw "$Label included completions that should stay hidden: $($unexpected -join ', ')"
	}
}

$cases = @(
	@{
		Label = 'Command name completion'
		Input = 'pwsh-demo de'
		Expected = @('deploy')
		Excluded = @('debug-dump')
	},
	@{
		Label = 'Command alias completion'
		Input = 'pwsh-demo sh'
		Expected = @('ship')
		Excluded = @()
	},
	@{
		Label = 'Root-surface flag completion'
		Input = 'pwsh-demo --pro'
		Expected = @('--profile')
		Excluded = @('--account')
	},
	@{
		Label = 'Deploy flag value completion'
		Input = 'pwsh-demo deploy --region '
		Expected = @('us', 'eu', 'ap')
		Excluded = @()
	},
	@{
		Label = 'Deploy flag value prefix completion'
		Input = 'pwsh-demo deploy --region e'
		Expected = @('eu')
		Excluded = @('us', 'ap')
	},
	@{
		Label = 'Deploy inline flag value completion'
		Input = 'pwsh-demo deploy --region=e'
		Expected = @('--region=eu')
		Excluded = @('--region=us', '--region=ap')
	},
	@{
		Label = 'Deploy strategy value completion'
		Input = 'pwsh-demo ship --strategy '
		Expected = @('rolling', 'blue-green', 'canary')
		Excluded = @()
	},
	@{
		Label = 'Status view value completion'
		Input = 'pwsh-demo st --view '
		Expected = @('summary', 'full', 'json')
		Excluded = @()
	},
	@{
		Label = 'Root default-command value completion'
		Input = 'pwsh-demo --profile o'
		Expected = @('ops')
		Excluded = @('o', 'open')
	},
	@{
		Label = 'Quoted root default-command value completion'
		Input = 'pwsh-demo --profile q'
		Expected = @("'qa ops'", "'qa''s'")
		Excluded = @('qa ops', "qa's")
	},
	@{
		Label = 'Quoted inline root default-command value completion'
		Input = 'pwsh-demo --profile=q'
		Expected = @("--profile='qa ops'", "--profile='qa''s'")
		Excluded = @('--profile=qa ops', "--profile=qa's")
	},
	@{
		Label = 'Nested subcommand completion'
		Input = 'pwsh-demo config se'
		Expected = @('set')
		Excluded = @()
	},
	@{
		Label = 'Option separator stops flag completion'
		Input = 'pwsh-demo deploy -- --re'
		Expected = @()
		Excluded = @('--region', '--approval', '-r')
	}
)

foreach ($case in $cases) {
	$actual = Get-CompletionTexts -InputScript $case.Input
	Assert-Contains -Label $case.Label -Actual $actual -Expected $case.Expected
	Assert-Excludes -Label $case.Label -Actual $actual -Excluded $case.Excluded

	Write-Host "`n$($case.Label):"
	$actual | Sort-Object | ForEach-Object { Write-Host "  $_" }
}

Write-Host "`nPowerShell completion smoke test passed."
