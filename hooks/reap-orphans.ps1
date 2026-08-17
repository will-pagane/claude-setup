# reap-orphans.ps1 — kills orphaned dev-tool process trees left behind on Windows.
#
# Why this exists: Claude Code's Bash tool spawns Git Bash -> npm -> cmd.exe -> vitest -> N workers.
# Windows has no POSIX process-group kill, so when the tool call is cancelled or the session dies,
# only the immediate shell is killed. Everything below it is re-parented and runs forever.
# A vitest run survived 5 days that way, respawning its jsdom worker pool in a loop.
#
# Safety: only kills processes that (a) match a known dev-tool command line, (b) have a DEAD parent,
# and (c) are older than -MinAgeMinutes. Anything with a live parent is someone's active work.
#
# NOTE on the protect list: it matches process IDENTITY (install paths / executables), never a bare
# path substring. Project checkouts here live under ...\OneDrive\...\Projects\ and worktrees under
# <repo>\.claude\worktrees\, so protecting on "OneDrive" or "claude" would shield every real target.

param(
    [int]$MinAgeMinutes = 10,
    [switch]$WhatIf
)

# Command-line patterns worth reaping. Deliberately narrow: test runners, linters, type checkers.
$reapable = 'vitest|jest|mocha|playwright|eslint|\btsc\b|npm-cli\.js|\bnyc\b|karma'

# Long-lived services by design — matched by install location or executable, not by project path.
$protected = @(
    '\\\.claude\\statusline\\'                      # Claude Code status line
    'Program Files\\Adobe'
    'Common Files\\Adobe'
    'Program Files\\Docker'
    'Program Files\\Google\\Drive'
    'Microsoft VS Code'
    'vscode-server'
    '\.vscode\\extensions'
    '@anthropic-ai'                                 # Claude Code CLI itself
    'claude-code'
) -join '|'

$procs = Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='bash.exe' OR Name='cmd.exe'" -ErrorAction SilentlyContinue
$alive = @{}
Get-CimInstance Win32_Process | ForEach-Object { $alive[[int]$_.ProcessId] = $true }

$victims = @()
foreach ($p in $procs) {
    $cmd = $p.CommandLine
    if (-not $cmd) { continue }
    if ($cmd -notmatch $reapable) { continue }
    if ($cmd -match $protected) { continue }
    if ($alive.ContainsKey([int]$p.ParentProcessId)) { continue }   # parent alive = active work
    $ageMin = ((Get-Date) - $p.CreationDate).TotalMinutes
    if ($ageMin -lt $MinAgeMinutes) { continue }

    $victims += [pscustomobject]@{
        ProcId = $p.ProcessId
        Age    = [math]::Round($ageMin, 0)
        MB     = [math]::Round($p.WorkingSetSize / 1MB, 0)
        Cmd    = $cmd.Substring(0, [Math]::Min(90, $cmd.Length))
    }
}

if ($victims.Count -eq 0) { exit 0 }

foreach ($v in $victims) {
    if ($WhatIf) {
        Write-Output "[dry-run] mataria PID $($v.ProcId) (idade $($v.Age)min, $($v.MB)MB): $($v.Cmd)"
    } else {
        Write-Output "[reaper] orfao morto: PID $($v.ProcId) idade $($v.Age)min $($v.MB)MB :: $($v.Cmd)"
        taskkill /PID $v.ProcId /T /F 2>&1 | Out-Null
    }
}
