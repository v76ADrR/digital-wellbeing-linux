// SPDX-License-Identifier: GPL-2.0-or-later

import Gio from 'gi://Gio';

export const BREAK_TYPES = Object.freeze(['eyesight', 'movement']);

export const MOVEMENT_SCHEDULES = Object.freeze([
    Object.freeze({duration: 60, interval: 1200}),
    Object.freeze({duration: 120, interval: 1200}),
    Object.freeze({duration: 180, interval: 1800}),
    Object.freeze({duration: 300, interval: 1800}),
]);

const SCHEMA_ID = 'org.gnome.desktop.break-reminders';
const BREAK_KEYS = {
    'interval-seconds': 'u',
    'duration-seconds': 'u',
    'delay-seconds': 'u',
    'fade-screen': 'b',
    'lock-screen': 'b',
    'play-sound': 'b',
    'notify': 'b',
    'notify-upcoming': 'b',
    'notify-overdue': 'b',
    'countdown': 'b',
};

function hasKeys(settings, keys) {
    const schema = settings?.settings_schema;
    return schema && Object.entries(keys).every(([key, type]) =>
        schema.has_key(key) &&
        schema.get_key(key).get_value_type().dup_string() === type);
}

/**
 * A small adapter for the settings consumed by GNOME Shell's break manager.
 * Opening preferences never enables reminders or replaces existing choices.
 */
export class BreakReminderSettings {
    constructor(options = {}) {
        this.available = false;
        this.settings = null;

        try {
            let settings = options.settings;
            if (!settings) {
                const source = Object.hasOwn(options, 'schemaSource')
                    ? options.schemaSource
                    : Gio.SettingsSchemaSource.get_default();
                if (!source)
                    return;

                const schemas = {
                    root: source.lookup(SCHEMA_ID, true),
                    eyesight: source.lookup(`${SCHEMA_ID}.eyesight`, true),
                    movement: source.lookup(`${SCHEMA_ID}.movement`, true),
                };
                if (Object.values(schemas).some(schema => !schema))
                    return;

                settings = Object.fromEntries(Object.entries(schemas).map(
                    ([type, schema]) => [type, new Gio.Settings({settings_schema: schema})]));
            }

            if (!hasKeys(settings.root, {'selected-breaks': 'as'}) ||
                BREAK_TYPES.some(type => !hasKeys(settings[type], BREAK_KEYS)))
                return;

            this.settings = settings;
            this.available = true;
        } catch {
            // Older or incomplete desktop installations still have usable preferences.
        }
    }

    isEnabled(type) {
        return this.available && BREAK_TYPES.includes(type) &&
            this.settings.root.get_strv('selected-breaks').includes(type);
    }

    setEnabled(type, enabled) {
        if (!this.available || !BREAK_TYPES.includes(type) ||
            !this.settings.root.is_writable('selected-breaks'))
            return false;

        const current = this.settings.root.get_strv('selected-breaks');
        if (current.includes(type) === Boolean(enabled))
            return true;

        const selected = enabled
            ? [...current, type]
            : current.filter(item => item !== type);
        return this.settings.root.set_strv('selected-breaks', selected);
    }

    getSoundState() {
        if (!this.available)
            return 'off';

        const sounds = BREAK_TYPES.map(type => this.settings[type].get_boolean('play-sound'));
        if (sounds.every(Boolean))
            return 'on';
        if (sounds.every(sound => !sound))
            return 'off';
        return 'mixed';
    }

    setSoundsEnabled(enabled) {
        if (!this.available ||
            BREAK_TYPES.some(type => !this.settings[type].is_writable('play-sound')))
            return false;

        let success = true;
        for (const type of BREAK_TYPES) {
            if (!this.settings[type].set_boolean('play-sound', Boolean(enabled)))
                success = false;
        }
        return success;
    }

    getMovementScheduleIndex() {
        if (!this.available)
            return -1;

        const movement = this.settings.movement;
        const duration = movement.get_uint('duration-seconds');
        const interval = movement.get_uint('interval-seconds');
        return MOVEMENT_SCHEDULES.findIndex(schedule =>
            schedule.duration === duration && schedule.interval === interval);
    }

    setMovementSchedule(index) {
        if (!this.available || !Number.isInteger(index) ||
            index < 0 || index >= MOVEMENT_SCHEDULES.length)
            return false;

        const movement = this.settings.movement;
        if (!movement.is_writable('duration-seconds') || !movement.is_writable('interval-seconds'))
            return false;

        const schedule = MOVEMENT_SCHEDULES[index];
        const durationSet = movement.set_uint('duration-seconds', schedule.duration);
        const intervalSet = movement.set_uint('interval-seconds', schedule.interval);
        return durationSet && intervalSet;
    }
}
