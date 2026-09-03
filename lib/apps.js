// SPDX-License-Identifier: GPL-2.0-or-later

import Gio from 'gi://Gio';

function prettyId(id) {
    const trimmed = String(id || '').replace(/\.desktop$/, '');
    const parts = trimmed.split('.');
    return parts[parts.length - 1] || trimmed || 'App';
}

function lookupDesktop(id) {
    if (!id || id === '__other__')
        return null;

    try {
        let info = Gio.DesktopAppInfo.new(id);
        if (info)
            return info;
        if (!id.endsWith('.desktop'))
            info = Gio.DesktopAppInfo.new(`${id}.desktop`);
        return info;
    } catch (_error) {
        return null;
    }
}

export function resolveApp(id, fallbackName) {
    const info = lookupDesktop(id);
    if (info) {
        return {
            id,
            name: info.get_display_name() || fallbackName || prettyId(id),
            icon: info.get_icon(),
        };
    }

    return {
        id,
        name: fallbackName || prettyId(id),
        icon: null,
    };
}
