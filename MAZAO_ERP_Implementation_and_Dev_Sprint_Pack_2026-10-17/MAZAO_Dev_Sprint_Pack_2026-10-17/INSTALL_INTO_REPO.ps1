# Installs the downloaded documentation pack into a local MAZAO checkout only.
# Does not git add/commit/push; does not touch Docker, database or deployment.
param(
  [Parameter(Mandatory = $true)]
  [string]$RepositoryPath
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path $RepositoryPath).Path
if (!(Test-Path (Join-Path $repo '.git'))) { throw "Not a Git worktree root: $repo" }
$source = Split-Path -Parent $MyInvocation.MyCommand.Path
$target = Join-Path $repo 'docs\implementation-sprints-2026-10-17'
if (Test-Path $target) { throw "Destination already exists. Inspect manually rather than overwrite: $target" }
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
Copy-Item -Path $source -Destination $target -Recurse
Write-Host "Documentation copied to $target"
Write-Host 'No source code, database, commits, remotes or deployments were changed.'
& git -C $repo status --short
