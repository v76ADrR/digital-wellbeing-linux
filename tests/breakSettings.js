// SPDX-License-Identifier: GPL-2.0-or-later

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {BREAK_TYPES, BreakReminderSettings, MOVEMENT_SCHEDULES} from '../lib/breakSettings.js';

// Refuse to write to the user's preferences if this test is invoked incorrectly.
if (GLib.getenv('GSETTINGS_BACKEND') !== 'memory')
    throw new Error('Run with GSETTINGS_BACKEND=memory gjs -m tests/breakSettings.js');

let failed = 0;
let checked = 0;

function assert(condition, message) {
    checked++;
    if (condition) {
        print(`ok ${message}`);
        return;
    }
    failed++;
    printerr(`FAIL ${message}`);
}

function snapshot(settings) {
    return Object.fromEntries(Object.entries(settings).map(([type, values]) => [type,
        Object.fromEntries(values.settings_schema.list_keys().sort().map(key =>
            [key, values.get_value(key).deep_unpack()])),
    ]));
}

function same(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
}

const source = Gio.SettingsSchemaSource.get_default();
const schemaIds = ['org.gnome.desktop.break-reminders',
    ...BREAK_TYPES.map(type => `org.gnome.desktop.break-reminders.${type}`)];
if (schemaIds.some(id => !source?.lookup(id, true)))
    throw new Error('Tests require the GNOME desktop break-reminder schemas');

const settings = Object.fromEntries(['root', ...BREAK_TYPES].map((type, index) =>
    [type, new Gio.Settings({schema_id: schemaIds[index]})]));

settings.root.set_strv('selected-breaks', ['future-break', 'eyesight']);
settings.eyesight.set_boolean('play-sound', true);
settings.movement.set_boolean('play-sound', false);
settings.movement.set_uint('duration-seconds', 95);
settings.movement.set_uint('interval-seconds', 1500);
const before = snapshot(settings);
const model = new BreakReminderSettings({settings});

assert(model.available, 'native reminder settings are available');
assert(model.settings === settings, 'native settings are exposed for UI bindings');
assert(model.isEnabled('eyesight') && !model.isEnabled('movement'), 'enabled state follows selected breaks');
assert(!model.isEnabled('future-break'), 'only supported break types can be queried');
assert(model.getSoundState() === 'mixed', 'different per-break sounds report mixed');
assert(model.getMovementScheduleIndex() === -1, 'custom movement schedule is recognized');
assert(same(snapshot(settings), before), 'construction and reads preserve all preferences');

assert(model.setEnabled('movement', true), 'movement reminders can be enabled');
assert(same(settings.root.get_strv('selected-breaks'), ['future-break', 'eyesight', 'movement']),
    'enabling preserves unknown and other break types');
assert(model.setEnabled('movement', true), 'enabling an enabled reminder is accepted');
assert(same(settings.root.get_strv('selected-breaks'), ['future-break', 'eyesight', 'movement']),
    'repeated enabling does not duplicate entries');
assert(model.setEnabled('eyesight', false), 'eyesight reminders can be disabled');
assert(same(settings.root.get_strv('selected-breaks'), ['future-break', 'movement']),
    'disabling preserves unknown and other break types');
assert(!model.setEnabled('future-break', false), 'unknown break types are not modified');

settings.root.set_strv('selected-breaks', ['eyesight', 'future-break']);
assert(model.isEnabled('eyesight') && !model.isEnabled('movement'), 'external enable changes are reflected');

assert(model.setSoundsEnabled(true), 'sounds can be enabled for both reminders');
assert(model.getSoundState() === 'on', 'all enabled sounds report on');
assert(BREAK_TYPES.every(type => settings[type].get_boolean('play-sound')), 'sound updates reach both native settings');
assert(model.setSoundsEnabled(false), 'sounds can be disabled for both reminders');
assert(model.getSoundState() === 'off', 'all disabled sounds report off');
settings.movement.set_boolean('play-sound', true);
assert(model.getSoundState() === 'mixed', 'external sound changes are reflected');
settings.eyesight.set_boolean('play-sound', true);
assert(model.getSoundState() === 'on', 'external sound changes can restore on state');

