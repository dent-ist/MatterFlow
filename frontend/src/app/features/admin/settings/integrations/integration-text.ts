import { calendarDayInZone, dayIndex, parseDateOnly } from '../../../../core/time/time';

/** The words of Administration > Settings > Integrations (#1395): the one copy table the tab, its dialogs, the toasts and the Lookup button read. */

export const TYPE_LABELS: Readonly<Record<string, string>> = {
  MATTER_LOOKUP: 'Matter Lookup',
  ETHICAL_WALL: 'Ethical Wall',
  OTHER: 'Other',
};

export const TYPE_ITEMS = [
  { value: 'MATTER_LOOKUP', label: 'Matter Lookup' },
  { value: 'ETHICAL_WALL', label: 'Ethical Wall' },
  { value: 'OTHER', label: 'Other' },
] as const;

/** The sentence under the Type field, which follows the choice. */
export const TYPE_HELP: Readonly<Record<string, string>> = {
  MATTER_LOOKUP: 'Fills in client and matter names on New Client and New Matter. One only.',
  ETHICAL_WALL: 'The ethical wall (conflicts) service. One only.',
  OTHER: 'Any other API. You can add as many as you need.',
};

/** A secret that expires within this many days is a warning (amber banner and chip). */
export const SECRET_WARN_DAYS = 30;

export type SecretState = 'none' | 'ok' | 'soon' | 'expired';

