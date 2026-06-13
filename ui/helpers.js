/**
 * @file /ui/helpers.js
 * @description Internal UI component library for EDGE V6.
 * Generates standardized HTML fragments (Metrics, Badges, Rows) to prevent 
 * code duplication and inline-style bloat in the main view components.
 * @version 6.1.0
 * @module uiHelpers
 */

export const UI = {
    /**
     * Standardized metric box (Label top, Value bottom)
     */
    metricBox: (label, value, valueClass = '') => `
        <div class="data-box">
            <span class="data-label">${label}</span>
            <span class="data-value ${valueClass}">${value}</span>
        </div>
    `,

    /**
     * Standardized inline badge
     */
    badge: (text, colorClass, isGlow = false) => `
        <span class="system-badge ${colorClass} ${isGlow ? 'badge-glow' : ''}">
            ${text}
        </span>
    `,

    /**
     * Section divider with optional dashed styling
     */
    divider: (isDashed = false) => `
        <div class="section-divider ${isDashed ? 'divider-dashed' : ''}"></div>
    `,

    /**
     * Icon registry mapper (prevents Presentation Engine from dictating UI glyphs)
     */
    getIcon: (intent) => {
        const icons = {
            'LONG': '<svg class="icon icon-up"><path d="M5 12l7-7 7 7M12 19V5"/></svg>',
            'SHORT': '<svg class="icon icon-down"><path d="M19 12l-7 7-7-7M12 5v14"/></svg>',
            'STAY_IN_CASH': '<svg class="icon icon-shield"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>'
        };
        return icons[intent] || '';
    },

    /**
     * Animated Skeleton Loader for pending states
     */
    skeletonCard: (lines = 3) => `
        <div class="glass-panel component-card skeleton-wrapper">
            <div class="skeleton-header animate-pulse"></div>
            ${Array(lines).fill('<div class="skeleton-row animate-pulse"></div>').join('')}
        </div>
    `
};
