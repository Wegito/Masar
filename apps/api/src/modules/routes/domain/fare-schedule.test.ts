import { describe, expect, it } from 'vitest';

import { groupFareSets, planFareSchedule, validFromIssue } from './fare-schedule.js';

describe('planFareSchedule', () => {
  it('beendet einen unbefristeten Stand am neuen Beginn', () => {
    expect(
      planFareSchedule([{ id: 'a', validFrom: '2026-11-01', validUntil: null }], '2026-12-01'),
    ).toEqual({
      deleteIds: [],
      closeIds: ['a'],
    });
  });

  it('ersetzt Stände, die am selben Tag oder später beginnen', () => {
    const plan = planFareSchedule(
      [
        { id: 'same', validFrom: '2026-12-01', validUntil: null },
        { id: 'later', validFrom: '2027-01-01', validUntil: null },
      ],
      '2026-12-01',
    );
    expect(plan).toEqual({ deleteIds: ['same', 'later'], closeIds: [] });
  });

  it('lässt abgelaufene Stände und solche, die vor dem Beginn enden, unberührt', () => {
    const plan = planFareSchedule(
      [
        { id: 'past', validFrom: '2026-01-01', validUntil: '2026-06-01' },
        { id: 'ends-on-start', validFrom: '2026-06-01', validUntil: '2026-12-01' },
        { id: 'spans', validFrom: '2026-11-01', validUntil: '2027-01-01' },
      ],
      '2026-12-01',
    );
    expect(plan).toEqual({ deleteIds: [], closeIds: ['spans'] });
  });
});

describe('validFromIssue', () => {
  it('erlaubt heute und später, nicht gestern', () => {
    expect(validFromIssue('2026-11-04', '2026-11-04')).toBeNull();
    expect(validFromIssue('2026-11-05', '2026-11-04')).toBeNull();
    expect(validFromIssue('2026-11-03', '2026-11-04')).toBe('FARE_VALID_FROM_PAST');
  });
});

describe('groupFareSets', () => {
  const base = { currency: 'SYP' };

  it('fasst nach Zeitraum zusammen, sortiert und blendet abgelaufene Stände aus', () => {
    const sets = groupFareSets(
      [
        {
          ...base,
          fromSeq: 1,
          toSeq: 2,
          amountMinor: 30,
          validFrom: '2026-12-01',
          validUntil: null,
        },
        {
          ...base,
          fromSeq: 0,
          toSeq: 2,
          amountMinor: 50,
          validFrom: '2026-11-01',
          validUntil: '2026-12-01',
        },
        {
          ...base,
          fromSeq: 0,
          toSeq: 1,
          amountMinor: 20,
          validFrom: '2026-11-01',
          validUntil: '2026-12-01',
        },
        {
          ...base,
          fromSeq: 0,
          toSeq: 1,
          amountMinor: 10,
          validFrom: '2026-01-01',
          validUntil: '2026-11-01',
        },
      ],
      '2026-11-04',
    );
    expect(sets).toEqual([
      {
        validFrom: '2026-11-01',
        validUntil: '2026-12-01',
        currency: 'SYP',
        items: [
          { fromSeq: 0, toSeq: 1, amountMinor: 20 },
          { fromSeq: 0, toSeq: 2, amountMinor: 50 },
        ],
      },
      {
        validFrom: '2026-12-01',
        validUntil: null,
        currency: 'SYP',
        items: [{ fromSeq: 1, toSeq: 2, amountMinor: 30 }],
      },
    ]);
  });

  it('zählt einen Stand, der heute endet, nicht mehr mit', () => {
    expect(
      groupFareSets(
        [
          {
            ...base,
            fromSeq: 0,
            toSeq: 1,
            amountMinor: 1,
            validFrom: '2026-11-01',
            validUntil: '2026-11-04',
          },
        ],
        '2026-11-04',
      ),
    ).toEqual([]);
  });
});
