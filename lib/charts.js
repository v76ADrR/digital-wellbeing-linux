// SPDX-License-Identifier: GPL-2.0-or-later

import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk?version=4.0';
import Pango from 'gi://Pango';
import PangoCairo from 'gi://PangoCairo';

import {formatScreenTime} from './duration.js';

const OTHER_COLOR = [0.62, 0.50, 0.46, 1];
const DONUT_PALETTE = [
    [0.83, 0.48, 0.42, 1],
    [0.52, 0.42, 0.22, 1],
    [0.72, 0.58, 0.50, 1],
    [0.62, 0.32, 0.30, 1],
    [0.75, 0.60, 0.28, 1],
    [0.55, 0.40, 0.36, 1],
    [0.78, 0.42, 0.38, 1],
    [0.45, 0.38, 0.32, 1],
];

export function colorForApp(id) {
    let hash = 2166136261;
    for (const ch of String(id)) {
        hash ^= ch.charCodeAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return DONUT_PALETTE[Math.abs(hash) % DONUT_PALETTE.length];
}

export function otherSliceColor() {
    return OTHER_COLOR;
}

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

function drawText(cr, text, x, y, options = {}) {
    const layout = PangoCairo.create_layout(cr);
    const size = options.size ?? 11;
    const weight = options.bold ? 'bold' : 'normal';
    layout.set_font_description(
        Pango.FontDescription.from_string(`Cantarell ${weight} ${size}`));
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

function ellipsize(text, max) {
    const value = String(text || '');
    if (value.length <= max)
        return value;
    return `${value.slice(0, Math.max(1, max - 1))}…`;
}

export const ScreenTimeCard = GObject.registerClass({
    GTypeName: 'DigitalWellbeingScreenTimeCard',
    Signals: {
        'activated': {},
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
            tooltip_text: this._('View apps used today'),
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
        click.connect('released', () => this.emit('activated'));
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
            this.refresh();
        });
        this._nextButton.connect('clicked', () => {
            this._weekOffset = Math.min(0, this._weekOffset + 1);
            this.refresh();
        });
        nav.append(this._prevButton);
        nav.append(this._nextButton);
        this.append(nav);

        this.append(new Gtk.Label({
            label: this._('Tap the graph to see apps from today'),
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
        const left = 36;
        const right = 8;
        const top = 8;
        const bottom = 28;
        const plotWidth = Math.max(1, width - left - right);
        const plotHeight = Math.max(1, height - top - bottom);
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

        const count = Math.max(1, this._bars.length);
        const gap = 10;
        const barWidth = Math.max(8, (plotWidth - gap * (count - 1)) / count);
        const radius = Math.min(8, barWidth / 2);

        this._bars.forEach((bar, index) => {
            const x = left + index * (barWidth + gap);
            const barHeight = plotHeight * Math.min(1, bar.seconds / yMaxSeconds);
            const y = top + plotHeight - barHeight;
            if (bar.isToday)
                cr.setSourceRGBA(accent[0], accent[1], accent[2], 1);
            else
                cr.setSourceRGBA(accent[0], accent[1], accent[2], 0.38);
            roundedTopBar(cr, x, y, barWidth, Math.max(barHeight, bar.seconds > 0 ? 2 : 0), radius);
            cr.fill();

            drawText(cr, bar.letter, x + barWidth / 2, height - 22, {
                size: 11,
                align: 'center',
                color: dim,
                bold: bar.isToday,
            });
        });
    }
});

export const AppDonut = GObject.registerClass({
    GTypeName: 'DigitalWellbeingAppDonut',
}, class AppDonut extends Gtk.DrawingArea {
    _init() {
        super._init({
            hexpand: true,
            vexpand: true,
            height_request: 320,
            width_request: 320,
        });
        this._slices = [];
        this._total = 0;
        this._centerTitle = '';
        this._centerValue = '';
        this.set_draw_func((_area, cr, width, height) => {
            try {
                this._draw(cr, width, height);
            } finally {
                cr.$dispose?.();
            }
        });
    }

    setModel({slices = [], total = 0, centerTitle = '', centerValue = ''} = {}) {
        this._slices = slices;
        this._total = total;
        this._centerTitle = centerTitle;
        this._centerValue = centerValue;
        this.queue_draw();
        try {
            this.update_property(
                [Gtk.AccessibleProperty.LABEL],
                [`${centerTitle} ${centerValue}`]);
        } catch (_error) {
        }
    }

    _draw(cr, width, height) {
        const fg = lookupRgba(this, 'window_fg_color', [0.25, 0.2, 0.18, 1]);
        const dim = lookupRgba(this, 'dim_label_color', [...fg.slice(0, 3), 0.65]);
        const cx = width / 2;
        const cy = height / 2 - 6;
        const outerR = Math.min(width, height) * 0.28;
        const innerR = outerR * 0.62;

        if (this._total <= 0 || this._slices.length === 0) {
            cr.setSourceRGBA(fg[0], fg[1], fg[2], 0.12);
            cr.arc(cx, cy, outerR, 0, 2 * Math.PI);
            cr.arcNegative(cx, cy, innerR, 2 * Math.PI, 0);
            cr.closePath();
            cr.fill();
        } else {
            let angle = -Math.PI / 2;
            for (const slice of this._slices) {
                const fraction = slice.seconds / this._total;
                const sweep = Math.max(0.0001, fraction * 2 * Math.PI);
                const color = slice.color || colorForApp(slice.id);
                cr.setSourceRGBA(color[0], color[1], color[2], color[3] ?? 1);
                cr.newPath();
                cr.arc(cx, cy, outerR, angle, angle + sweep);
                cr.arcNegative(cx, cy, innerR, angle + sweep, angle);
                cr.closePath();
                cr.fill();

                if (fraction >= 0.06 && slice.name) {
                    const mid = angle + sweep / 2;
                    const labelR = outerR + 26;
                    const lx = cx + Math.cos(mid) * labelR;
                    const ly = cy + Math.sin(mid) * labelR - 7;
                    drawText(cr, ellipsize(slice.name, 12), lx, ly, {
                        size: 11,
                        align: 'center',
                        color: fg,
                    });
                }
                angle += sweep;
            }
        }

        drawText(cr, this._centerTitle || '', cx, cy - 18, {
            size: 12,
            align: 'center',
            color: dim,
        });
        drawText(cr, this._centerValue || '0m', cx, cy - 2, {
            size: 22,
            align: 'center',
            color: fg,
            bold: true,
        });
    }
});
