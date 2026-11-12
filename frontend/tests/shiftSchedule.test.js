import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

/**
 * The arithmetic and checks behind the day-wise schedule on the Shifts form.
 *
 *   node --test tests/
 */

const {
  SCHEDULE_DAYS,
  netMinutes,
  formatDuration,
  scheduleFromShift,
  copyMondayToWeekdays,
  scheduleErrors,
  isOvernight,
} = await import('../src/utils/shiftSchedule.js');

describe('day-wise shift schedule', () => {
  test('the example week: net working time per day', () => {
    const working = (startTime, endTime, breakMinutes) => ({ isWorking: true, startTime, endTime, breakMinutes });

    assert.equal(formatDuration(netMinutes(working('08:30', '17:00', 60))), '7h 30m');
    assert.equal(formatDuration(netMinutes(working('08:30', '14:30', 30))), '5h 30m');
    assert.equal(netMinutes({ isWorking: false, startTime: '08:30', endTime: '17:00' }), 0);
    assert.equal(formatDuration(netMinutes(working('22:00', '06:00', 30))), '7h 30m', 'overnight runs on');
    assert.equal(isOvernight(working('22:00', '06:00', 30)), true);
    assert.equal(isOvernight(working('08:30', '17:00', 60)), false);
  });

  test('switching to day-wise starts from what the shift already does', () => {
    const week = scheduleFromShift({ startTime: '09:30', endTime: '18:00', breakMinutes: 60, weeklyOffs: [0] });

    assert.deepEqual(week.map((entry) => entry.day), SCHEDULE_DAYS.map((entry) => entry.day));
    assert.equal(week.find((entry) => entry.day === 0).isWorking, false);
    week.filter((entry) => entry.day !== 0).forEach((entry) => {
      assert.deepEqual([entry.isWorking, entry.startTime, entry.endTime, entry.breakMinutes], [true, '09:30', '18:00', 60]);
    });
  });

  test('copy Monday reaches Tuesday to Friday only', () => {
    const week = scheduleFromShift({ startTime: '08:30', endTime: '17:00', breakMinutes: 60, weeklyOffs: [0] }).map((entry) =>
      entry.day === 1 ? { ...entry, startTime: '07:00', endTime: '15:00', breakMinutes: 45 } : entry.day === 6 ? { ...entry, endTime: '14:30', breakMinutes: 30 } : entry,
    );

    const copied = copyMondayToWeekdays(week);
    [2, 3, 4, 5].forEach((day) => assert.equal(copied.find((entry) => entry.day === day).startTime, '07:00'));
    assert.equal(copied.find((entry) => entry.day === 6).endTime, '14:30', 'Saturday untouched');
    assert.equal(copied.find((entry) => entry.day === 0).isWorking, false, 'Sunday untouched');
  });

  test('checks: missing times, equal times, an over-long break; weekly offs are not checked', () => {
    const errors = scheduleErrors([
      { day: 1, isWorking: true, startTime: '', endTime: '17:00', breakMinutes: 0 },
      { day: 2, isWorking: true, startTime: '08:00', endTime: '08:00', breakMinutes: 0 },
      { day: 3, isWorking: true, startTime: '08:00', endTime: '09:00', breakMinutes: 60 },
      { day: 4, isWorking: true, startTime: '22:00', endTime: '06:00', breakMinutes: 30 },
      { day: 0, isWorking: false, startTime: '', endTime: '', breakMinutes: 0 },
    ]);

    assert.deepEqual(Object.keys(errors).map(Number).sort(), [1, 2, 3]);
  });
});
