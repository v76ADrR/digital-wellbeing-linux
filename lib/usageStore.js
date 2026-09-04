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

export function defaultDataDir() {
    return GLib.build_filenamev([
        GLib.get_user_data_dir(),
        'digital-wellbeing@local',
    ]);
}

export function defaultUsagePath() {
    return GLib.build_filenamev([
        defaultDataDir(),
        'usage.json',
    ]);
}

export function defaultSessionsDir() {
    return GLib.build_filenamev([
        defaultDataDir(),
        'sessions',
    ]);
}

function sessionsDirForPath(usagePath) {
    const file = Gio.File.new_for_path(usagePath);
    const parent = file.get_parent();
    if (!parent)
        return defaultSessionsDir();
    return parent.get_child('sessions').get_path();
}

function safeBootToken(bootId) {
    const token = String(bootId || 'unknown').replace(/[^A-Za-z0-9._-]/g, '');
    return (token || 'unknown').slice(0, 36);
}

function mergeDayMaps(target, source) {
    for (const [dateKey, day] of Object.entries(source || {})) {
        if (!DATE_KEY.test(dateKey))
            continue;
        if (!target[dateKey])
            target[dateKey] = {apps: {}};
        for (const [appId, value] of Object.entries(day?.apps || {})) {
            addToAppMap(
                target[dateKey].apps,
                appId,
                value?.name,
                Math.max(0, Math.floor(Number(value?.seconds) || 0)));
        }
    }
}

function cloneDays(days) {
    const out = {};
    for (const [dateKey, day] of Object.entries(days || {})) {
        out[dateKey] = {apps: {}};
        for (const [appId, value] of Object.entries(day?.apps || {})) {
            out[dateKey].apps[appId] = {
                name: value?.name || appId,
                seconds: Math.max(0, Math.floor(Number(value?.seconds) || 0)),
            };
        }
    }
    return out;
}

