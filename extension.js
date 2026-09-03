// SPDX-License-Identifier: GPL-2.0-or-later

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

import {formatUptime} from './lib/duration.js';
import {UsageTracker} from './lib/tracker.js';
import {UsageStore} from './lib/usageStore.js';

const UPTIME_PATH = '/proc/uptime';
const UPDATE_INTERVAL_SECONDS = 15;
const KEY_SHOW_INDICATOR = 'show-indicator';
const KEY_FORMAT = 'format';

function readUptimeSeconds() {
    try {
        const [ok, contents] = GLib.file_get_contents(UPTIME_PATH);
        if (!ok)
            return null;

        const text = new TextDecoder('utf-8').decode(contents).trim();
        const seconds = Number.parseFloat(text.split(/\s+/)[0]);
        if (!Number.isFinite(seconds) || seconds < 0)
            return null;

        return Math.floor(seconds);
    } catch (_error) {
        return null;
    }
}

const UptimeIndicator = GObject.registerClass(
class UptimeIndicator extends PanelMenu.Button {
    _init(settings, openPrefs) {
        super._init(0.0, _('Digital Wellbeing'), true);

        this._settings = settings;
        this._openPrefs = openPrefs;
        this._settingsChangedId = 0;
        this._timeoutId = 0;
        this._clickId = 0;
        this._destroyed = false;
        this._format = 'compact';

        this._label = new St.Label({
            text: '…',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'digital-wellbeing-label',
        });
        this._label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        this.add_child(this._label);

        this._settings.bind(
            KEY_SHOW_INDICATOR, this, 'visible', Gio.SettingsBindFlags.GET);

        this._syncFormat();
        this._settingsChangedId = this._settings.connect(
            `changed::${KEY_FORMAT}`,
            () => this._syncFormat());

        this._clickId = this.connect('button-press-event', (_actor, event) => {
            if (event.get_button() !== Clutter.BUTTON_PRIMARY)
                return Clutter.EVENT_PROPAGATE;
            this._openPrefs?.();
            return Clutter.EVENT_STOP;
        });

        this._update();
        this._timeoutId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            UPDATE_INTERVAL_SECONDS,
            () => {
                if (this._destroyed)
                    return GLib.SOURCE_REMOVE;
                this._update();
                return GLib.SOURCE_CONTINUE;
            });
    }

    _syncFormat() {
        this._format = this._settings.get_string(KEY_FORMAT) || 'compact';
        this._update();
    }

    _update() {
        if (this._destroyed || !this._label)
            return;

        this._label.text = formatUptime(readUptimeSeconds(), this._format);
        this.accessible_name = `${_('Uptime')} ${this._label.text}`;
    }

    destroy() {
        this._destroyed = true;

        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }

        if (this._clickId) {
            this.disconnect(this._clickId);
            this._clickId = 0;
        }

        if (this._settingsChangedId && this._settings) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = 0;
        }

        this._settings = null;
        this._openPrefs = null;
        this._label = null;

        super.destroy();
    }
});

export default class DigitalWellbeingExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._store = new UsageStore();
        this._store.load();
        this._store.saveIfDirty();
        this._tracker = new UsageTracker(this._store);
        this._indicator = new UptimeIndicator(
            this._settings,
            () => this.openPreferences());
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this._tracker?.destroy();
        this._tracker = null;
        this._store?.saveIfDirty();
        this._store = null;
        this._indicator?.destroy();
        this._indicator = null;
        this._settings = null;
    }
}
