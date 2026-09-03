// SPDX-License-Identifier: GPL-2.0-or-later

const CHART_LEFT = 36;
const CHART_RIGHT = 8;
const CHART_TOP = 8;
const CHART_BOTTOM = 28;
const CHART_GAP = 10;

export function barLayout(width, height, barCount) {
    const left = CHART_LEFT;
    const right = CHART_RIGHT;
    const top = CHART_TOP;
    const bottom = CHART_BOTTOM;
    const plotWidth = Math.max(1, width - left - right);
    const plotHeight = Math.max(1, height - top - bottom);
    const count = Math.max(1, barCount);
    const gap = CHART_GAP;
    const barWidth = Math.max(8, (plotWidth - gap * (count - 1)) / count);
    return {left, right, top, bottom, plotWidth, plotHeight, gap, barWidth, count};
}

export function barIndexAt(x, y, width, height, barCount) {
    const layout = barLayout(width, height, barCount);
    if (y < layout.top || y > height - 2)
        return -1;
    if (x < layout.left - layout.gap / 2 || x > width - layout.right + layout.gap / 2)
        return -1;

    for (let index = 0; index < barCount; index++) {
        const barX = layout.left + index * (layout.barWidth + layout.gap);
        const x0 = barX - layout.gap / 2;
        const x1 = barX + layout.barWidth + layout.gap / 2;
        if (x >= x0 && x < x1)
            return index;
    }
    return -1;
}
