// SPDX-License-Identifier: GPL-2.0-or-later

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';

import {BreakReminderSettings} from '../lib/breakSettings.js';
import {createBreakRemindersPage} from '../lib/breakPreferences.js';

if (GLib.getenv('GSETTINGS_BACKEND') !== 'memory')
    throw new Error('Run this test with GSETTINGS_BACKEND=memory and a GTK display');

Adw.init();

let checked = 0;
function assert(condition, message) {
    if (!condition)
        throw new Error(`FAIL ${message}`);
    checked++;
    print(`ok ${message}`);
}

function find(widget, title) {
    if (widget instanceof Adw.PreferencesRow && widget.title === title)
        return widget;
    for (let child = widget.get_first_child(); child; child = child.get_next_sibling()) {
        const match = find(child, title);
        if (match)
            return match;
    }
    return null;
}

function snapshot(settings) {
    return JSON.stringify(Object.values(settings).map(values =>
        values.settings_schema.list_keys().sort().map(key =>
            [key, values.get_value(key).deep_unpack()])));
}

function flush() {
    const context = GLib.MainContext.default();
    while (context.pending())
        context.iteration(false);
}

const model = new BreakReminderSettings();
assert(model.available, 'native schemas available for GTK integration tests');
const {root, eyesight, movement} = model.settings;
root.set_strv('selected-breaks', ['future-break', 'eyesight']);
movement.set_uint('duration-seconds', 95);
movement.set_uint('interval-seconds', 1500);
eyesight.set_boolean('play-sound', true);
movement.set_boolean('play-sound', false);

let writes = 0;
const watches = Object.values(model.settings).map(settings =>
    [settings, settings.connect('changed', () => writes++)]);
const before = snapshot(model.settings);
const controls = createBreakRemindersPage({model});
const window = new Adw.PreferencesWindow({default_width: 640, default_height: 720});
window.add(controls.page);

const eyesSwitch = find(controls.page, 'Eyesight Reminders');
const movementSwitch = find(controls.page, 'Movement Reminders');
const schedule = find(controls.page, 'Movement Break Schedule');
const sounds = find(controls.page, 'Sounds');
const eyesOptions = find(controls.page, 'Eyesight Options');
const movementOptions = find(controls.page, 'Movement Options');

assert(snapshot(model.settings) === before && writes === 0,
    'opening real GTK controls preserves every native setting without writes');
assert(eyesSwitch.active && !movementSwitch.active, 'switches show existing enabled reminders');
assert(schedule.selected_item.get_string() === 'Custom: 95 seconds / 25 minutes',
    'custom schedule is displayed accurately');
assert(!schedule.sensitive && !movementOptions.sensitive,
    'movement controls are disabled while movement reminders are off');
assert(sounds.active && sounds.subtitle.includes('one reminder'),
    'mixed sounds are represented without homogenizing preferences');

movementSwitch.active = true;
flush();
assert(root.get_strv('selected-breaks').join(',') === 'future-break,eyesight,movement',
    'enabling through the UI preserves other break types');
assert(schedule.sensitive && movementOptions.sensitive, 'enabling unlocks movement options');

schedule.selected = 0;
flush();
assert(movement.get_uint('duration-seconds') === 60 && movement.get_uint('interval-seconds') === 1200,
    'choosing a preset changes both native schedule values');

// A separate instance simulates changes from GNOME Settings while this page is open.
const externalMovement = new Gio.Settings({schema_id: 'org.gnome.desktop.break-reminders.movement'});
const writesBeforeExternal = writes;
externalMovement.set_uint('duration-seconds', 135);
externalMovement.set_uint('interval-seconds', 2700);
flush();
assert(schedule.selected_item.get_string() === 'Custom: 135 seconds / 45 minutes',
    'external schedule changes update the displayed custom choice');
assert(writes === writesBeforeExternal + 2,
    'external synchronization does not write settings back');

