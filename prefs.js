// SPDX-License-Identifier: GPL-2.0-or-later

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const KEY_SHOW_INDICATOR = 'show-indicator';
const KEY_FORMAT = 'format';

const FORMAT_OPTIONS = [
    {id: 'compact', title: 'Compact', example: '4h 1m'},
    {id: 'clock', title: 'Clock', example: '4:01'},
    {id: 'verbose', title: 'Verbose', example: '4 hours 1 minute'},
];

export default class DigitalWellbeingPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        window.title = 'Digital Wellbeing';
        window.search_enabled = false;
        window.set_default_size(560, 420);

        const page = new Adw.PreferencesPage({
            title: 'Digital Wellbeing',
            icon_name: 'org.gnome.Settings-wellbeing-symbolic',
        });

        const displayGroup = new Adw.PreferencesGroup({
            title: 'Display',
            description: 'Control the top-bar uptime indicator.',
        });

        const showRow = new Adw.SwitchRow({
            title: 'Show indicator',
            subtitle: 'Show machine uptime in the top bar.',
        });

        const formatModel = new Gtk.StringList();
        for (const option of FORMAT_OPTIONS)
            formatModel.append(`${option.title} (${option.example})`);

        const formatRow = new Adw.ComboRow({
            title: 'Format',
            subtitle: 'How uptime is written in the panel.',
            model: formatModel,
        });

        const formatIndex = id => {
            const index = FORMAT_OPTIONS.findIndex(option => option.id === id);
            return index >= 0 ? index : 0;
        };

        const syncFromSettings = () => {
            const show = settings.get_boolean(KEY_SHOW_INDICATOR);
            if (showRow.active !== show)
                showRow.active = show;

            const selected = formatIndex(settings.get_string(KEY_FORMAT));
            if (formatRow.selected !== selected)
                formatRow.selected = selected;
        };

        syncFromSettings();

        let changedId = settings.connect('changed', syncFromSettings);

        showRow.connect('notify::active', () => {
            if (settings.get_boolean(KEY_SHOW_INDICATOR) !== showRow.active)
                settings.set_boolean(KEY_SHOW_INDICATOR, showRow.active);
        });

        formatRow.connect('notify::selected', () => {
            const option = FORMAT_OPTIONS[formatRow.selected] ?? FORMAT_OPTIONS[0];
            if (settings.get_string(KEY_FORMAT) !== option.id)
                settings.set_string(KEY_FORMAT, option.id);
        });

        window.connect('close-request', () => {
            if (changedId) {
                settings.disconnect(changedId);
                changedId = 0;
            }
            return false;
        });

        const aboutGroup = new Adw.PreferencesGroup({
            title: 'About',
            description: 'v1 shows how long this machine has been on. More wellbeing options come later.',
        });

        const sourceRow = new Adw.ActionRow({
            title: 'Uptime source',
            subtitle: '/proc/uptime (first field) — seconds since boot, including suspend (CLOCK_BOOTTIME).',
        });

        displayGroup.add(showRow);
        displayGroup.add(formatRow);
        aboutGroup.add(sourceRow);
        page.add(displayGroup);
        page.add(aboutGroup);
        window.add(page);
    }
}
