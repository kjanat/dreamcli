#!/usr/bin/env pwsh

<#
	.SYNOPSIS
	Runs an end-to-end smoke test for DreamCLI PowerShell completions.

	.DESCRIPTION
	Generates the `pwsh-demo` PowerShell completion script, registers it in the
	current session, executes a set of completion scenarios with `TabExpansion2`,
	and fails if expected completion values are missing or hidden values leak into
	the result set.
#>

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$env:PATH = "$root;$env:PATH"

$completionScript = & bun "$root/src/main.ts" completions powershell | Out-String
$completionExitCode = $LASTEXITCODE
if ($completionExitCode -ne 0) {
	throw "Direct Bun completion generation failed with exit code $completionExitCode."
}
$completionScript = $completionScript.TrimEnd()
if ([string]::IsNullOrWhiteSpace($completionScript)) {
	throw 'No completion script was generated.'
}

$nativeCompletionScript = & pwsh-demo completions powershell | Out-String
$nativeCompletionExitCode = $LASTEXITCODE
if ($nativeCompletionExitCode -ne 0) {
	throw "Native pwsh-demo completion generation failed with exit code $nativeCompletionExitCode."
}
$nativeCompletionScript = $nativeCompletionScript.TrimEnd()
if ([string]::IsNullOrWhiteSpace($nativeCompletionScript)) {
	throw 'The native pwsh-demo launcher did not generate a completion script.'
}

if ($nativeCompletionScript -ne $completionScript) {
	throw 'The native pwsh-demo launcher generated a different completion script than the direct Bun invocation.'
}

$nativeCompletionScript | Out-String | Invoke-Expression

<#
	.SYNOPSIS
	Returns completion texts for a PowerShell input string.

	.DESCRIPTION
	Invokes `TabExpansion2` for the provided input and returns only the
	`CompletionText` values so smoke assertions can compare the visible completion
	surface.

	.PARAMETER InputScript
	The exact PowerShell command line to expand.

	.OUTPUTS
	System.String[]
#>
function Get-CompletionTexts {
	param([string]$InputScript)

	$expanded = TabExpansion2 -inputScript $InputScript -cursorColumn $InputScript.Length
	return @($expanded.CompletionMatches | ForEach-Object CompletionText)
}

<#
	.SYNOPSIS
	Fails when expected completion values are missing.

	.DESCRIPTION
	Compares the expected completion values to the actual completion results and
	throws when any expected value is absent.

	.PARAMETER Label
	The scenario label used in the failure message.

	.PARAMETER Actual
	The completion texts returned by the expansion.

	.PARAMETER Expected
	The completion texts that must be present.
#>
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

<#
	.SYNOPSIS
	Fails when excluded completion values appear in the results.

	.DESCRIPTION
	Compares the actual completion results to a list of values that must remain
	hidden and throws when any excluded value is present.

	.PARAMETER Label
	The scenario label used in the failure message.

	.PARAMETER Actual
	The completion texts returned by the expansion.

	.PARAMETER Excluded
	The completion texts that must not appear.
#>
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
		Label    = 'Command name completion'
		Input    = 'pwsh-demo de'
		Expected = @('deploy')
		Excluded = @('debug-dump')
	},
	@{
		Label    = 'Command alias completion'
		Input    = 'pwsh-demo sh'
		Expected = @('ship')
		Excluded = @()
	},
	@{
		Label    = 'Root-surface flag completion'
		Input    = 'pwsh-demo --pro'
		Expected = @('--profile')
		Excluded = @('--account')
	},
	@{
		Label    = 'Deploy flag value completion'
		Input    = 'pwsh-demo deploy --region '
		Expected = @('us', 'eu', 'ap')
		Excluded = @()
	},
	@{
		Label    = 'Deploy flag value prefix completion'
		Input    = 'pwsh-demo deploy --region e'
		Expected = @('eu')
		Excluded = @('us', 'ap')
	},
	@{
		Label    = 'Deploy inline flag value completion'
		Input    = 'pwsh-demo deploy --region=e'
		Expected = @('--region=eu')
		Excluded = @('--region=us', '--region=ap')
	},
	@{
		Label    = 'Deploy strategy value completion'
		Input    = 'pwsh-demo ship --strategy '
		Expected = @('rolling', 'blue-green', 'canary')
		Excluded = @()
	},
	@{
		Label    = 'Status view value completion'
		Input    = 'pwsh-demo st --view '
		Expected = @('summary', 'full', 'json')
		Excluded = @()
	},
	@{
		Label    = 'Root default-command value completion'
		Input    = 'pwsh-demo --profile o'
		Expected = @('ops')
		Excluded = @('o', 'open')
	},
	@{
		Label    = 'Quoted root default-command value completion'
		Input    = 'pwsh-demo --profile q'
		Expected = @("'qa ops'", "'qa''s'")
		Excluded = @('qa ops', "qa's")
	},
	@{
		Label    = 'Quoted inline root default-command value completion'
		Input    = 'pwsh-demo --profile=q'
		Expected = @("--profile='qa ops'", "--profile='qa''s'")
		Excluded = @('--profile=qa ops', "--profile=qa's")
	},
	@{
		Label    = 'Nested subcommand completion'
		Input    = 'pwsh-demo config se'
		Expected = @('set')
		Excluded = @()
	},
	@{
		Label    = 'Option separator stops flag completion'
		Input    = 'pwsh-demo deploy -- --re'
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
