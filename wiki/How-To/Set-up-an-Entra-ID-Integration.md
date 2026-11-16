# Set up an Entra ID Integration

[[_TOC_]]

**What this page is for.** The steps an administrator follows, and the list of what IT must provide, to connect LPT Hub to an external API (Matter Lookup, Ethical Wall or another) through Microsoft Entra ID. Screen: Administration > Settings > Integrations (permission `Integrations.Manage`, System Admin by default).

## How it works in one paragraph

LPT Hub has ONE Entra ID app registration: one Tenant ID, one Client ID and one client secret. For each API it calls, LPT Hub asks Entra ID for an access token with that API's own scope (OAuth2 client credentials) and sends it as a bearer token. The secret is stored encrypted, shown nowhere and never written to a log or an audit entry. A token is kept in memory and replaced shortly before it expires.

## What IT must provide

| Item | Where it comes from | Where it goes |
|---|---|---|
| Tenant ID (Directory ID) | The Entra ID tenant overview | Tenant ID field |
| Client ID (Application ID) | The app registration of LPT Hub | Client ID field |
| Client secret VALUE and its expiry date | App registration > Certificates and secrets > New client secret (the Value is shown once; the Secret ID is not what is needed) | Set Secret dialog |
| Scope, one per API | The API's own app registration, usually `api://<app-id-of-the-api>/.default`. IT grants the LPT Hub app registration permission to it (application permission with admin consent) | Scope field of the integration |
| Base URL, one per API | The https address of the API | Base URL field of the integration |
| For Matter Lookup: the request and response shape | The API's documentation (the current assumption is in [Configuration Reference](../Operations/Configuration-Reference.md)) | Developer, one place: `ProvisionalMatterLookupClient` or `Integrations:MatterLookup:*` |
| A key folder on the LPT Hub server | IT creates it ([Runbook](../Operations/Runbook.md) section 20) | `DataProtection:KeysPath` |
| Outbound HTTPS from the LPT Hub server | To `login.microsoftonline.com` and each Base URL | Firewall or proxy |

## Steps

1. Open Administration > Settings > Integrations. Enter the Tenant ID and Client ID, then Save Changes (the secret is not part of it).
2. Choose Set Secret, paste the secret Value, enter the date it expires and choose Set Secret. It saves at once. If the page says the key store is not configured, ask IT to finish the key folder step.
3. Choose Test Connection on the Microsoft Entra ID Connection card. "Connected" means Entra ID answered and accepted the credentials.
4. Open Matter Lookup (or Ethical Wall) with its name or the row menu > Edit, enter the Base URL (https only) and the Scope, and save. Use Add Integration for any other API (type Other).
5. Row menu > Test Connection. The result under the grid says which step stopped: Entra ID reached, credentials accepted, token issued for the scope, the API answered.

## Reading a result

| Result | What it means | Who fixes it |
|---|---|---|
| Not set up yet | Something above is still empty | The administrator |
| Couldn't reach Microsoft Entra ID | The server cannot connect to Microsoft (internet, proxy) | IT |
| Entra ID refused the credentials | Wrong Tenant ID, Client ID or secret (often the Secret ID was pasted instead of the Value) | The administrator, then IT |
| The client secret has expired | The expiry date passed | Create a new secret, then Replace Secret |
| Entra ID refused the scope | The scope text is wrong, or admin consent was not given for it | IT |
| The API is not reachable | The token worked but the Base URL did not answer | IT or the API owner |
| The API refused the token | The API answered 401 or 403 | IT or the API owner |

A status chip in the list summarises it: Connected, Not Set Up, Not Tested (everything entered, never tested), Failed, Disabled. Changing the Tenant ID, Client ID or secret clears every last test result: test again afterwards.

## Expiry

From 30 days before the expiry date an amber banner and chip ask for a new secret; after it a red one says the secret expired. Create the new secret in the app registration first, then Replace Secret.

## Lookup on New Client and New Matter

When Matter Lookup is Connected (or Not Tested), the Lookup button next to the Client Number (New Client) and next to the Matter Number (New Matter, after choosing a client) asks the API and fills the name. The person still checks and saves. When Matter Lookup is not set up, turned off or its last test failed, the button stays but is off, with a tooltip and a sentence; an administrator also sees an Open Integrations link. Typing by hand always works.

## Related pages

- [Runbook](../Operations/Runbook.md)
- [Configuration Reference](../Operations/Configuration-Reference.md)
- [Permission Catalogue](../Reference/Permission-Catalogue.md)
- [Module Guide](../Backend/Module-Guide.md)

Last verified against commit 06c4e56.
