<#
.SYNOPSIS
  Builds the Angular app and publishes the API with the build inside wwwroot, ready to copy to the IIS site folder.
.EXAMPLE
  deploy\publish.ps1 -Output C:\build\matterflow
.NOTES
  Default runtime identifier is win-x64 (framework-dependent; needs the .NET 10 Hosting Bundle on the server).
  Pass -SkipFrontendInstall to reuse node_modules.
#>
param(
  [string]$Output = (Join-Path (Split-Path -Parent $PSScriptRoot) 'artifacts\publish'),
  [string]$Runtime = 'win-x64',
  [switch]$SkipFrontendInstall
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$Output = [System.IO.Path]::GetFullPath($Output)

function Invoke-Checked([scriptblock]$Command) {
  & $Command
  if ($LASTEXITCODE -ne 0) { throw "Command failed with exit code ${LASTEXITCODE}: $Command" }
}

Write-Host '==> Frontend build'
Push-Location (Join-Path $root 'frontend')
try {
  if (-not $SkipFrontendInstall) { Invoke-Checked { npm ci } }
  Invoke-Checked { npm run build }
} finally { Pop-Location }
$browser = Join-Path $root 'frontend\dist\frontend\browser'
if (-not (Test-Path (Join-Path $browser 'index.html'))) { throw "Angular build produced no index.html in $browser" }

Write-Host "==> dotnet publish ($Runtime) -> $Output"
if (Test-Path $Output) { Remove-Item $Output -Recurse -Force }
$project = Join-Path $root 'backend\src\MatterFlow.Api\MatterFlow.Api.csproj'
Invoke-Checked { dotnet publish $project -c Release -r $Runtime --self-contained false -o $Output -p:OpenApiGenerateDocuments=false }

Write-Host '==> Copy the Angular build into wwwroot'
$wwwroot = Join-Path $Output 'wwwroot'
if (Test-Path $wwwroot) { Remove-Item $wwwroot -Recurse -Force }
New-Item -ItemType Directory -Path $wwwroot | Out-Null
Copy-Item -Path (Join-Path $browser '*') -Destination $wwwroot -Recurse -Force

Write-Host '==> Deployment templates'
Copy-Item (Join-Path $root 'deploy\appsettings.Production.template.json') $Output -Force
if ($Runtime -like 'win-*') { Copy-Item (Join-Path $root 'deploy\web.config') (Join-Path $Output 'web.config') -Force }

$count = (Get-ChildItem $wwwroot -Recurse -File).Count
Write-Host "Published to $Output ($count static files)"
