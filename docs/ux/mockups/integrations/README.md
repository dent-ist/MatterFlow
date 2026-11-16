# Settings > Integrations mockup (#1395, epic #1389)

Mockup only: static HTML, CSS and JS, no build, no network, nothing saves, no app code changed. Open `index.html` in a browser (double-click). Sizes: 1366x768 and 1920x1080 (desktop only). `assets/tokens.css` is a copy of `docs/ux/tokens.css`; icons are PrimeIcons (`assets/primeicons.*`). All data is invented: every ID is an obvious fake (`aaaaaaaa-0000-...`), no real tenant, host or secret. "Today" is fixed at 11/16/2026 so the screens read the same every day. No keyboard shortcut is added or changed (#420).

## Screens

1. **Settings > Integrations tab.** Administration > Settings keeps its tab strip (Branding, Dashboard, Holidays) and gets a fourth tab, Integrations (icon `pi-link`), last in the strip. Reached by Administration > Settings > Integrations. Under the strip, top to bottom:
   - A banner (D-10a) only when the secret is expiring (amber, 30 days or less) or expired (red), with a Replace Secret button.
   - **Microsoft Entra ID Connection** card: Tenant ID, Client ID, Client Secret (write-only: "Secret set" or "Not set", never a value), Replace Secret or Set Secret, expiry date and chip (Expires in 122 days, Expires in 21 days with warning, Expired 6 days ago, Not Set), Test Connection (checks that Entra ID answers and accepts the credentials), the last test result, Last Updated, `[Cancel] [Save Changes]` (primary disabled until a field changes, as on Branding).
   - **Integrations** card: grid with Name (opens Edit), Type, Base URL, Scope, Enabled, Status chip (Connected, Not Set Up, Failed, Disabled, plus Not Tested for "all entered, never tested"), Last Tested, and the row menu (Edit, Test Connection, Disable or Enable, Delete). "+ Add Integration" sits in the card header. Single-line rows (44 px), tooltips on cut text, a dash for an empty cell. The test result of the last run sits under the grid (reason in plain words plus four steps, the failing step marked).
   - **Recent Changes**: four audit lines (who, what, when); secret values are never written; "Open Audit Logs" footer link.
2. **Add Integration / Edit Integration dialog** (576 px): Name, Type (Matter Lookup, Ethical Wall, Other), Base URL, Scope (help with the example `api://<app-id>/.default`), Enabled. Validation: a Base URL must be https; one Matter Lookup and one Ethical Wall at most (Other is unlimited).
3. **Set / Replace Client Secret dialog** (576 px): masked secret field, Expires On date picker. Catches a pasted Secret ID.
4. **Delete Integration confirm** (416 px, solid red confirm). Enable and Disable do not ask: they act and toast (reversible, D-34).
5. **Test Connection results**: running (steps tick), success (token lifetime), and the failures Not set up yet, Entra ID not reachable, credentials refused, secret expired, scope refused, API not reachable. Shown inline (result panel and the Entra card) and as a toast (success 4 s, error until closed).
6. **Empty state** ("No integrations yet." with Add Integration), **loading** skeletons, **load error** with Retry.
7. **Limited viewer**: someone who can open Settings but lacks the Integrations permission does not see the tab; a direct link shows "You don't have access to Integrations.". Someone with no Settings access sees no Administration menu.
8. **Lookup button note page** (`?view=lookup`): top of New Matter and New Client in six states (Ready, Not set up, Disabled, Fails when used, Nothing found, New Client not set up). A disabled Lookup stays visible with a tooltip and a sentence; typing by hand always works.

## How to open and switch

The small **Mockup Guide** pill (bottom left) lists the screens and has switches: scene (starting data), secret state, what the next Test Connection returns, viewer, and buttons that open the dialogs.

URL options (combine with `&`):

| Option | Values |
| --- | --- |
| `?scene=` | `first-use` (default), `lookup-pending`, `working`, `expiring`, `expired`, `mixed`, `empty`, `loading`, `error` |
| `?secret=` | `none`, `ok`, `soon`, `expired` (forces the secret state on any scene) |
| `?viewer=` | `admin` (default), `limited`, `none` |
| `?tab=` | `integrations` (default), `branding`, `dashboard`, `holidays` (the other tabs are stubs) |
| `?view=` | `settings` (default), `lookup` (plus `&lookup=admin` for the administrator variant) |
| `?dialog=` | `add`, `edit`, `replace`, `delete` (edit and delete act on the first row) |
| `?test=` | `ok`, `notset`, `entra`, `creds`, `expired`, `scope`, `unreachable`, `running` (result for the first integration) |
| `?next=` | same values as `test`, or `auto`: what the next Test Connection click returns |
| `?chrome=0` / `?guide=1` | hide the guide / open it |

Example: `index.html?scene=mixed&test=scope` and `index.html?view=lookup`.

## Assumptions to confirm (see the report)

The names and permission (Integrations tab, `Integrations.Manage`), the Not Tested status, one-per-type for Matter Lookup and Ethical Wall, toast plus inline result for a test, and what the Lookup button does on click are proposals made for this mockup.
