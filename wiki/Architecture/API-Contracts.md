# API Contracts

[[_TOC_]]

**What this page is for.** How the HTTP API is described and kept in step with the Angular client: the OpenAPI document, the NSwag generated client, the drift checks in CI, and the other cross-stack contracts in `contracts/`. Follow it whenever you add or change an endpoint or DTO.

## The chain

::: mermaid
flowchart LR
  CODE["Controllers and DTO records (backend modules)"] -->|"dotnet build: Microsoft.Extensions.ApiDescription.Server"| OA["contracts/openapi/v1.json (committed)"]
  OA -->|"npm run api:generate: nswag run nswag.json"| TS["frontend/src/app/api/generated/api-client.ts (committed)"]
  TS --> FEAT["feature facades and stores"]
  OA -.->|"CI: git diff --exit-code"| CI1["backend job drift check"]
  TS -.->|"CI: git diff --exit-code"| CI2["frontend job drift check"]
:::

1. **Code first.** Endpoints and DTOs are written in C#. The `MatterFlow.Api` build generates the OpenAPI 3 document (`OpenApiGenerateDocuments` in `MatterFlow.Api.csproj`; output folder `contracts/openapi`, file `v1.json`). At the time of writing it holds 249 paths, 335 operations and 516 schemas.
2. **Committed document.** `contracts/openapi/v1.json` is committed. The CI backend job builds and then runs `git diff --exit-code -- ../contracts/openapi/v1.json`; any difference fails the job.
3. **Generated client.** `frontend/nswag.json` (NSwag, runtime `Net100`, template `Angular`, class name `{controller}Client`) generates `frontend/src/app/api/generated/api-client.ts`. The frontend CI job runs `npm run api:generate` and then `git diff --exit-code -- src/app/api/generated`.
4. **Never edit either file by hand and never merge them by hand.** After a merge or pull, rebuild the backend and run `npm run api:generate`, then commit.

## How to regenerate after an API change

```
cd backend && dotnet build -warnaserror          # rewrites contracts/openapi/v1.json
cd ../frontend && npm run api:generate           # rewrites src/app/api/generated/api-client.ts
git add ../contracts/openapi/v1.json src/app/api/generated
```

NSwag is a frontend dev dependency (`npm run api:generate` uses the local copy). If the generated client changes in ways you did not expect, check that the controller names and operation names (`Name = "GetDashboard"` on the HTTP attributes) are stable: they become TypeScript method names.

## Conventions the document relies on

- REST over JSON under `/api/v1`, plural kebab-case resources, camelCase JSON, enums as strings, dates `yyyy-MM-dd`, instants ISO 8601 UTC with `Z`, `rowVersion` as a base64 string. See `docs/architecture.md` section 11 and [Conventions](../Reference/Conventions.md).
- Number handling is strict (`JsonNumberHandling.Strict`) so numbers stay plain integers in the schemas.
- Errors: `application/problem+json` with a stable `code`. An `ErrorCodeEnumTransformer` (`MatterFlow.Api/OpenApi/OpenApiSetup.cs`) makes the codes a closed enum on `ApiProblemDetails.code`.
- Give every action an `[Authorize(Policy = "Perm:...")]`; the OpenAPI document and architecture tests rely on it.
- Reports pages are lazy routes so the generated client never enters the initial bundle (ADR 029).

## Other contracts in `contracts/`

| File | What it is | Check |
|---|---|---|
| `permissions.json` | Permission catalog (70 codes) | A unit test keeps `Permissions.cs` and `frontend/src/app/core/auth/permissions.ts` equal to it |
| `form-rules.schema.json`, `form-rules.md` | JSON Schema and semantics of conditional form rules | `node contracts/validate-contracts.mjs` |
| `form-rules.vectors.json` | Conformance vectors run unchanged by the .NET and TypeScript test suites | same |
| `asset-numbering/pattern-vectors.json` | Conformance vectors of the Asset Number pattern (the tail after the CM Number, one counter token such as `{###}`; issue #1297): cases `{tail, cmNumber, counter, expected \| expectedError}` with the stable error codes `PATTERN_NO_COUNTER`, `PATTERN_TWO_COUNTERS`, `PATTERN_UNKNOWN_TOKEN`, `PATTERN_FORBIDDEN_CHAR`, `PATTERN_EDGE_SPACE`, `PATTERN_TRAILING_DOT`, `PATTERN_TOO_LONG`, `PATTERN_COUNTER_WIDTH` | `node contracts/validate-contracts.mjs` (shape and a reference implementation); backend `AssetNumberingTests` run every vector; the frontend runs the same file |
| `form-rules.messages.json` | Message keys and wording per rule error code | same (every code needs a key) |
| `task-type-colours.json` | The palette of ten colour keys for task types and asset types | Lint and unit tests; never store a hex value in the database |
| `task-type-icons.json` | The icon library for task types | `tools/icons` generates it; script 21 retired brand icons |
| `db/report-access.json` | Table access catalogue for the read-only report login | `ReportAccessCatalogueTests` |

`docs/contract-issues-dotnet.md` and `docs/contract-issues-ts.md` record notes from implementing the form-rules contract in each stack (all resolved).

## Related pages

- [How to Add an Endpoint](../Backend/How-to-Add-an-Endpoint.md)
- [API Client and Generated Code](../Frontend/API-Client-and-Generated-Code.md)
- [Continuous Integration](../Getting-Started/Continuous-Integration.md)

Last verified against commit f45fc1d.