export interface SecretExpiry {
  readonly state: SecretState;
  /** Days from today to the expiry date (negative once it has passed). */
  readonly days: number;
  /** The chip code of `mf-status-chip` kind `integration`. */
  readonly chip: 'SECRET_NOT_SET' | 'SECRET_OK' | 'SECRET_SOON' | 'SECRET_EXPIRED';
  /** The words on the chip: "Expires in 122 days", "Expires today", "Expired 6 days ago", "Not Set". */
  readonly label: string;
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** The state of the client secret from its expiry date (`yyyy-MM-dd`) and today in the person's zone. No secret is "none". */
export function secretExpiry(
  secretIsSet: boolean,
  expiresOn: string | null | undefined,
  now: Date,
  zone: string,
): SecretExpiry {
  if (!secretIsSet) return { state: 'none', days: 0, chip: 'SECRET_NOT_SET', label: 'Not Set' };
  const expiry = expiresOn ? parseDateOnly(expiresOn) : null;
  if (!expiry) return { state: 'ok', days: 0, chip: 'SECRET_OK', label: 'Secret set' };
  const days = dayIndex(expiry) - dayIndex(calendarDayInZone(now, zone));
  if (days < 0)
    return {
      state: 'expired',
      days,
      chip: 'SECRET_EXPIRED',
      label: `Expired ${plural(-days, 'day')} ago`,
    };
  if (days <= SECRET_WARN_DAYS)
    return {
      state: 'soon',
      days,
      chip: 'SECRET_SOON',
      label: days === 0 ? 'Expires today' : `Expires in ${plural(days, 'day')}`,
    };
  return { state: 'ok', days, chip: 'SECRET_OK', label: `Expires in ${plural(days, 'day')}` };
}

export const STEP_LABELS: Readonly<Record<string, string>> = {
  ENTRA_REACHED: 'Reached Microsoft Entra ID',
  CREDENTIALS_ACCEPTED: 'Credentials accepted',
  TOKEN_ISSUED: 'Token issued for the scope',
  API_ANSWERED: 'The API answered',
};

export interface TestCopy {
  /** `ok`, `info` (not set up yet) or `bad`. */
  readonly tone: 'ok' | 'info' | 'bad';
  readonly title: string;
  readonly detail: string;
}

/** "59 minutes", "2 hours", "45 seconds": how long an issued token lives. */
export function lifetimeText(seconds: number | null | undefined): string {
  if (!seconds || seconds < 1) return 'a short while';
  if (seconds < 90) return plural(seconds, 'second');
  const minutes = Math.round(seconds / 60);
  if (minutes < 120) return plural(minutes, 'minute');
  return plural(Math.round(minutes / 60), 'hour');
}

/**
 * The plain-language answer of a test, one sentence for the title and one for the reason (the "copy table" of the mockup). `subject` is the integration's name, or null for the
 * Entra ID connection test. Nothing here comes from the server's text: the server sends only the outcome code.
 */
export function testCopy(
  outcome: string,
  subject: string | null,
  context: { scope?: string | null; baseUrl?: string | null; tokenSeconds?: number | null } = {},
): TestCopy {
  const lifetime = lifetimeText(context.tokenSeconds);
  switch (outcome) {
    case 'OK':
      return subject
        ? {
            tone: 'ok',
            title: 'Connected.',
            detail: `${subject} answered. LPT Hub got a token for its scope; the token is valid for ${lifetime}.`,
          }
        : {
            tone: 'ok',
            title: 'Connected.',
            detail: 'Entra ID accepted the credentials.',
          };
    case 'NOT_SET_UP':
      return {
        tone: 'info',
        title: 'Not set up yet.',
        detail: subject
          ? 'Enter the Tenant ID, Client ID and client secret of the connection, and the Base URL and Scope of this integration, then test again.'
          : 'Enter the Tenant ID, Client ID and client secret, then test again.',
      };
    case 'ENTRA_UNREACHABLE':
      return {
        tone: 'bad',
        title: "Couldn't reach Microsoft Entra ID.",
        detail:
          "LPT Hub's server could not connect to Microsoft. Check its internet access or proxy settings, or ask IT, then try again.",
      };
    case 'CREDENTIALS_REFUSED':
      return {
        tone: 'bad',
        title: 'Entra ID refused the credentials.',
        detail:
          'Check the Tenant ID, the Client ID and the client secret (the secret Value, not the Secret ID).',
      };
    case 'SECRET_EXPIRED':
      return {
        tone: 'bad',
        title: 'The client secret has expired.',
        detail: 'Create a new secret in the app registration, then use Replace Secret above.',
      };
    case 'SCOPE_REFUSED':
      return {
        tone: 'bad',
        title: 'Entra ID refused the scope.',
        detail:
          `The scope ${context.scope ?? ''} is not allowed for this app registration. Ask IT to grant it admin consent, or check the scope text.`.replace(
            'The scope  is',
            'The scope is',
          ),
      };
    case 'API_UNREACHABLE':
      return {
        tone: 'bad',
        title: 'The API is not reachable.',
        detail: `Entra ID issued a token, but ${context.baseUrl ?? 'the Base URL'} did not answer. Check the Base URL, or ask IT whether the API is running.`,
      };
    case 'API_REFUSED':
      return {
        tone: 'bad',
        title: 'The API refused the token.',
        detail:
          'The API answered but did not accept the token. Ask IT to allow this app registration on the API, or check the scope.',
      };
    default:
      return {
        tone: 'bad',
        title: "The test didn't work.",
        detail: 'Try again, or ask IT.',
      };
  }
}

/** Toast copy of a finished test (D-52: it names the thing; success leaves after 4 seconds, an error stays until closed). */
export function testToast(
  outcome: string,
  subject: string | null,
  copy: TestCopy,
): { ok: boolean; summary: string; detail: string } {
  const what = subject ?? 'Microsoft Entra ID';
  if (outcome === 'OK')
    return {
      ok: true,
      summary: subject ? `${what} is connected.` : 'Microsoft Entra ID is connected.',
      detail: copy.detail,
    };
  if (outcome === 'NOT_SET_UP')
    return { ok: false, summary: `${what} is not set up yet.`, detail: copy.detail };
  return {
    ok: false,
    summary: `Couldn't connect ${what}.`,
    detail: copy.title.replace(/\.$/, '') + '.',
  };
}

/** The tooltip and the sentence of a Lookup button that cannot be used, by the state of the Matter Lookup integration. */
export const LOOKUP_UNAVAILABLE: Readonly<Record<string, { tip: string; sentence: string }>> = {
  NOT_SET_UP: {
    tip: 'Lookup is not set up yet. An administrator can set it up under Settings > Integrations.',
    sentence: "Lookup isn't available yet. Enter the details yourself.",
  },
  DISABLED: {
    tip: 'Lookup is turned off. An administrator can turn it on under Settings > Integrations.',
    sentence: 'Lookup is turned off. Enter the details yourself.',
  },
  FAILED: {
    tip: "Lookup isn't working right now. An administrator can check it under Settings > Integrations.",
    sentence: "Lookup isn't working right now. Enter the details yourself.",
  },
};
