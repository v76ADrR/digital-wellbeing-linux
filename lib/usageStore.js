// SPDX-License-Identifier: GPL-2.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const SCHEMA_VERSION = 1;
const KEEP_DAYS = 28;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export const WEEKDAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
export const WEEKDAY_NAMES = [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
];

export function defaultUsagePath() {
    return GLib.build_filenamev([
        GLib.get_user_data_dir(),
        'digital-wellbeing@local',
        'usage.json',
    ]);
}

function defaultNowUnix() {
    return Math.floor(GLib.get_real_time() / GLib.USEC_PER_SEC);
}

function defaultTodayKey() {
    return GLib.DateTime.new_now_local().format('%F');
}

export function readBootId() {
    try {
        const [ok, contents] = GLib.file_get_contents('/proc/sys/kernel/random/boot_id');
        if (!ok)
            return '';
        return new TextDecoder('utf-8').decode(contents).trim();
    } catch (_error) {
        return '';
    }
}

export function parseDateKey(dateKey) {
    const [year, month, day] = dateKey.split('-').map(Number);
    return GLib.DateTime.new_local(year, month, day, 12, 0, 0);
}

export function weekdayIndexSunday(dateKey) {
    return parseDateKey(dateKey).get_day_of_week() % 7;
}

export function startOfWeekSunday(dateKey) {
    const date = parseDateKey(dateKey);
    return date.add_days(-(date.get_day_of_week() % 7));
}

export function weekDateKeys(weekStart) {
    const keys = [];
    for (let i = 0; i < 7; i++)
        keys.push(weekStart.add_days(i).format('%F'));
    return keys;
}

function emptyData() {
    return {
        version: SCHEMA_VERSION,
        bootId: '',
        session: {
            startedUnix: 0,
            apps: {},
        },
        days: {},
    };
}

function normalizeApps(raw) {
    const apps = {};
    if (!raw || typeof raw !== 'object')
        return apps;

    for (const [id, value] of Object.entries(raw)) {
        if (!id)
            continue;
        const seconds = Math.max(0, Math.floor(Number(value?.seconds) || 0));
        if (seconds <= 0)
            continue;
        apps[id] = {
            name: typeof value?.name === 'string' && value.name ? value.name : id,
            seconds,
        };
    }
    return apps;
}

function normalize(raw) {
    const data = emptyData();
    if (!raw || typeof raw !== 'object')
        return data;

    if (typeof raw.bootId === 'string')
        data.bootId = raw.bootId;

    if (raw.session && typeof raw.session === 'object') {
        data.session.startedUnix = Math.max(0, Math.floor(Number(raw.session.startedUnix) || 0));
        data.session.apps = normalizeApps(raw.session.apps);
    }

    if (raw.days && typeof raw.days === 'object') {
        for (const [key, day] of Object.entries(raw.days)) {
            if (!DATE_KEY.test(key))
                continue;
            data.days[key] = {apps: normalizeApps(day?.apps)};
        }
    }

    return data;
}

function addToAppMap(map, appId, appName, seconds) {
    const current = map[appId];
    if (current) {
        current.seconds += seconds;
        if (appName)
            current.name = appName;
        return;
    }
    map[appId] = {
        name: appName || appId,
        seconds,
    };
}

export function appsFromMap(map) {
    return Object.entries(map || {})
        .map(([id, value]) => ({
            id,
            name: value?.name || id,
            seconds: Math.max(0, Math.floor(Number(value?.seconds) || 0)),
        }))
        .filter(app => app.seconds > 0)
        .sort((a, b) => b.seconds - a.seconds || a.name.localeCompare(b.name));
}

export function dayTotalFromRecord(day) {
    let total = 0;
    for (const app of Object.values(day?.apps || {}))
        total += Math.max(0, Math.floor(Number(app?.seconds) || 0));
    return total;
}

export function groupAppsForDonut(apps, {maxSlices = 6, minFraction = 0.04} = {}) {
    const sorted = [...apps].filter(app => app.seconds > 0)
        .sort((a, b) => b.seconds - a.seconds);
    const total = sorted.reduce((sum, app) => sum + app.seconds, 0);
    if (total <= 0)
        return {total: 0, slices: []};

    const slices = [];
    let otherSeconds = 0;
    for (const app of sorted) {
        if (slices.length < maxSlices && app.seconds / total >= minFraction)
            slices.push({...app});
        else
            otherSeconds += app.seconds;
    }

    if (otherSeconds > 0) {
        slices.push({
            id: '__other__',
            name: 'Other',
            seconds: otherSeconds,
            isOther: true,
        });
    }

    return {total, slices};
}

