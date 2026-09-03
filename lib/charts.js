// SPDX-License-Identifier: GPL-2.0-or-later

import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk?version=4.0';
import Pango from 'gi://Pango';
import PangoCairo from 'gi://PangoCairo';

import {barIndexAt, barLayout} from './chartLayout.js';
import {formatScreenTime} from './duration.js';

function lookupRgba(widget, name, fallback) {
    try {
        const result = widget.get_style_context().lookup_color(name);
        if (Array.isArray(result)) {
            const [ok, color] = result;
            if (ok && color)
                return [color.red, color.green, color.blue, color.alpha];
        } else if (result && typeof result.red === 'number') {
            return [result.red, result.green, result.blue, result.alpha];
        }
    } catch (_error) {
    }
    return fallback;
}

function mixRgba(a, b, t) {
    return [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
        (a[3] ?? 1) + ((b[3] ?? 1) - (a[3] ?? 1)) * t,
    ];
}

function hashAppId(id) {
    let hash = 2166136261;
    for (const ch of String(id)) {
        hash ^= ch.charCodeAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return Math.abs(hash);
}

/** Slice colors from Adwaita named colors (accent / success / warning / …). */
export function themeSlicePalette(widget) {
    const accent = lookupRgba(widget, 'accent_bg_color', [0.55, 0.36, 0.85, 1]);
    const success = lookupRgba(
        widget, 'success_bg_color',
        lookupRgba(widget, 'success_color', [0.30, 0.69, 0.47, 1]));
    const warning = lookupRgba(
        widget, 'warning_bg_color',
        lookupRgba(widget, 'warning_color', [0.90, 0.66, 0.16, 1]));
    const destructive = lookupRgba(
        widget, 'destructive_bg_color',
        lookupRgba(widget, 'destructive_color', [0.88, 0.30, 0.30, 1]));
    const white = [1, 1, 1, 1];
    const black = [0, 0, 0, 1];
    return [
        accent,
        mixRgba(accent, white, 0.28),
        mixRgba(accent, black, 0.22),
        success,
        warning,
        destructive,
        mixRgba(accent, success, 0.45),
        mixRgba(accent, warning, 0.40),
    ];
}

export function colorForApp(id, widget) {
    const palette = themeSlicePalette(widget);
    return palette[hashAppId(id) % palette.length];
}

export function otherSliceColor(widget) {
    const fg = lookupRgba(widget, 'window_fg_color', [0.3, 0.3, 0.3, 1]);
    return [fg[0], fg[1], fg[2], 0.30];
}

function drawText(cr, text, x, y, options = {}) {
    const layout = PangoCairo.create_layout(cr);
    const size = options.size ?? 11;
    let desc;
    if (options.widget) {
        try {
            desc = options.widget.get_pango_context().get_font_description().copy();
        } catch (_error) {
            desc = null;
        }
    }
    if (!desc)
        desc = Pango.FontDescription.from_string('Sans');
    desc.set_size(Math.round(size * Pango.SCALE));
    if (options.bold)
        desc.set_weight(Pango.Weight.BOLD);
    layout.set_font_description(desc);
    layout.set_text(String(text), -1);
    const [, ext] = layout.get_pixel_extents();
    let dx = 0;
    if (options.align === 'center')
        dx = -ext.width / 2;
    else if (options.align === 'right')
        dx = -ext.width;
    cr.save();
    cr.setSourceRGBA(...(options.color ?? [0, 0, 0, 0.7]));
    cr.moveTo(x + dx, y);
    PangoCairo.show_layout(cr, layout);
    cr.restore();
    return ext;
}

function roundedTopBar(cr, x, y, width, height, radius) {
    if (height <= 0 || width <= 0)
        return;
    const r = Math.min(radius, width / 2, height);
    cr.newPath();
    if (r <= 0.5) {
        cr.rectangle(x, y, width, height);
        return;
    }
    cr.moveTo(x, y + height);
    cr.lineTo(x, y + r);
    cr.arc(x + r, y + r, r, Math.PI, 1.5 * Math.PI);
    cr.lineTo(x + width - r, y);
    cr.arc(x + width - r, y + r, r, 1.5 * Math.PI, 2 * Math.PI);
    cr.lineTo(x + width, y + height);
    cr.closePath();
}

function readDailyLimitSeconds() {
    try {
        const settings = new Gio.Settings({schema_id: 'org.gnome.desktop.screen-time-limits'});
        const seconds = settings.get_uint('daily-limit-seconds');
        if (seconds > 0)
            return seconds;
    } catch (_error) {
    }
    return 8 * 3600;
}

function colorSwatch(rgba) {
    const area = new Gtk.DrawingArea({
        width_request: 14,
        height_request: 14,
        valign: Gtk.Align.CENTER,
        css_classes: ['dw-legend-swatch'],
    });
    area.set_draw_func((_area, cr, width, height) => {
        try {
            const r = Math.min(width, height) / 2;
            cr.arc(width / 2, height / 2, r, 0, 2 * Math.PI);
            cr.setSourceRGBA(rgba[0], rgba[1], rgba[2], rgba[3] ?? 1);
            cr.fill();
        } finally {
            cr.$dispose?.();
        }
    });
    return area;
}

export const ScreenTimeCard = GObject.registerClass({
    GTypeName: 'DigitalWellbeingScreenTimeCard',
    Signals: {
        'activated': {param_types: [GObject.TYPE_STRING]},
    },
}, class ScreenTimeCard extends Gtk.Box {
    _init(params = {}) {
        const store = params.store;
        const gettextFn = params.gettext;
        super._init({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 14,
            hexpand: true,
        });

        this._store = store;
        this._sessionHistory = params.sessionHistory || null;
        this._ = gettextFn || (string => string);
        this._weekOffset = 0;
        this._bars = [];
        this._selectedDateKey = null;
        this._goalSeconds = readDailyLimitSeconds();
        this._yMaxHours = 16;

        this._build();
        this.refresh();
    }

    _build() {
        const grid = new Gtk.Grid({
            column_spacing: 24,
            row_spacing: 2,
            column_homogeneous: true,
            hexpand: true,
        });

        this._todayTitle = new Gtk.Label({
            label: this._('Today'),
            xalign: 0,
            css_classes: ['dim-label', 'dw-stat-caption'],
        });
        this._todayValue = new Gtk.Label({
            label: '0m',
            xalign: 0,
            css_classes: ['dw-primary-value'],
        });
        this._todayAvgCaption = new Gtk.Label({
            xalign: 0,
            css_classes: ['dim-label', 'dw-stat-caption'],
        });
        this._todayAvgValue = new Gtk.Label({
            xalign: 0,
            css_classes: ['dim-label'],
        });

        this._weekTitle = new Gtk.Label({
            label: this._('This Week'),
            xalign: 0,
            css_classes: ['dim-label', 'dw-stat-caption'],
        });
        this._weekValue = new Gtk.Label({
            label: '0m',
            xalign: 0,
            css_classes: ['dw-primary-value'],
        });
        this._weekAvgCaption = new Gtk.Label({
            label: this._('AVERAGE WEEK'),
            xalign: 0,
            css_classes: ['dim-label', 'dw-stat-caption'],
        });
        this._weekAvgValue = new Gtk.Label({
            xalign: 0,
            css_classes: ['dim-label'],
        });

        grid.attach(this._todayTitle, 0, 0, 1, 1);
        grid.attach(this._weekTitle, 1, 0, 1, 1);
        grid.attach(this._todayValue, 0, 1, 1, 1);
        grid.attach(this._weekValue, 1, 1, 1, 1);
        grid.attach(this._todayAvgCaption, 0, 2, 1, 1);
        grid.attach(this._weekAvgCaption, 1, 2, 1, 1);
        grid.attach(this._todayAvgValue, 0, 3, 1, 1);
        grid.attach(this._weekAvgValue, 1, 3, 1, 1);
        this.append(grid);

        this._chart = new Gtk.DrawingArea({
            hexpand: true,
            vexpand: true,
            height_request: 220,
            can_focus: true,
            tooltip_text: this._('View apps used on a day'),
        });
        this._chart.set_draw_func((_area, cr, width, height) => {
            try {
                this._drawChart(cr, width, height);
            } finally {
                cr.$dispose?.();
            }
        });
        this._chart.set_cursor(Gdk.Cursor.new_from_name('pointer', null));

        const click = new Gtk.GestureClick();
        click.connect('released', (_gesture, _nPress, x, y) => {
            const width = this._chart.get_width();
            const height = this._chart.get_height();
            const index = barIndexAt(x, y, width, height, this._bars.length);
            const bar = index >= 0 ? this._bars[index] : null;
            if (!bar?.dateKey)
                return;
            this._selectedDateKey = bar.dateKey;
            this._chart.queue_draw();
            this.emit('activated', bar.dateKey);
        });
        this._chart.add_controller(click);
        this.append(this._chart);

        const nav = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 18,
            halign: Gtk.Align.CENTER,
        });
        this._prevButton = new Gtk.Button({
            icon_name: 'go-previous-symbolic',
            css_classes: ['circular', 'flat'],
            tooltip_text: this._('Previous week'),
        });
        this._nextButton = new Gtk.Button({
            icon_name: 'go-next-symbolic',
            css_classes: ['circular', 'flat'],
            tooltip_text: this._('Next week'),
        });
        this._prevButton.connect('clicked', () => {
            this._weekOffset -= 1;
            this._selectedDateKey = null;
            this.refresh();
        });
        this._nextButton.connect('clicked', () => {
            this._weekOffset = Math.min(0, this._weekOffset + 1);
            this._selectedDateKey = null;
            this.refresh();
        });
        nav.append(this._prevButton);
        nav.append(this._nextButton);
        this.append(nav);

        this.append(new Gtk.Label({
            label: this._('Tap a day to see apps from that day'),
            wrap: true,
            css_classes: ['dim-label', 'dw-hint'],
        }));
    }

    refresh() {
        const source = this._sessionHistory || this._store;
        const week = source.getWeek(this._weekOffset);
        this._bars = week.bars;
        this._goalSeconds = readDailyLimitSeconds();

        const maxSeconds = Math.max(
            this._goalSeconds,
            ...week.bars.map(bar => bar.seconds));
        this._yMaxHours = 16;
        if (maxSeconds > 16 * 3600)
            this._yMaxHours = Math.ceil(maxSeconds / 3600 / 2) * 2;

        this._todayTitle.label = this._('Today');
        this._todayValue.label = formatScreenTime(week.todaySeconds);
        this._todayAvgCaption.label = `${this._('AVERAGE')} ${week.todayWeekdayName.toUpperCase()}`;
        this._todayAvgValue.label = formatScreenTime(week.todayAverage);

        this._weekTitle.label = week.isCurrentWeek ? this._('This Week') : this._('Week');
        this._weekValue.label = formatScreenTime(week.weekTotal);
        this._weekAvgCaption.label = this._('AVERAGE WEEK');
        this._weekAvgValue.label = week.weekAverage > 0
            ? formatScreenTime(week.weekAverage)
            : '0h';

        this._prevButton.sensitive = week.canGoBack;
        this._nextButton.sensitive = week.canGoForward;
        this._chart.queue_draw();

        try {
            const summary = `${formatScreenTime(week.todaySeconds)} ${this._('today')}, ${formatScreenTime(week.weekTotal)} ${this._('this week')}`;
            this.update_property([Gtk.AccessibleProperty.LABEL], [summary]);
        } catch (_error) {
        }
    }

    _drawChart(cr, width, height) {
        const fg = lookupRgba(this._chart, 'window_fg_color', [0.2, 0.2, 0.2, 1]);
        const dim = lookupRgba(this._chart, 'dim_label_color', [...fg.slice(0, 3), 0.55]);
        const accent = lookupRgba(this._chart, 'accent_bg_color', [0.55, 0.36, 0.85, 1]);
        const layout = barLayout(width, height, this._bars.length);
        const {left, right, top, plotWidth, plotHeight, gap, barWidth} = layout;
        const yMaxSeconds = this._yMaxHours * 3600;

        cr.setLineWidth(1);
        for (let hour = 0; hour <= this._yMaxHours; hour += 2) {
            const y = top + plotHeight * (1 - hour / this._yMaxHours);
            cr.setSourceRGBA(fg[0], fg[1], fg[2], 0.10);
            cr.moveTo(left, y);
            cr.lineTo(width - right, y);
            cr.stroke();
            drawText(cr, `${hour}h`, left - 6, y - 7, {
                size: 9,
                align: 'right',
                color: dim,
                widget: this._chart,
            });
        }

        const goalY = top + plotHeight * (1 - this._goalSeconds / yMaxSeconds);
        if (this._goalSeconds > 0 && this._goalSeconds <= yMaxSeconds) {
            cr.setSourceRGBA(fg[0], fg[1], fg[2], 0.45);
            cr.setDash([5, 5], 0);
            cr.moveTo(left, goalY);
            cr.lineTo(width - right, goalY);
            cr.stroke();
            cr.setDash([], 0);
        }

        const radius = Math.min(8, barWidth / 2);

        this._bars.forEach((bar, index) => {
            const x = left + index * (barWidth + gap);
            const barHeight = plotHeight * Math.min(1, bar.seconds / yMaxSeconds);
            const y = top + plotHeight - barHeight;
            const selected = this._selectedDateKey
                ? bar.dateKey === this._selectedDateKey
                : bar.isToday;
            if (selected)
                cr.setSourceRGBA(accent[0], accent[1], accent[2], 1);
            else
                cr.setSourceRGBA(accent[0], accent[1], accent[2], 0.38);
            roundedTopBar(cr, x, y, barWidth, Math.max(barHeight, bar.seconds > 0 ? 2 : 0), radius);
            cr.fill();

            drawText(cr, bar.letter, x + barWidth / 2, height - 22, {
                size: 11,
                align: 'center',
                color: dim,
                bold: selected,
                widget: this._chart,
            });
        });
    }
});

