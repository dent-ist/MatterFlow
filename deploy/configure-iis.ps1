<#
.SYNOPSIS
  Keeps the MatterFlow application pool running so the notification scheduler (a background timer inside the web app) never sleeps.
.DESCRIPTION
  The scheduler that creates the "due soon", "overdue", "unassigned" and "on hold" notifications and deletes old ones is a BackgroundService
  inside the IIS worker process. IIS stops an idle application pool after 20 minutes by default, and then no timer runs. This script sets,
  idempotently, on the application pool: Start mode AlwaysRunning and Idle time-out 0; and on the site: preload enabled. Run it once on the
  web server in an elevated PowerShell after the site exists (docs/runbook.md section 5.5 and 6.1); running it again changes nothing.
.EXAMPLE
  .\configure-iis.ps1 -SiteName MatterFlow -AppPoolName MatterFlow
.NOTES
  Preload only takes effect with the IIS role service "Application Initialization" (Web-AppInit); the script says so when it is missing.
  The Windows-authenticated site cannot be warmed by IIS itself, so the first signed-in request after a server restart (or the pool's AlwaysRunning
  start at boot) is what starts the application when Application Initialization is not available.
#>
param(
  [string]$SiteName = 'MatterFlow',
  [string]$AppPoolName = 'MatterFlow'
)
$ErrorActionPreference = 'Stop'
Import-Module WebAdministration

$pool = "IIS:\AppPools\$AppPoolName"
if (-not (Test-Path $pool)) { throw "Application pool '$AppPoolName' does not exist. Create it first (docs/runbook.md section 5.5)." }
$site = "IIS:\Sites\$SiteName"
if (-not (Test-Path $site)) { throw "Site '$SiteName' does not exist. Create it first (docs/runbook.md section 5.5)." }

Set-ItemProperty $pool -Name startMode -Value 'AlwaysRunning'
Set-ItemProperty $pool -Name processModel.idleTimeout -Value ([TimeSpan]::Zero)
Set-ItemProperty $site -Name applicationDefaults.preloadEnabled -Value $true
Write-Host "Application pool '$AppPoolName': startMode=AlwaysRunning, idleTimeout=0. Site '$SiteName': preloadEnabled=true."

$appInit = Get-WindowsFeature -Name Web-AppInit -ErrorAction SilentlyContinue
if ($appInit -and -not $appInit.Installed) {
  Write-Warning 'The IIS role service "Application Initialization" (Web-AppInit) is not installed: install it (Install-WindowsFeature Web-AppInit) so preload starts the application after a recycle.'
}
