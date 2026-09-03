// SPDX-License-Identifier: GPL-2.0-or-later

import GLib from 'gi://GLib';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const TICK_SECONDS = 5;
const MAX_ELAPSED_SECONDS = 120;

function isShellApp(id, name) {
    const haystack = `${id || ''} ${name || ''}`.toLowerCase();
    return haystack.includes('org.gnome.shell') ||
        haystack === 'gnome-shell.desktop' ||
        haystack === 'gnome shell';
}

export class UsageTracker {
    constructor(store) {
        this._store = store;
        this._windowTracker = Shell.WindowTracker.get_default();
        this._lastTick = GLib.get_monotonic_time();
        this._lastApp = null;
        this._tickId = 0;
        this._focusId = 0;
        this._destroyed = false;

        this._lastApp = this._currentApp();
        this._focusId = this._windowTracker.connect(
            'notify::focus-app',
            () => this._flush());
        this._tickId = GLib.timeout_add_seconds(
            GLib.PRIORITY_LOW,
            TICK_SECONDS,
            () => {
                if (this._destroyed)
                    return GLib.SOURCE_REMOVE;
                this._flush();
                return GLib.SOURCE_CONTINUE;
            });
    }

    destroy() {
        this._flush();
        this._destroyed = true;
        this._store?.saveIfDirty();

        if (this._tickId) {
            GLib.source_remove(this._tickId);
            this._tickId = 0;
        }
        if (this._focusId && this._windowTracker) {
            this._windowTracker.disconnect(this._focusId);
            this._focusId = 0;
        }

        this._windowTracker = null;
        this._store = null;
        this._lastApp = null;
    }

    _isLocked() {
        try {
            if (Main.sessionMode?.isLocked)
                return true;
            if (Main.screenShield?.locked)
                return true;
        } catch (_error) {
        }
        return false;
    }

    _currentApp() {
        try {
            if (this._isLocked())
                return null;

            const app = this._windowTracker?.focus_app;
            if (!app)
                return null;

            const id = app.get_id() || app.get_name();
            const name = app.get_name() || id;
            if (!id || isShellApp(id, name))
                return null;

            return {id, name};
        } catch (_error) {
            return null;
        }
    }

    _flush() {
        if (this._destroyed || !this._store)
            return;

        const now = GLib.get_monotonic_time();
        const elapsed = Math.min(
            MAX_ELAPSED_SECONDS,
            Math.max(0, Math.floor((now - this._lastTick) / 1_000_000)));
        this._lastTick = now;

        if (elapsed > 0 && this._lastApp)
            this._store.addUsage(this._lastApp.id, this._lastApp.name, elapsed);

        this._lastApp = this._currentApp();
        if (elapsed > 0)
            this._store.saveIfDirty();
    }
}
