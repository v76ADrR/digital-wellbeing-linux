// SPDX-License-Identifier: GPL-2.0-or-later

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {resolveApp} from './lib/apps.js';
import {AppDonut, ScreenTimeCard} from './lib/charts.js';
import {formatScreenTime} from './lib/duration.js';
import {SessionHistory} from './lib/sessionHistory.js';
import {UsageStore, groupAppsForDonut} from './lib/usageStore.js';

const KEY_SHOW_INDICATOR = 'show-indicator';
const KEY_FORMAT = 'format';

const FORMAT_OPTIONS = [
    {id: 'compact', title: 'Compact', example: '4h 1m'},
    {id: 'clock', title: 'Clock', example: '4:01'},
    {id: 'verbose', title: 'Verbose', example: '4 hours 1 minute'},
];

function loadCss(extensionDir) {
    const file = extensionDir.get_child('prefs.css');
    if (!file.query_exists(null))
        return;

    const provider = new Gtk.CssProvider();
    provider.load_from_file(file);
    Gtk.StyleContext.add_provider_for_display(
        Gdk.Display.get_default(),
        provider,
        Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
}

function pushSubpage(window, page) {
    if (page && typeof window.push_subpage === 'function') {
        window.push_subpage(page);
        return true;
    }
    return false;
}

function rebuildAppList(listBox, apps) {
    let child = listBox.get_first_child();
    while (child) {
        const next = child.get_next_sibling();
        listBox.remove(child);
        child = next;
    }

    if (apps.length === 0) {
        listBox.append(new Adw.ActionRow({
            title: _('No applications yet'),
            subtitle: _('Use your computer with the extension enabled and time will show up here.'),
        }));
        return;
    }

    for (const app of apps) {
        const resolved = resolveApp(app.id, app.name);
        const row = new Adw.ActionRow({
            title: resolved.name,
        });
        const image = new Gtk.Image({pixel_size: 28});
        if (resolved.icon)
            image.gicon = resolved.icon;
        else
            image.icon_name = 'application-x-executable-symbolic';
        row.add_prefix(image);
        row.add_suffix(new Gtk.Label({
            label: formatScreenTime(app.seconds),
            css_classes: ['dim-label'],
        }));
        listBox.append(row);
    }
}

function makeScrolled(child) {
    const scrolled = new Gtk.ScrolledWindow({
        hexpand: true,
        vexpand: true,
        hscrollbar_policy: Gtk.PolicyType.NEVER,
    });
    scrolled.set_child(child);
    return scrolled;
}

function createAppFlow(store, window) {
    const donut = new AppDonut();
    const listBox = new Gtk.ListBox({
        selection_mode: Gtk.SelectionMode.NONE,
        css_classes: ['boxed-list'],
        hexpand: true,
    });

    const detailsBox = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 14,
        css_classes: ['dw-app-page'],
    });
    detailsBox.append(new Gtk.Label({
        label: _('Time is billed to the app that was in front while unlocked. Totals are kept across reboots.'),
        wrap: true,
        xalign: 0,
        css_classes: ['dim-label'],
    }));
    detailsBox.append(listBox);

    const detailsPage = new Adw.NavigationPage({
        title: _('App activity details'),
        can_pop: true,
        child: makeScrolled(detailsBox),
    });

    const button = new Gtk.Button({
        label: _('View app activity details'),
        halign: Gtk.Align.CENTER,
        css_classes: ['pill'],
    });
    button.connect('clicked', () => {
        if (detailsPage.get_parent())
            return;
        pushSubpage(window, detailsPage);
    });

    const donutBox = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 16,
        css_classes: ['dw-app-page'],
    });
    donutBox.append(donut);
    donutBox.append(new Gtk.Label({
        label: _('Focused apps from today. Totals stay after a reboot.'),
        wrap: true,
        justify: Gtk.Justification.CENTER,
        css_classes: ['dim-label', 'dw-hint'],
    }));
    donutBox.append(button);

    const page = new Adw.NavigationPage({
        title: _('App activity'),
        can_pop: true,
        child: makeScrolled(donutBox),
    });

    const refresh = () => {
        const apps = store.getDayApps(store.todayKey());
        const grouped = groupAppsForDonut(apps);
        donut.setModel({
            slices: grouped.slices.map(slice => ({
                ...slice,
                name: slice.isOther ? _('Other') : resolveApp(slice.id, slice.name).name,
            })),
            total: grouped.total,
            centerTitle: _('Today'),
            centerValue: formatScreenTime(grouped.total),
        });
        rebuildAppList(listBox, apps);
        button.sensitive = apps.length > 0;
    };

    return {
        page,
        refresh,
        open() {
            refresh();
            if (page.get_parent())
                return;
            if (!pushSubpage(window, page))
                window.add?.(page);
        },
    };
}

