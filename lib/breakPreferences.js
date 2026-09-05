// SPDX-License-Identifier: GPL-2.0-or-later

import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';

import {BREAK_TYPES, BreakReminderSettings, MOVEMENT_SCHEDULES} from './breakSettings.js';

function formatSeconds(seconds, _) {
    if (seconds % 3600 === 0) {
        const hours = seconds / 3600;
        return hours === 1 ? _('1 hour') : _('%d hours').replace('%d', hours);
    }
    if (seconds % 60 === 0) {
        const minutes = seconds / 60;
        return minutes === 1 ? _('1 minute') : _('%d minutes').replace('%d', minutes);
    }
    return _('%d seconds').replace('%d', seconds);
}

/** Build native reminder controls without changing any settings on opening. */
export function createBreakRemindersPage({
    model = new BreakReminderSettings(),
    gettext: _ = string => string,
} = {}) {
    const page = new Adw.PreferencesPage({
        title: _('Break Reminders'),
        icon_name: 'alarm-symbolic',
    });
    const connections = [];
    let disposed = false;
    let syncing = false;
    let syncId = 0;
    const connect = (object, signal, callback) => {
        connections.push([object, object.connect(signal, callback)]);
    };
    const destroy = () => {
        if (disposed)
            return;
        disposed = true;
        if (syncId) {
            GLib.source_remove(syncId);
            syncId = 0;
        }
        for (const [object, id] of connections)
            object.disconnect(id);
        connections.length = 0;
    };

    if (!model.available) {
        const group = new Adw.PreferencesGroup();
        group.add(new Adw.ActionRow({
            title: _('Break reminders unavailable'),
            subtitle: _('This desktop does not provide the GNOME break reminder settings.'),
        }));
        page.add(group);
        return {page, destroy};
    }

    const group = new Adw.PreferencesGroup({
        title: _('Break Reminders'),
        description: _('Take regular breaks to look away from the screen and move around. These reminders are shared with Settings → Wellbeing.'),
    });
    const enabledRows = {
        eyesight: new Adw.SwitchRow({
            title: _('Eyesight Reminders'),
            subtitle: _('Reminders to look away from the screen'),
        }),
        movement: new Adw.SwitchRow({
            title: _('Movement Reminders'),
            subtitle: _('Reminders to move around'),
        }),
    };
    for (const type of BREAK_TYPES)
        group.add(enabledRows[type]);

    const scheduleRow = new Adw.ComboRow({
        title: _('Movement Break Schedule'),
        subtitle: _('Break length / time between breaks'),
    });
    group.add(scheduleRow);

    const soundsRow = new Adw.SwitchRow({
        title: _('Sounds'),
        subtitle: _('Play a sound when a break ends'),
    });
    group.add(soundsRow);
    page.add(group);

    const advancedGroup = new Adw.PreferencesGroup({
        title: _('More Options'),
        description: _('Customize each reminder. Time away from the keyboard and mouse can count as a break automatically.'),
    });
    const advancedRows = {};
    const numericRows = {};
    const booleanRows = {};
    for (const type of BREAK_TYPES) {
        const expander = new Adw.ExpanderRow({
            title: type === 'eyesight' ? _('Eyesight Options') : _('Movement Options'),
        });
        advancedRows[type] = expander;
        numericRows[type] = {};
        booleanRows[type] = {};

        for (const [key, title] of [
            ['duration-seconds', _('Break Length (seconds)')],
            ['interval-seconds', _('Time Between Breaks (seconds)')],
            ['delay-seconds', _('Snooze Length (seconds)')],
        ]) {
            const row = new Adw.SpinRow({
                title,
                adjustment: new Gtk.Adjustment({
                    lower: 10,
                    upper: 0xffffffff,
                    step_increment: 10,
                    page_increment: 60,
                }),
                digits: 0,
                numeric: true,
                update_policy: Gtk.SpinButtonUpdatePolicy.IF_VALID,
            });
            numericRows[type][key] = row;
            expander.add_row(row);
        }

        for (const [key, title, subtitle] of [
            ['play-sound', _('Completion Sound'), _('Play a sound when this break ends')],
            ['fade-screen', _('Dim Screen'), _('Dim the screen while taking a break')],
            ['lock-screen', _('Lock Screen'), _('Lock when taking a break; you will need to unlock to return')],
            ['notify', _('Break Notifications'), _('Notify when a break is due')],
            ['notify-upcoming', _('Upcoming Reminder'), _('Notify two minutes before a break is due')],
            ['notify-overdue', _('Overdue Reminder'), _('Remind again when a break is overdue')],
            ['countdown', _('Countdown'), _('Show a countdown during the last minute before a break')],
        ]) {
            const row = new Adw.SwitchRow({title, subtitle});
            booleanRows[type][key] = row;
            expander.add_row(row);
        }
        advancedGroup.add(expander);
    }
    page.add(advancedGroup);

    const scheduleLabel = (duration, interval) =>
        `${formatSeconds(duration, _)} / ${formatSeconds(interval, _)}`;
    let scheduleLabels = '';
    const sync = () => {
        if (disposed || syncing)
            return;
        syncing = true;
        try {
            const rootWritable = model.settings.root.is_writable('selected-breaks');
            for (const type of BREAK_TYPES) {
                const settings = model.settings[type];
                const enabled = model.isEnabled(type);
                enabledRows[type].active = enabled;
                enabledRows[type].sensitive = rootWritable;
                advancedRows[type].sensitive = enabled;
                advancedRows[type].subtitle = scheduleLabel(
                    settings.get_uint('duration-seconds'),
                    settings.get_uint('interval-seconds'));

                for (const [key, row] of Object.entries(numericRows[type])) {
                    const seconds = settings.get_uint(key);
                    row.value = seconds;
                    row.subtitle = formatSeconds(seconds, _);
                    row.sensitive = settings.is_writable(key);
                }
                for (const [key, row] of Object.entries(booleanRows[type])) {
                    row.active = settings.get_boolean(key);
                    row.sensitive = settings.is_writable(key);
                }
            }

            const movement = model.settings.movement;
            const index = model.getMovementScheduleIndex();
            const labels = MOVEMENT_SCHEDULES.map(({duration, interval}) =>
                scheduleLabel(duration, interval));
            if (index < 0) {
                const custom = scheduleLabel(
                    movement.get_uint('duration-seconds'),
                    movement.get_uint('interval-seconds'));
                labels.push(_('Custom: %s').replace('%s', custom));
            }
            // Keep an open dropdown stable when unrelated settings change.
            const signature = JSON.stringify(labels);
            if (signature !== scheduleLabels) {
                scheduleRow.model = Gtk.StringList.new(labels);
                scheduleLabels = signature;
            }
            scheduleRow.selected = index < 0 ? labels.length - 1 : index;
            scheduleRow.sensitive = model.isEnabled('movement') &&
                movement.is_writable('duration-seconds') &&
                movement.is_writable('interval-seconds');

            const soundState = model.getSoundState();
            soundsRow.active = soundState !== 'off';
            soundsRow.subtitle = soundState === 'mixed'
                ? _('Sound is enabled for one reminder. This switch controls both.')
                : _('Play a sound when a break ends');
            soundsRow.sensitive = BREAK_TYPES.some(type => model.isEnabled(type)) &&
                BREAK_TYPES.every(type => model.settings[type].is_writable('play-sound'));
        } finally {
            syncing = false;
        }
    };

    // ComboRow may still be using its selection model inside notify::selected.
    // Update the rows after that signal finishes, and coalesce preset key changes.
    const queueSync = () => {
        if (disposed || syncId)
            return;
        syncId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            syncId = 0;
            sync();
            return GLib.SOURCE_REMOVE;
        });
    };

    const write = action => {
        if (disposed || syncing)
            return;
        syncing = true;
        try {
            action();
        } finally {
            syncing = false;
            queueSync();
        }
    };

    for (const type of BREAK_TYPES) {
        const settings = model.settings[type];
        connect(enabledRows[type], 'notify::active', () => write(() =>
            model.setEnabled(type, enabledRows[type].active)));
        for (const [key, row] of Object.entries(numericRows[type])) {
            connect(row, 'notify::value', () => write(() => {
                if (settings.is_writable(key))
                    settings.set_uint(key, Math.round(row.value));
            }));
        }
        for (const [key, row] of Object.entries(booleanRows[type])) {
            connect(row, 'notify::active', () => write(() => {
                if (settings.is_writable(key))
                    settings.set_boolean(key, row.active);
            }));
        }
    }
    connect(scheduleRow, 'notify::selected', () => write(() =>
        model.setMovementSchedule(scheduleRow.selected)));
    connect(soundsRow, 'notify::active', () => write(() =>
        model.setSoundsEnabled(soundsRow.active)));

    for (const settings of Object.values(model.settings)) {
        connect(settings, 'changed', queueSync);
        connect(settings, 'writable-changed', queueSync);
    }
    sync();
    return {page, destroy};
}
