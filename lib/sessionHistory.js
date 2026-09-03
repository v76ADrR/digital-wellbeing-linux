// SPDX-License-Identifier: GPL-2.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {
    WEEKDAY_LETTERS,
    parseDateKey,
    startOfWeekSunday,
    weekDateKeys,
    weekdayIndexSunday,
} from './usageStore.js';

const USER_ACTIVE = 1;
const USER_INACTIVE = 0;

export function defaultSessionHistoryPath() {
    return GLib.build_filenamev([
        GLib.get_user_data_dir(),
        'gnome-shell',
        'session-active-history.json',
    ]);
}

function defaultNowUnix() {
    return Math.floor(GLib.get_real_time() / GLib.USEC_PER_SEC);
}

/** GNOME Wellbeing day starts at 03:00 local, same as gnome-shell TimeLimitsManager. */
export function wellbeingDayStart(unixSeconds) {
    const now = GLib.DateTime.new_from_unix_local(unixSeconds);
    let start = GLib.DateTime.new_local(
        now.get_year(),
        now.get_month(),
        now.get_day_of_month(),
        3, 0, 0);
    if (now.compare(start) < 0)
        start = start.add_days(-1);
    return start;
}

export function wellbeingTodayKey(unixSeconds) {
    return wellbeingDayStart(unixSeconds).format('%F');
}

function addInterval(secondsByDate, startUnix, endUnix) {
    let cursor = Math.floor(startUnix);
    const end = Math.floor(endUnix);
    while (cursor < end) {
        const dayStart = wellbeingDayStart(cursor);
        const nextStart = dayStart.add_days(1).to_unix();
        const chunkEnd = Math.min(end, nextStart);
        const key = dayStart.format('%F');
        secondsByDate[key] = (secondsByDate[key] || 0) + (chunkEnd - cursor);
        cursor = chunkEnd;
    }
}

export function parseTransitions(raw) {
    if (!Array.isArray(raw))
        return [];

    const transitions = [];
    for (const entry of raw) {
        if (!entry || typeof entry !== 'object')
            continue;
        const oldState = entry.oldState;
        const newState = entry.newState;
        const wallTimeSecs = entry.wallTimeSecs;
        if ((oldState !== USER_ACTIVE && oldState !== USER_INACTIVE) ||
            (newState !== USER_ACTIVE && newState !== USER_INACTIVE) ||
            oldState === newState ||
            typeof wallTimeSecs !== 'number' ||
            !Number.isFinite(wallTimeSecs))
            continue;
        transitions.push({
            oldState,
            newState,
            wallTimeSecs: Math.floor(wallTimeSecs),
        });
    }
    return transitions;
}

export function secondsByDateFromTransitions(transitions, nowUnix) {
    const secondsByDate = {};
    let activeStart = null;

    for (const entry of transitions) {
        if (entry.newState === USER_ACTIVE) {
            activeStart = entry.wallTimeSecs;
        } else if (entry.newState === USER_INACTIVE && activeStart !== null) {
            if (entry.wallTimeSecs > activeStart)
                addInterval(secondsByDate, activeStart, entry.wallTimeSecs);
            activeStart = null;
        }
    }

    if (activeStart !== null && nowUnix > activeStart)
        addInterval(secondsByDate, activeStart, nowUnix);

    return secondsByDate;
}

export class SessionHistory {
    constructor(options = {}) {
        this._path = options.path ?? defaultSessionHistoryPath();
        this._nowUnix = options.nowUnix ?? defaultNowUnix;
        this._secondsByDate = {};
    }

    get path() {
        return this._path;
    }

    load() {
        let transitions = [];
        try {
            const file = Gio.File.new_for_path(this._path);
            const [, contents] = file.load_contents(null);
            const text = new TextDecoder('utf-8').decode(contents);
            transitions = parseTransitions(JSON.parse(text));
        } catch (_error) {
            transitions = [];
        }
        this._secondsByDate = secondsByDateFromTransitions(transitions, this._nowUnix());
    }

    getDaySeconds(dateKey) {
        return this._secondsByDate[dateKey] || 0;
    }

    getWeekdayAverage(weekdayIndex) {
        let sum = 0;
        let count = 0;
        for (const key of Object.keys(this._secondsByDate)) {
            if (weekdayIndexSunday(key) !== weekdayIndex)
                continue;
            sum += this.getDaySeconds(key);
            count++;
        }
        return count > 0 ? Math.round(sum / count) : 0;
    }

    getAverageWeekSeconds() {
        const keys = Object.keys(this._secondsByDate).sort();
        if (keys.length === 0)
            return 0;

        const first = parseDateKey(keys[0]);
        const last = parseDateKey(wellbeingTodayKey(this._nowUnix()));
        const nDays = Math.floor(last.difference(first) / (GLib.USEC_PER_SEC * 86400)) + 1;
        const nDaysRounded = nDays - (nDays % 7);
        const nCompleteWeeks = nDaysRounded / 7;
        if (nCompleteWeeks === 0)
            return 0;

        let sum = 0;
        for (let i = 0; i < nDaysRounded; i++)
            sum += this.getDaySeconds(first.add_days(i).format('%F'));
        return Math.round(sum / nCompleteWeeks);
    }

    getWeek(weekOffset = 0) {
        const today = wellbeingTodayKey(this._nowUnix());
        const start = startOfWeekSunday(today).add_days(weekOffset * 7);
        const dateKeys = weekDateKeys(start);
        const bars = dateKeys.map(dateKey => {
            const weekdayIndex = weekdayIndexSunday(dateKey);
            return {
                dateKey,
                seconds: this.getDaySeconds(dateKey),
                isToday: dateKey === today,
                letter: WEEKDAY_LETTERS[weekdayIndex],
                weekdayIndex,
            };
        });
        const weekTotal = bars.reduce((sum, bar) => sum + bar.seconds, 0);
        const todayWeekdayIndex = weekdayIndexSunday(today);

        return {
            dateKeys,
            bars,
            weekTotal,
            todayKey: today,
            todaySeconds: this.getDaySeconds(today),
            todayWeekdayIndex,
            todayWeekdayName: parseDateKey(today).format('%A'),
            todayAverage: this.getWeekdayAverage(todayWeekdayIndex),
            weekAverage: this.getAverageWeekSeconds(),
            weekStartKey: dateKeys[0],
            weekEndKey: dateKeys[6],
            isCurrentWeek: weekOffset === 0,
            canGoForward: weekOffset < 0,
            canGoBack: weekOffset > -14,
        };
    }
}
