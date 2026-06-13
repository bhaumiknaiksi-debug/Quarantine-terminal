/**
 * @file /core/renderer.js (Refactored)
 */
export class BaseComponent {
    constructor(containerId, stateSubscriptions = []) {
        this.containerId = containerId;
        this.container = document.getElementById(containerId);
        this.stateSubscriptions = stateSubscriptions;
        
        // --- Framework-level Memoization ---
        this._lastHash = null;
        this._cachedHTML = '';
        this._hasAnimatedEntrance = false;
        
        this._unsubscribers = [];
        this._initReactivity();
    }

    /**
     * Framework-level memoization wrapper.
     * Components call this.memo(hash, renderFn) to handle diffing/caching.
     */
    memo(hash, renderFn) {
        if (this._lastHash === hash && this._cachedHTML !== '') {
            return this._cachedHTML;
        }
        this._lastHash = hash;
        
        const html = renderFn();
        if (html) {
            this._cachedHTML = html;
        }
        return this._cachedHTML;
    }

    /**
     * Standardized Entrance Animation hook
     */
    getEntranceClass() {
        if (this._hasAnimatedEntrance) return '';
        this._hasAnimatedEntrance = true;
        return 'animate-slide-up';
    }
    
    // ... (rest of reactivity and lifecycle logic)
}