export class UsageStore {
    constructor(options = {}) {
        this._path = options.path ?? defaultUsagePath();
        this._nowUnix = options.nowUnix ?? defaultNowUnix;
        this._todayKey = options.todayKey ?? defaultTodayKey;
        this._readBootId = options.readBootId ?? readBootId;
        this._data = emptyData();
        this._dirty = false;
    }

    get path() {
        return this._path;
    }

    todayKey() {
        return this._todayKey();
    }

    load() {
        try {
            const file = Gio.File.new_for_path(this._path);
            const [, contents] = file.load_contents(null);
            this._data = normalize(JSON.parse(new TextDecoder('utf-8').decode(contents)));
        } catch (_error) {
            this._data = emptyData();
        }

        this._ensureSession();
        this._dirty = false;
    }

    save() {
        this._ensureSession();
        this._pruneDays();
        try {
            const file = Gio.File.new_for_path(this._path);
            const parent = file.get_parent();
            if (parent && !parent.query_exists(null))
                parent.make_directory_with_parents(null);

            const payload = JSON.stringify(this._data, null, 2);
            file.replace_contents(
                payload,
                null,
                false,
                Gio.FileCreateFlags.PRIVATE,
                null);
            this._dirty = false;
        } catch (error) {
            console.warn(`Digital Wellbeing: failed to save usage: ${error.message}`);
        }
    }

    saveIfDirty() {
        if (this._dirty)
            this.save();
    }

    addUsage(appId, appName, seconds) {
        const amount = Math.floor(Number(seconds) || 0);
        if (!appId || amount <= 0)
            return;

        this._ensureSession();
        const dayKey = this.todayKey();
        if (!this._data.days[dayKey])
            this._data.days[dayKey] = {apps: {}};

        addToAppMap(this._data.session.apps, appId, appName, amount);
        addToAppMap(this._data.days[dayKey].apps, appId, appName, amount);
        this._dirty = true;
    }

    getDayTotal(dateKey) {
        return dayTotalFromRecord(this._data.days[dateKey]);
    }

    getDayApps(dateKey) {
        return appsFromMap(this._data.days[dateKey]?.apps);
    }

    getSessionApps() {
        return appsFromMap(this._data.session.apps);
    }

    getSessionTotal() {
        return dayTotalFromRecord(this._data.session);
    }

    getSessionStartedUnix() {
        return this._data.session.startedUnix || 0;
    }

    getWeekdayAverage(weekdayIndex) {
        let sum = 0;
        let count = 0;
        for (const key of Object.keys(this._data.days)) {
            if (weekdayIndexSunday(key) !== weekdayIndex)
                continue;
            sum += this.getDayTotal(key);
            count++;
        }
        return count > 0 ? Math.round(sum / count) : 0;
    }

    getWeek(weekOffset = 0) {
        const today = this.todayKey();
        const start = startOfWeekSunday(today).add_days(weekOffset * 7);
        const dateKeys = weekDateKeys(start);
        const bars = dateKeys.map(dateKey => {
            const weekdayIndex = weekdayIndexSunday(dateKey);
            return {
                dateKey,
                seconds: this.getDayTotal(dateKey),
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
            todaySeconds: this.getDayTotal(today),
            todayWeekdayIndex,
            todayWeekdayName: parseDateKey(today).format('%A'),
            todayAverage: this.getWeekdayAverage(todayWeekdayIndex),
            weekAverage: Math.round(weekTotal / 7),
            weekStartKey: dateKeys[0],
            weekEndKey: dateKeys[6],
            isCurrentWeek: weekOffset === 0,
            canGoForward: weekOffset < 0,
            canGoBack: weekOffset > -14,
        };
    }

    _ensureSession() {
        const bootId = this._readBootId() || 'unknown';
        if (this._data.bootId === bootId && this._data.session)
            return;

        this._data.bootId = bootId;
        this._data.session = {
            startedUnix: this._nowUnix(),
            apps: {},
        };
        this._dirty = true;
    }

    _pruneDays() {
        const keys = Object.keys(this._data.days).sort();
        if (keys.length <= KEEP_DAYS)
            return;

        for (const key of keys.slice(0, keys.length - KEEP_DAYS))
            delete this._data.days[key];
        this._dirty = true;
    }
}