const duration = find(movementOptions, 'Break Length (seconds)');
const interval = find(movementOptions, 'Time Between Breaks (seconds)');
const snooze = find(movementOptions, 'Snooze Length (seconds)');
assert(duration.value === 135 && interval.value === 2700, 'custom editors track external values');
duration.value = 75;
interval.value = 2400;
snooze.value = 210;
flush();
assert(movement.get_uint('duration-seconds') === 75 &&
    movement.get_uint('interval-seconds') === 2400 && movement.get_uint('delay-seconds') === 210,
    'custom length, interval, and snooze controls write native settings');

const lock = find(movementOptions, 'Lock Screen');
lock.active = true;
assert(movement.get_boolean('lock-screen'), 'optional locking control writes the movement setting');
externalMovement.set_boolean('lock-screen', false);
flush();
assert(!lock.active, 'external locking changes update the switch');
find(eyesOptions, 'Countdown').active = true;
assert(eyesight.get_boolean('countdown') && !movement.get_boolean('countdown'),
    'advanced choices affect only their own reminder type');

sounds.active = false;
flush();
assert(!eyesight.get_boolean('play-sound') && !movement.get_boolean('play-sound'),
    'common sound switch disables both completion sounds');
const eyeSound = find(eyesOptions, 'Completion Sound');
assert(!eyeSound.active, 'per-type sound row follows the common switch');
eyeSound.active = true;
flush();
assert(sounds.active && sounds.subtitle.includes('one reminder') &&
    !movement.get_boolean('play-sound'), 'per-type sound changes update the common mixed state');
sounds.active = false;
sounds.active = true;
assert(eyesight.get_boolean('play-sound') && movement.get_boolean('play-sound'),
    'common sound switch enables both completion sounds');

root.set_strv('selected-breaks', ['future-break']);
flush();
assert(!eyesSwitch.active && !movementSwitch.active && !sounds.sensitive,
    'external disabling updates both switches and common sound sensitivity');
assert(!eyesOptions.sensitive && !movementOptions.sensitive,
    'external disabling also disables the advanced controls');

controls.destroy();
controls.destroy();
root.set_strv('selected-breaks', ['eyesight', 'movement']);
flush();
assert(!eyesSwitch.active && !movementSwitch.active, 'closing disconnects settings listeners');
window.destroy();

// Values accepted by the native schema must not be clamped or replaced on reopening.
movement.set_uint('interval-seconds', 0xffffffff);
const largeBefore = snapshot(model.settings);
const reopened = createBreakRemindersPage({model});
assert(find(find(reopened.page, 'Movement Options'), 'Time Between Breaks (seconds)').value === 0xffffffff &&
    snapshot(model.settings) === largeBefore, 'reopening preserves even large native custom values');
reopened.destroy();

const unavailable = createBreakRemindersPage({model: new BreakReminderSettings({schemaSource: null})});
assert(find(unavailable.page, 'Break reminders unavailable') !== null,
    'missing desktop schemas produce a usable explanation');
unavailable.destroy();

for (const [settings, id] of watches)
    settings.disconnect(id);

// Optional visual QA, always using the memory backend.
if (ARGV.length > 0) {
    movement.set_uint('duration-seconds', 300);
    movement.set_uint('interval-seconds', 1800);
    eyesight.set_boolean('countdown', false);
    const preview = createBreakRemindersPage({model});
    const previewWindow = new Adw.PreferencesWindow({default_width: 640, default_height: 720});
    previewWindow.add(preview.page);
    previewWindow.present();
    const loop = new GLib.MainLoop(null, false);
    let captureError = null;
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
        try {
            const paintable = new Gtk.WidgetPaintable({widget: previewWindow});
            const view = new Gtk.Snapshot();
            paintable.snapshot(view, previewWindow.get_width(), previewWindow.get_height());
            const texture = previewWindow.get_renderer().render_texture(view.to_node(), null);
            assert(texture.save_to_png(ARGV[0]), 'preferences screenshot saved');
        } catch (error) {
            captureError = error;
        } finally {
            preview.destroy();
            previewWindow.destroy();
            loop.quit();
        }
        return GLib.SOURCE_REMOVE;
    });
    loop.run();
    if (captureError)
        throw captureError;
}

print(`all ${checked} break-preferences tests passed`);
