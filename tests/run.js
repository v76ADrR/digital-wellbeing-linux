// SPDX-License-Identifier: GPL-2.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {barIndexAt, barLayout} from '../lib/chartLayout.js';
import {formatScreenTime, formatUptime} from '../lib/duration.js';
import {
    SessionHistory,
    secondsByDateFromTransitions,
    wellbeingTodayKey,
} from '../lib/sessionHistory.js';
import {
    UsageStore,
    groupAppsForDonut,
    startOfWeekSunday,
    weekdayIndexSunday,
    weekDateKeys,
} from '../lib/usageStore.js';

let failed = 0;

function assert(condition, message) {
    if (condition) {
        print(`ok ${message}`);
        return;
    }
    failed += 1;
    printerr(`FAIL ${message}`);
}

assert(formatUptime(null, 'compact') === '—', 'null uptime is em dash');
assert(formatUptime(45, 'compact') === '0m', 'sub-minute compact floors to 0m');
assert(formatUptime(60, 'compact') === '1m', 'one minute compact');
assert(formatUptime(4 * 3600 + 60, 'compact') === '4h 1m', 'compact hours');
assert(formatUptime(2 * 86400 + 4 * 3600 + 60, 'compact') === '2d 4h 1m', 'compact days');
assert(formatUptime(4 * 3600 + 60, 'clock') === '4:01', 'clock format');
assert(formatUptime(2 * 86400 + 4 * 3600 + 61, 'clock') === '2d 04:01', 'clock with days');
assert(formatUptime(3660, 'verbose') === '1 hour 1 minute', 'verbose singular');
assert(formatUptime(2 * 3600 + 120, 'verbose') === '2 hours 2 minutes', 'verbose plural');
assert(formatScreenTime(2 * 3600 + 21 * 60) === '2h 21m', 'screen time today');
assert(formatScreenTime(41 * 3600 + 55 * 60) === '41h 55m', 'screen time rolls hours past a day');
assert(formatScreenTime(0) === '0m', 'zero screen time');

assert(weekdayIndexSunday('2026-09-03') === 4, '2026-09-03 is Thursday');
assert(startOfWeekSunday('2026-09-03').format('%F') === '2026-08-30', 'week starts Sunday 30 Aug');
assert(weekDateKeys(startOfWeekSunday('2026-09-03')).join(',') ===
    '2026-08-30,2026-08-31,2026-09-01,2026-09-02,2026-09-03,2026-09-04,2026-09-05',
    'full Sunday week keys');

const grouped = groupAppsForDonut([
    {id: 'a', name: 'A', seconds: 100},
    {id: 'b', name: 'B', seconds: 50},
    {id: 'c', name: 'C', seconds: 2},
    {id: 'd', name: 'D', seconds: 1},
], {maxSlices: 2, minFraction: 0.04});
assert(grouped.total === 153, 'donut total');
assert(grouped.slices.length === 3, 'two slices plus Other');
assert(grouped.slices[2].isOther === true, 'remainder is Other');
assert(grouped.slices[2].seconds === 3, 'other seconds');
assert(groupAppsForDonut([]).slices.length === 0, 'empty donut');

const layout = barLayout(400, 220, 7);
assert(layout.count === 7, 'seven bars');
assert(barIndexAt(layout.left + 2, 80, 400, 220, 7) === 0, 'tap first bar');
assert(barIndexAt(layout.left + layout.barWidth + layout.gap + 2, 80, 400, 220, 7) === 1, 'tap second bar');
assert(barIndexAt(layout.left + 3 * (layout.barWidth + layout.gap) + 2, 80, 400, 220, 7) === 3, 'tap fourth bar');
assert(barIndexAt(0, 80, 400, 220, 7) === -1, 'miss left of plot');
assert(barIndexAt(200, 0, 400, 220, 7) === -1, 'miss above plot');

const dir = GLib.build_filenamev([
    GLib.get_tmp_dir(),
    `dw-test-${Math.floor(GLib.get_real_time())}`,
]);
GLib.mkdir_with_parents(dir, 0o755);
const path = GLib.build_filenamev([dir, 'usage.json']);

let now = 1_700_000_000;
const store = new UsageStore({
    path,
    nowUnix: () => now,
    todayKey: () => '2026-09-03',
    readBootId: () => 'boot-1',
});
store.load();
store.addUsage('firefox.desktop', 'Firefox', 120);
store.addUsage('firefox.desktop', 'Firefox', 60);
store.addUsage('org.gnome.Nautilus.desktop', 'Files', 30);
assert(store.getSessionTotal() === 210, 'session total accumulates');
assert(store.getDayTotal('2026-09-03') === 210, 'today matches session on first day');
assert(store.getSessionApps()[0].id === 'firefox.desktop', 'apps sorted by time');
store.save();

const reloaded = new UsageStore({
    path,
    nowUnix: () => now,
    todayKey: () => '2026-09-03',
    readBootId: () => 'boot-1',
});
reloaded.load();
assert(reloaded.getSessionTotal() === 210, 'roundtrip session');
assert(reloaded.getDayApps('2026-09-03').length === 2, 'roundtrip two apps');

