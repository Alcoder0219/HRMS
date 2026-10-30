import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Attendance times must read the same in every country.
 *
 * Node re-reads `process.env.TZ` when it changes, so one process stands in for
 * a browser in India, in Tanzania, and elsewhere. Every assertion is repeated
 * in each viewer zone and must come out identical.
 *
 *   node --test tests/
 */

const {
  ATTENDANCE_TIME_ZONE,
  toAttendanceClock,
  fromAttendanceClock,
  formatAttendanceTime,
} = await import('../src/utils/attendanceTime.js');

const VIEWERS = ['Asia/Kolkata', 'Africa/Dar_es_Salaam', 'UTC', 'America/New_York'];
const original = process.env.TZ;

const inEachViewerZone = (check) =>
  VIEWERS.map((zone) => {
    process.env.TZ = zone;
    return check(zone);
  });

const hhmm = (date) => `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
const ymd = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** What the Edit Attendance dialog does with a time input, composed from the same helpers. */
const toTimeInput = (value) => hhmm(toAttendanceClock(value));
const fromTimeInput = (dayIso, time) => {
  const [hours, minutes] = time.split(':').map(Number);
  const day = toAttendanceClock(dayIso);
  return fromAttendanceClock(day.getFullYear(), day.getMonth() + 1, day.getDate(), hours, minutes).toISOString();
};

/**
 * A record exactly as production stores it today: the day keyed at midnight
 * in the server's zone (18:30Z), and an MB360 punch at 08:30 / 17:30 on the
 * terminal's clock.
 */
const RECORD = {
  date: '2026-10-29T18:30:00.000Z',
  checkInAt: '2026-10-30T03:00:00.000Z',
  checkOutAt: '2026-10-30T12:00:00.000Z',
};

describe('attendance clock', () => {
  after(() => {
    process.env.TZ = original;
  });

  test('is the zone the backend evaluates attendance in', () => {
    assert.equal(ATTENDANCE_TIME_ZONE, 'Asia/Kolkata');
  });

  test('a stored record shows the same date and IN/OUT times in India, Tanzania and elsewhere', () => {
    const seen = inEachViewerZone(() => ({
      date: ymd(toAttendanceClock(RECORD.date)),
      weekday: toAttendanceClock(RECORD.date).getDay(),
      in: toTimeInput(RECORD.checkInAt),
      out: toTimeInput(RECORD.checkOutAt),
    }));

    seen.forEach((view, index) =>
      assert.deepEqual(view, { date: '2026-10-30', weekday: 5, in: '08:30', out: '17:30' }, `viewer in ${VIEWERS[index]}`),
    );
  });

  test('the formatted In/Out text is identical whatever the viewer zone', () => {
    const texts = inEachViewerZone(() => `${formatAttendanceTime(RECORD.checkInAt)}-${formatAttendanceTime(RECORD.checkOutAt)}`);
    assert.equal(new Set(texts).size, 1, texts.join(' | '));
    // 24-hour or 12-hour, as the browser's locale has always chosen.
    assert.match(texts[0], /^08:30(\s?am)?-(17:30|05:30\s?pm)$/i);
    assert.equal(formatAttendanceTime(null), '—');
  });

  test('the duration between IN and OUT is unchanged by display', () => {
    inEachViewerZone((zone) => {
      const minutes = (toAttendanceClock(RECORD.checkOutAt) - toAttendanceClock(RECORD.checkInAt)) / 60_000;
      assert.equal(minutes, 540, zone);
    });
  });

  test('editing and saving without a change gives back the stored instant, from any country', () => {
    const dayIso = fromAttendanceClock(2026, 10, 30).toISOString();
    assert.equal(dayIso, RECORD.date, 'the day saved under is the stored day key');

    inEachViewerZone((zone) => {
      assert.equal(fromTimeInput(dayIso, toTimeInput(RECORD.checkInAt)), RECORD.checkInAt, zone);
      assert.equal(fromTimeInput(dayIso, toTimeInput(RECORD.checkOutAt)), RECORD.checkOutAt, zone);
    });
  });

  test('an edited time is saved as that time on the attendance clock, from any country', () => {
    const dayIso = RECORD.date;
    const saved = inEachViewerZone(() => fromTimeInput(dayIso, '09:15'));
    assert.deepEqual(new Set(saved), new Set(['2026-10-30T03:45:00.000Z']));
    inEachViewerZone((zone) => assert.equal(toTimeInput(saved[0]), '09:15', zone));
  });

  test('days at the month edges keep their date', () => {
    inEachViewerZone((zone) => {
      assert.equal(ymd(toAttendanceClock('2026-09-30T18:30:00.000Z')), '2026-10-01', zone);
      assert.equal(ymd(toAttendanceClock('2026-10-30T18:30:00.000Z')), '2026-10-31', zone);
      assert.equal(ymd(toAttendanceClock(fromAttendanceClock(2026, 10, 31, 23, 59))), '2026-10-31', zone);
    });
  });

  test('a timezone-less device time is one instant wherever it is read', () => {
    const instants = inEachViewerZone(() => fromAttendanceClock(2026, 8, 6, 9, 4).toISOString());
    assert.deepEqual(new Set(instants), new Set(['2026-08-06T03:34:00.000Z']));
  });

  test('explicit Tanzania conversion: 2026-10-30T05:30:00Z is 08:30 in Africa/Dar_es_Salaam, 11:00 in Asia/Kolkata', () => {
    inEachViewerZone((zone) => {
      const instant = '2026-10-30T05:30:00Z';
      assert.equal(hhmm(toAttendanceClock(instant, 'Africa/Dar_es_Salaam')), '08:30', zone);
      assert.equal(ymd(toAttendanceClock(instant, 'Africa/Dar_es_Salaam')), '2026-10-30', zone);
      assert.equal(hhmm(toAttendanceClock(instant, 'Asia/Kolkata')), '11:00', zone);
      assert.equal(
        fromAttendanceClock(2026, 10, 30, 8, 30, 0, 'Africa/Dar_es_Salaam').toISOString(),
        '2026-10-30T05:30:00.000Z',
        zone,
      );
    });
  });

  test('invalid or empty input is handled without throwing', () => {
    assert.equal(toAttendanceClock(undefined), null);
    assert.equal(toAttendanceClock('not a date'), null);
    assert.equal(formatAttendanceTime('not a date'), '—');
  });
});
