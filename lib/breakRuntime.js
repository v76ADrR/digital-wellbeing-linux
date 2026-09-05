// SPDX-License-Identifier: GPL-2.0-or-later
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const SCHEMA = 'org.gnome.desktop.break-reminders';
const IDLE_LIMIT = 10_000;

export class BreakReminderRuntime {
    constructor() {
        this._settings = new Gio.Settings({schema_id: SCHEMA});
        this._states = new Map();
        this._last = GLib.get_monotonic_time() / 1e6;
        this._idle = global.backend?.get_core_idle_monitor?.() ?? null;
        this._changed = this._settings.connect('changed', () => this._sync());
        this._sync();
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
            this._tick();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _sync() {
        const selected = new Set(this._settings.get_strv('selected-breaks'));
        for (const type of ['eyesight', 'movement']) {
            if (!selected.has(type)) {
                this._states.delete(type);
                continue;
            }
            const state = this._states.get(type) ?? {active: 0, idle: 0};
            state.interval = Math.max(60, this._settings.get_int(`${type}-interval-seconds`));
            state.duration = Math.max(1, this._settings.get_int(`${type}-duration-seconds`));
            state.notify = this._settings.get_boolean(`${type}-notify`);
            this._states.set(type, state);
        }
    }

    _active() {
        if (Main.sessionMode?.isLocked)
            return false;
        try {
            const idle = this._idle?.get_idletime?.();
            return !Number.isFinite(idle) || idle < IDLE_LIMIT;
        } catch (_error) {
            return true;
        }
    }

    _tick() {
        const now = GLib.get_monotonic_time() / 1e6;
        const elapsed = Math.min(Math.max(now - this._last, 0), 5);
        this._last = now;
        for (const [type, state] of this._states) {
            if (this._active()) {
                state.idle = 0;
                state.active += elapsed;
                if (state.active >= state.interval) {
                    state.active = 0;
                    if (state.notify)
                        this._notify(type, state.duration);
                }
            } else {
                state.idle += elapsed;
                if (state.idle >= state.duration)
                    state.active = 0;
            }
        }
    }

    _notify(type, duration) {
        const title = type === 'eyesight' ? 'Eyesight reminder' : 'Movement reminder';
        const body = type === 'eyesight'
            ? `Look away from the screen for ${duration} seconds.`
            : `Take a movement break for ${duration} seconds.`;
        try {
            if (typeof Main.notify === 'function')
                Main.notify(title, body);
        } catch (error) {
            logError(error, 'Digital Wellbeing reminder notification failed');
        }
    }

    destroy() {
        if (this._timer) GLib.source_remove(this._timer);
        if (this._changed) this._settings.disconnect(this._changed);
        this._timer = 0;
        this._changed = 0;
        this._states.clear();
    }
}
