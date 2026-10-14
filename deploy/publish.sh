#!/usr/bin/env bash
# Builds the Angular app and publishes the API with the build inside wwwroot, ready to copy to the IIS site folder.
#
#   deploy/publish.sh [output-dir] [runtime-identifier]
#
# Defaults: output-dir = artifacts/publish, runtime-identifier = win-x64 (framework-dependent, needs the .NET 10 Hosting Bundle on the server).
# Use linux-x64 to run the package locally on Linux. Set SKIP_FRONTEND_INSTALL=1 to reuse node_modules.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out="${1:-$root/artifacts/publish}"
rid="${2:-win-x64}"
case "$out" in /*) ;; *) out="$PWD/$out" ;; esac

echo "==> Frontend build"
cd "$root/frontend"
if [ "${SKIP_FRONTEND_INSTALL:-0}" != "1" ]; then npm ci; fi
npm run build
browser="$root/frontend/dist/frontend/browser"
[ -f "$browser/index.html" ] || { echo "Angular build produced no index.html in $browser" >&2; exit 1; }

echo "==> dotnet publish ($rid) -> $out"
rm -rf "$out"
dotnet publish "$root/backend/src/MatterFlow.Api/MatterFlow.Api.csproj" -c Release -r "$rid" --self-contained false -o "$out" -p:OpenApiGenerateDocuments=false

echo "==> Copy the Angular build into wwwroot"
rm -rf "$out/wwwroot"
mkdir -p "$out/wwwroot"
cp -R "$browser/." "$out/wwwroot/"

echo "==> Deployment templates"
cp "$root/deploy/appsettings.Production.template.json" "$out/"
case "$rid" in win-*) cp "$root/deploy/web.config" "$out/web.config" ;; esac

echo "Published to $out ($(find "$out/wwwroot" -type f | wc -l) static files)"