const afterReboot = new UsageStore({
    path,
    nowUnix: () => now + 10,
    todayKey: () => '2026-09-03',
    readBootId: () => 'boot-2',
});
afterReboot.load();
assert(afterReboot.getSessionTotal() === 0, 'new boot clears boot-only session');
assert(afterReboot.getDayTotal('2026-09-03') === 210, 'daily history survives reboot');
assert(afterReboot.getDayApps('2026-09-03').length === 2, 'today app list survives reboot');

afterReboot.addUsage('firefox.desktop', 'Firefox', 90);
afterReboot.save();
assert(afterReboot.getDayTotal('2026-09-03') === 300, 'afternoon session adds to the same day');
assert(afterReboot.getSessionTotal() === 90, 'new session is only this boot');
assert(afterReboot.listSessions().length === 2, 'morning and afternoon session files');
assert(Gio.File.new_for_path(afterReboot.sessionsDir).query_exists(null), 'sessions directory exists');

const weekStore = new UsageStore({
    path: GLib.build_filenamev([dir, 'week.json']),
    sessionsDir: GLib.build_filenamev([dir, 'week-sessions']),
    nowUnix: () => now,
    todayKey: () => '2026-09-03',
    readBootId: () => 'boot-1',
});
weekStore.load();
weekStore.addUsage('a.desktop', 'A', 3600);
const week = weekStore.getWeek(0);
assert(week.bars[4].isToday === true, 'Thursday bar is today');
assert(week.bars[4].seconds === 3600, 'today bar has usage');
assert(week.weekTotal === 3600, 'week total');
assert(week.canGoForward === false, 'cannot go past current week');

function localUnix(year, month, day, hour, minute) {
    return GLib.DateTime.new_local(year, month, day, hour, minute, 0).to_unix();
}

const historyNow = localUnix(2026, 9, 3, 20, 0);
const transitions = [
    {oldState: 0, newState: 1, wallTimeSecs: localUnix(2026, 8, 30, 9, 0)},
    {oldState: 1, newState: 0, wallTimeSecs: localUnix(2026, 8, 30, 14, 39)},
    {oldState: 0, newState: 1, wallTimeSecs: localUnix(2026, 8, 31, 8, 0)},
    {oldState: 1, newState: 0, wallTimeSecs: localUnix(2026, 8, 31, 20, 9)},
    {oldState: 0, newState: 1, wallTimeSecs: localUnix(2026, 9, 3, 10, 0)},
    {oldState: 1, newState: 0, wallTimeSecs: localUnix(2026, 9, 3, 14, 21)},
];
const byDate = secondsByDateFromTransitions(transitions, historyNow);
assert(wellbeingTodayKey(historyNow) === '2026-09-03', 'wellbeing today is 3 Sep');
assert(byDate['2026-09-03'] === 4 * 3600 + 21 * 60, 'thursday active 4h 21m');
assert(byDate['2026-08-30'] === 5 * 3600 + 39 * 60, 'sunday active 5h 39m');
assert(byDate['2026-08-31'] === 12 * 3600 + 9 * 60, 'monday active 12h 9m');

const openNow = localUnix(2026, 9, 3, 16, 0);
const stillActive = secondsByDateFromTransitions([
    {oldState: 0, newState: 1, wallTimeSecs: localUnix(2026, 9, 3, 14, 0)},
], openNow);
assert(stillActive['2026-09-03'] === 2 * 3600, 'open ACTIVE interval adds now minus start');

const twoAm = localUnix(2026, 9, 4, 2, 0);
assert(wellbeingTodayKey(twoAm) === '2026-09-03', '02:00 local is previous wellbeing day');
const acrossDawn = secondsByDateFromTransitions([
    {oldState: 0, newState: 1, wallTimeSecs: localUnix(2026, 9, 3, 22, 0)},
    {oldState: 1, newState: 0, wallTimeSecs: localUnix(2026, 9, 4, 5, 0)},
], localUnix(2026, 9, 4, 12, 0));
assert(acrossDawn['2026-09-03'] === 5 * 3600, 'before 03:00 stays on previous wellbeing day');
assert(acrossDawn['2026-09-04'] === 2 * 3600, 'after 03:00 is the next wellbeing day');

const historyPath = GLib.build_filenamev([dir, 'session-active-history.json']);
Gio.File.new_for_path(historyPath).replace_contents(
    JSON.stringify(transitions), null, false, Gio.FileCreateFlags.PRIVATE, null);
const history = new SessionHistory({
    path: historyPath,
    nowUnix: () => historyNow,
});
history.load();
const gnomeWeek = history.getWeek(0);
assert(gnomeWeek.todaySeconds === 4 * 3600 + 21 * 60, 'session history today');
assert(gnomeWeek.weekTotal === (5 * 3600 + 39 * 60) + (12 * 3600 + 9 * 60) + (4 * 3600 + 21 * 60),
    'session history week includes earlier days');
assert(gnomeWeek.bars[0].seconds > 0, 'sunday bar filled from gnome history');
assert(gnomeWeek.weekAverage === 0, 'average week is 0 without a complete prior week');

if (failed > 0)
    throw new Error(`${failed} test(s) failed`);

print('all tests passed');
