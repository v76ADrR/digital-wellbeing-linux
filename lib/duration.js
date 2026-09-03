// SPDX-License-Identifier: GPL-2.0-or-later

export function splitDuration(totalSeconds) {
    const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    return {
        days: Math.floor(seconds / 86400),
        hours: Math.floor((seconds % 86400) / 3600),
        minutes: Math.floor((seconds % 3600) / 60),
    };
}

export function formatUptime(totalSeconds, format) {
    if (totalSeconds === null || totalSeconds === undefined)
        return '—';

    const {days, hours, minutes} = splitDuration(totalSeconds);

    switch (format) {
    case 'clock': {
        const mm = String(minutes).padStart(2, '0');
        if (days > 0)
            return `${days}d ${String(hours).padStart(2, '0')}:${mm}`;
        return `${hours}:${mm}`;
    }
    case 'verbose': {
        const parts = [];
        if (days > 0)
            parts.push(days === 1 ? '1 day' : `${days} days`);
        if (hours > 0 || days > 0)
            parts.push(hours === 1 ? '1 hour' : `${hours} hours`);
        parts.push(minutes === 1 ? '1 minute' : `${minutes} minutes`);
        return parts.join(' ');
    }
    case 'compact':
    default: {
        if (days > 0)
            return `${days}d ${hours}h ${minutes}m`;
        if (hours > 0)
            return `${hours}h ${minutes}m`;
        return `${minutes}m`;
    }
    }
}

/** Screen-time totals roll past 24h as hours, matching GNOME Settings. */
export function formatScreenTime(totalSeconds) {
    if (totalSeconds === null || totalSeconds === undefined)
        return '—';

    const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0)
        return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}
