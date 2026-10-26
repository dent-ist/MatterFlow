import { holdSentence, holdTitle } from './hold-note';

const NOW = Date.parse('2026-10-26T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000 - 1000).toISOString();

describe('holdSentence (PM v2, #877)', () => {
  it('says how long and why', () => {
    expect(
      holdSentence(
        { onHoldReasonName: 'Waiting for client data', statusChangedAtUtc: daysAgo(6) },
        NOW,
      ),
    ).toBe('On hold for 6 days because Waiting for client data');
  });

  it('uses the singular and "since today"', () => {
    expect(holdSentence({ statusChangedAtUtc: daysAgo(1) }, NOW)).toBe('On hold for 1 day');
    expect(holdSentence({ statusChangedAtUtc: new Date(NOW - 1000).toISOString() }, NOW)).toBe(
      'On hold since today',
    );
  });

  it('has nothing to say without an instant or a reason', () => {
    expect(holdSentence({}, NOW)).toBeNull();
    expect(holdSentence({ onHoldReasonName: 'Waiting for approval' }, NOW)).toBe(
      'On hold because Waiting for approval',
    );
  });
});

describe('holdTitle', () => {
  it('puts the sentence before the comment and marks a cut comment', () => {
    expect(
      holdTitle(
        {
          status: 'ON_HOLD',
          holdReason: 'Waiting on the vendor',
          holdReasonTruncated: true,
          onHoldReasonName: 'Waiting for vendor',
          statusChangedAtUtc: daysAgo(3),
        },
        NOW,
      ),
    ).toBe('On hold for 3 days because Waiting for vendor\nWaiting on the vendor...');
  });

  it('keeps the old behaviour for a comment alone, and is null off hold', () => {
    expect(holdTitle({ status: 'ON_HOLD', holdReason: 'Blocked' }, NOW)).toBe('Blocked');
    expect(holdTitle({ status: 'IN_PROGRESS', holdReason: 'Blocked' }, NOW)).toBeNull();
  });
});