export const AppDonut = GObject.registerClass({
    GTypeName: 'DigitalWellbeingAppDonut',
}, class AppDonut extends Gtk.Box {
    _init() {
        super._init({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 14,
            hexpand: true,
            css_classes: ['dw-donut'],
        });

        this._slices = [];
        this._total = 0;
        this._resolvedColors = [];

        // Same caption + primary value pattern as ScreenTimeCard (above the chart).
        this._titleLabel = new Gtk.Label({
            label: '',
            xalign: 0,
            css_classes: ['dim-label', 'dw-stat-caption'],
        });
        this._valueLabel = new Gtk.Label({
            label: '0m',
            xalign: 0,
            css_classes: ['dw-primary-value'],
        });
        this.append(this._titleLabel);
        this.append(this._valueLabel);

        this._chart = new Gtk.DrawingArea({
            hexpand: true,
            height_request: 220,
            width_request: 220,
            halign: Gtk.Align.CENTER,
            css_classes: ['dw-donut-chart'],
        });
        this._chart.set_draw_func((_area, cr, width, height) => {
            try {
                this._drawRing(cr, width, height);
            } finally {
                cr.$dispose?.();
            }
        });
        this.append(this._chart);

        this._legend = new Gtk.ListBox({
            selection_mode: Gtk.SelectionMode.NONE,
            css_classes: ['boxed-list', 'dw-donut-legend'],
            hexpand: true,
            visible: false,
        });
        this.append(this._legend);
    }

    setModel({slices = [], total = 0, centerTitle = '', centerValue = ''} = {}) {
        this._slices = slices;
        this._total = total;
        this._titleLabel.label = centerTitle || '';
        this._valueLabel.label = centerValue || '0m';
        this._resolveColors();
        this._rebuildLegend();
        this._chart.queue_draw();
        try {
            this.update_property(
                [Gtk.AccessibleProperty.LABEL],
                [`${centerTitle} ${centerValue}`]);
        } catch (_error) {
        }
    }

    _resolveColors() {
        this._resolvedColors = this._slices.map(slice => {
            if (slice.color)
                return slice.color;
            if (slice.isOther)
                return otherSliceColor(this._chart);
            return colorForApp(slice.id, this._chart);
        });
    }

    _rebuildLegend() {
        let child = this._legend.get_first_child();
        while (child) {
            const next = child.get_next_sibling();
            this._legend.remove(child);
            child = next;
        }

        if (this._slices.length === 0) {
            this._legend.visible = false;
            return;
        }

        this._slices.forEach((slice, index) => {
            const row = new Gtk.ListBoxRow({activatable: false});
            const box = new Gtk.Box({
                orientation: Gtk.Orientation.HORIZONTAL,
                spacing: 12,
                margin_start: 12,
                margin_end: 12,
                margin_top: 8,
                margin_bottom: 8,
            });
            box.append(colorSwatch(this._resolvedColors[index]));
            const name = new Gtk.Label({
                label: slice.name || slice.id,
                xalign: 0,
                hexpand: true,
                ellipsize: Pango.EllipsizeMode.END,
            });
            box.append(name);
            box.append(new Gtk.Label({
                label: formatScreenTime(slice.seconds),
                css_classes: ['dim-label'],
            }));
            row.set_child(box);
            this._legend.append(row);
        });
        this._legend.visible = true;
    }

    _drawRing(cr, width, height) {
        const fg = lookupRgba(this._chart, 'window_fg_color', [0.2, 0.2, 0.2, 1]);
        const cx = width / 2;
        const cy = height / 2;
        const outerR = Math.min(width, height) * 0.42;
        const innerR = outerR * 0.62;

        if (this._total <= 0 || this._slices.length === 0) {
            cr.setSourceRGBA(fg[0], fg[1], fg[2], 0.12);
            cr.arc(cx, cy, outerR, 0, 2 * Math.PI);
            cr.arcNegative(cx, cy, innerR, 2 * Math.PI, 0);
            cr.closePath();
            cr.fill();
            return;
        }

        let angle = -Math.PI / 2;
        this._slices.forEach((slice, index) => {
            const fraction = slice.seconds / this._total;
            const sweep = Math.max(0.0001, fraction * 2 * Math.PI);
            const color = this._resolvedColors[index] || colorForApp(slice.id, this._chart);
            cr.setSourceRGBA(color[0], color[1], color[2], color[3] ?? 1);
            cr.newPath();
            cr.arc(cx, cy, outerR, angle, angle + sweep);
            cr.arcNegative(cx, cy, innerR, angle + sweep, angle);
            cr.closePath();
            cr.fill();
            angle += sweep;
        });
    }
});