function sessionRecordFromJson(raw) {
    if (!raw || typeof raw !== 'object')
        return null;
    const bootId = typeof raw.bootId === 'string' && raw.bootId ? raw.bootId : 'unknown';
    const startedUnix = Math.max(0, Math.floor(Number(raw.startedUnix) || 0));
    const endedUnix = Math.max(startedUnix, Math.floor(Number(raw.endedUnix) || startedUnix));
    const days = {};
    if (raw.days && typeof raw.days === 'object')
        mergeDayMaps(days, raw.days);
    return {bootId, startedUnix, endedUnix, days};
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
        this._sessionsDir = options.sessionsDir ?? sessionsDirForPath(this._path);
        this._nowUnix = options.nowUnix ?? defaultNowUnix;
        this._todayKey = options.todayKey ?? defaultTodayKey;
        this._readBootId = options.readBootId ?? readBootId;
        this._data = emptyData();
        this._sessionDays = {};
        this._sessionPath = null;
        this._dirty = false;
    }

    get path() {
        return this._path;
    }

    get sessionsDir() {
        return this._sessionsDir;
    }

    todayKey() {
        return this._todayKey();
    }

    load() {
        const legacy = this._readUsageFile();
        this._data = legacy ? normalize(legacy) : emptyData();
        this._sessionDays = {};
        this._sessionPath = null;

        this._ensureSession();

        if (Object.keys(this._data.days).length === 0) {
            for (const rec of this._readSessionFiles())
                mergeDayMaps(this._data.days, rec.days);
        }

        const bootId = this._data.bootId;
        const matching = this._readSessionFiles().filter(rec => rec.bootId === bootId);
        if (matching.length > 0) {
            matching.sort((a, b) => a.startedUnix - b.startedUnix);
            const current = matching[matching.length - 1];
            this._data.session.startedUnix = current.startedUnix || this._data.session.startedUnix;
            this._sessionDays = cloneDays(current.days);
            this._data.session.apps = {};
            for (const day of Object.values(this._sessionDays)) {
                for (const [appId, value] of Object.entries(day.apps || {}))
                    addToAppMap(this._data.session.apps, appId, value.name, value.seconds);
            }
            this._sessionPath = current.path;
        } else if (Object.keys(this._data.session.apps || {}).length > 0) {
            const today = this.todayKey();
            this._sessionDays[today] = {apps: {}};
            for (const [appId, value] of Object.entries(this._data.session.apps)) {
                addToAppMap(
                    this._sessionDays[today].apps,
                    appId,
                    value.name,
                    value.seconds);
            }
        }

        this._dirty = false;
    }

    save() {
        this._ensureSession();
        this._pruneDays();
        this._writeUsageFile();
        this._writeCurrentSessionFile();
        this._dirty = false;
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
        if (!this._sessionDays[dayKey])
            this._sessionDays[dayKey] = {apps: {}};

        addToAppMap(this._data.session.apps, appId, appName, amount);
        addToAppMap(this._data.days[dayKey].apps, appId, appName, amount);
        addToAppMap(this._sessionDays[dayKey].apps, appId, appName, amount);
        this._dirty = true;
    }

    listSessions() {
        return this._readSessionFiles().map(rec => ({
            bootId: rec.bootId,
            startedUnix: rec.startedUnix,
            endedUnix: rec.endedUnix,
            path: rec.path,
            seconds: Object.values(rec.days).reduce(
                (sum, day) => sum + dayTotalFromRecord(day), 0),
            dateKeys: Object.keys(rec.days).sort(),
        }));
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

    _readJson(path) {
        try {
            const file = Gio.File.new_for_path(path);
            const [, contents] = file.load_contents(null);
            return JSON.parse(new TextDecoder('utf-8').decode(contents));
        } catch (_error) {
            return null;
        }
    }

    _writeJson(path, payload) {
        const file = Gio.File.new_for_path(path);
        const parent = file.get_parent();
        if (parent && !parent.query_exists(null))
            parent.make_directory_with_parents(null);
        file.replace_contents(
            JSON.stringify(payload, null, 2),
            null,
            false,
            Gio.FileCreateFlags.PRIVATE,
            null);
    }

    _readUsageFile() {
        return this._readJson(this._path);
    }

    _writeUsageFile() {
        try {
            this._writeJson(this._path, this._data);
        } catch (error) {
            console.warn(`Digital Wellbeing: failed to save usage: ${error.message}`);
        }
    }

    _readSessionFiles() {
        const records = [];
        try {
            const dir = Gio.File.new_for_path(this._sessionsDir);
            if (!dir.query_exists(null))
                return records;

            const enumerator = dir.enumerate_children(
                'standard::name',
                Gio.FileQueryInfoFlags.NONE,
                null);
            let info = enumerator.next_file(null);
            while (info) {
                const name = info.get_name();
                info = enumerator.next_file(null);
                if (!name.endsWith('.json'))
                    continue;
                const path = dir.get_child(name).get_path();
                const rec = sessionRecordFromJson(this._readJson(path));
                if (!rec)
                    continue;
                rec.path = path;
                records.push(rec);
            }
            enumerator.close(null);
        } catch (_error) {
        }
        records.sort((a, b) => a.startedUnix - b.startedUnix);
        return records;
    }

    _writeCurrentSessionFile() {
        try {
            const bootId = this._data.bootId || 'unknown';
            const startedUnix = this._data.session.startedUnix || this._nowUnix();
            if (!this._sessionPath) {
                const name = `session-${startedUnix}-${safeBootToken(bootId)}.json`;
                this._sessionPath = GLib.build_filenamev([this._sessionsDir, name]);
            }
            this._writeJson(this._sessionPath, {
                version: SCHEMA_VERSION,
                bootId,
                startedUnix,
                endedUnix: this._nowUnix(),
                days: cloneDays(this._sessionDays),
            });
            this._pruneSessionFiles();
        } catch (error) {
            console.warn(`Digital Wellbeing: failed to save session: ${error.message}`);
        }
    }

    _pruneSessionFiles() {
        const cutoff = parseDateKey(this.todayKey())?.add_days(-KEEP_DAYS);
        if (!cutoff)
            return;
        const cutoffKey = cutoff.format('%F');
        for (const rec of this._readSessionFiles()) {
            const keys = rec.dateKeys || Object.keys(rec.days || {});
            const newest = keys.sort().at(-1);
            if (newest && newest < cutoffKey) {
                try {
                    Gio.File.new_for_path(rec.path).delete(null);
                } catch (_error) {
                }
            }
        }
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
        this._sessionDays = {};
        this._sessionPath = null;
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