function addDisplayPage(window, settings) {
    const page = new Adw.PreferencesPage({
        title: _('Display'),
        icon_name: 'preferences-system-symbolic',
    });

    const displayGroup = new Adw.PreferencesGroup({
        title: _('Display'),
        description: _('Control the top-bar uptime indicator.'),
    });

    const showRow = new Adw.SwitchRow({
        title: _('Show indicator'),
        subtitle: _('Show machine uptime in the top bar.'),
    });

    const formatModel = new Gtk.StringList();
    for (const option of FORMAT_OPTIONS)
        formatModel.append(`${option.title} (${option.example})`);

    const formatRow = new Adw.ComboRow({
        title: _('Format'),
        subtitle: _('How uptime is written in the panel.'),
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
    const changedId = settings.connect('changed', syncFromSettings);

    showRow.connect('notify::active', () => {
        if (settings.get_boolean(KEY_SHOW_INDICATOR) !== showRow.active)
            settings.set_boolean(KEY_SHOW_INDICATOR, showRow.active);
    });

    formatRow.connect('notify::selected', () => {
        const option = FORMAT_OPTIONS[formatRow.selected] ?? FORMAT_OPTIONS[0];
        if (settings.get_string(KEY_FORMAT) !== option.id)
            settings.set_string(KEY_FORMAT, option.id);
    });

    const aboutGroup = new Adw.PreferencesGroup({
        title: _('About'),
        description: _('The panel shows uptime. The graph is GNOME session screen time; the donut is focused apps.'),
    });

    const sourceRow = new Adw.ActionRow({
        title: _('Uptime source'),
        subtitle: _('/proc/uptime (first field) — seconds since boot, including suspend (CLOCK_BOOTTIME).'),
    });
    const usageRow = new Adw.ActionRow({
        title: _('App usage'),
        subtitle: _('Focused window while unlocked. Browsers count as one app. Data stays on this machine.'),
    });

    displayGroup.add(showRow);
    displayGroup.add(formatRow);
    aboutGroup.add(sourceRow);
    aboutGroup.add(usageRow);
    page.add(displayGroup);
    page.add(aboutGroup);
    window.add(page);

    return changedId;
}

export default class DigitalWellbeingPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        loadCss(this.dir);

        window.title = _('Digital Wellbeing');
        if ('search_enabled' in window)
            window.search_enabled = false;
        if (typeof window.set_default_size === 'function')
            window.set_default_size(640, 720);

        const store = new UsageStore();
        store.load();

        const screenPage = new Adw.PreferencesPage({
            title: _('Screen Time'),
            icon_name: 'org.gnome.Settings-wellbeing-symbolic',
        });

        const group = new Adw.PreferencesGroup({
            title: _('Screen Time'),
            description: _('Active computer time from GNOME, same source as Settings → Wellbeing. Tap the graph for apps.'),
        });

        const sessionHistory = new SessionHistory();
        sessionHistory.load();

        const card = new ScreenTimeCard({store, sessionHistory, gettext: _});
        const row = new Adw.PreferencesRow({
            activatable: false,
            css_classes: ['dw-screen-time-row'],
        });
        row.set_child(card);
        group.add(row);
        screenPage.add(group);
        window.add(screenPage);

        const appFlow = createAppFlow(store, window);
        card.connect('activated', () => appFlow.open());

        let reloadId = 0;
        const reload = () => {
            if (reloadId) {
                GLib.source_remove(reloadId);
                reloadId = 0;
            }
            reloadId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
                reloadId = 0;
                store.load();
                sessionHistory.load();
                card.refresh();
                appFlow.refresh();
                return GLib.SOURCE_REMOVE;
            });
        };

        const monitors = [];
        const watchFile = path => {
            try {
                const file = Gio.File.new_for_path(path);
                const monitor = file.monitor_file(Gio.FileMonitorFlags.NONE, null);
                monitor.connect('changed', (_mon, _f, _other, event) => {
                    if (event === Gio.FileMonitorEvent.CHANGES_DONE_HINT ||
                        event === Gio.FileMonitorEvent.CREATED ||
                        event === Gio.FileMonitorEvent.CHANGED)
                        reload();
                });
                monitors.push(monitor);
            } catch (_error) {
            }
        };
        watchFile(store.path);
        watchFile(sessionHistory.path);

        const pollId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 15, () => {
            store.load();
            sessionHistory.load();
            card.refresh();
            appFlow.refresh();
            return GLib.SOURCE_CONTINUE;
        });

        const settingsChangedId = addDisplayPage(window, settings);

        window.connect('close-request', () => {
            if (reloadId)
                GLib.source_remove(reloadId);
            if (pollId)
                GLib.source_remove(pollId);
            if (settingsChangedId)
                settings.disconnect(settingsChangedId);
            for (const monitor of monitors)
                monitor.cancel();
            return false;
        });
    }
}