const unrelated = snapshot(settings);
for (let index = 0; index < MOVEMENT_SCHEDULES.length; index++) {
    assert(model.setMovementSchedule(index), `movement schedule ${index} can be selected`);
    assert(settings.movement.get_uint('duration-seconds') === MOVEMENT_SCHEDULES[index].duration &&
        settings.movement.get_uint('interval-seconds') === MOVEMENT_SCHEDULES[index].interval &&
        model.getMovementScheduleIndex() === index, `movement schedule ${index} writes matching duration and interval`);
}
const afterSchedule = snapshot(settings);
delete unrelated.movement['duration-seconds'];
delete unrelated.movement['interval-seconds'];
delete afterSchedule.movement['duration-seconds'];
delete afterSchedule.movement['interval-seconds'];
assert(same(unrelated, afterSchedule), 'movement presets preserve all unrelated preferences');

settings.movement.set_uint('duration-seconds', 135);
settings.movement.set_uint('interval-seconds', 2700);
assert(model.getMovementScheduleIndex() === -1, 'external custom schedule is reflected without coercion');
const beforeInvalid = snapshot(settings);
for (const index of [-1, MOVEMENT_SCHEDULES.length, 1.5, '0', NaN])
    assert(!model.setMovementSchedule(index), `invalid movement index ${index} is rejected`);
assert(same(beforeInvalid, snapshot(settings)), 'invalid preset requests leave preferences intact');

// Wrap one real settings instance so policy locks can be tested with the memory backend.
function lockedSettings(values, lockedKeys) {
    return {
        settings_schema: values.settings_schema,
        is_writable: key => !lockedKeys.includes(key) && values.is_writable(key),
        get_strv: key => values.get_strv(key),
        set_strv: (key, value) => values.set_strv(key, value),
        get_uint: key => values.get_uint(key),
        set_uint: (key, value) => values.set_uint(key, value),
        get_boolean: key => values.get_boolean(key),
        set_boolean: (key, value) => values.set_boolean(key, value),
    };
}

const locked = new BreakReminderSettings({settings: {
    root: lockedSettings(settings.root, ['selected-breaks']),
    eyesight: settings.eyesight,
    movement: lockedSettings(settings.movement, ['play-sound', 'interval-seconds']),
}});
const beforeLocked = snapshot(settings);
assert(!locked.setEnabled('movement', true), 'policy-locked enable state is respected');
assert(!locked.setSoundsEnabled(false), 'a sound policy lock blocks the combined update');
assert(!locked.setMovementSchedule(0), 'an interval policy lock blocks the whole preset update');
assert(same(beforeLocked, snapshot(settings)), 'policy locks prevent partial writes');

const native = new BreakReminderSettings();
assert(native.available, 'default construction discovers installed schemas');
assert(native.getMovementScheduleIndex() === -1 && native.getSoundState() === 'on',
    'discovered native settings share the existing backend values');

const unavailable = new BreakReminderSettings({schemaSource: null});
assert(!unavailable.available && unavailable.settings === null, 'missing schema source is unavailable');
assert(!unavailable.isEnabled('eyesight') && unavailable.getSoundState() === 'off' &&
    unavailable.getMovementScheduleIndex() === -1, 'unavailable settings can be read safely');
assert(!unavailable.setEnabled('eyesight', true) && !unavailable.setSoundsEnabled(true) &&
    !unavailable.setMovementSchedule(0), 'unavailable settings reject writes safely');
assert(!new BreakReminderSettings({schemaSource: {lookup: () => null}}).available,
    'missing schema is unavailable without constructing invalid settings');
assert(!new BreakReminderSettings({settings: {...settings, eyesight: settings.root}}).available,
    'missing reminder keys are detected before use');
assert(!new BreakReminderSettings({settings: {...settings, movement: null}}).available,
    'missing settings instance is detected before use');

if (failed > 0)
    throw new Error(`${failed} of ${checked} break-settings tests failed`);

print(`all ${checked} break-settings tests passed`);
