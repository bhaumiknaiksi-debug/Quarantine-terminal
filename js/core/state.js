/**
 * @file /core/state.js
 * @description Centralized, immutable state management container for EDGE V6.
 * Enforces single source of truth architecture. UI components and engines 
 * interact with state via strictly controlled getters and setters, triggering 
 * reactive re-renders through the Event Bus.
 * @version 6.0.0
 * @module state
 */

import { globalEventBus } from './eventBus.js';

/**
 * Defines the foundational structure of the application's global state tree.
 * @typedef {Object} GlobalState
 * @property {Object} market - Raw tick data, OHLCV, and depth arrays.
 * @property {Object} scanner - Real-time structural data (volatility, funding, OI).
 * @property {Object} alpha - Scored setups, tradeabilities, and mathematical edges.
 * @property {Object} portfolio - Capital allocation, exposure, and margin metrics.
 * @property {Object} risk - Dynamic sizing constraints and regime heat levels.
 * @property {Object} journal - Trade ledger, historical performance logs.
 * @property {Object} settings - User configuration and API topographies.
 * @property {Object} performance - Telemetry, FPS, latency, and system health.
 * @property {Array} notifications - Active toast queue and alert history.
 */

class StateManager {
    constructor() {
        /**
         * The private, immutable state tree.
         * @type {GlobalState}
         * @private
         */
        this._state = {
            market: {
                assets: {},       // Keyed by normalized symbol (e.g., 'BTC-USDT-SWAP')
                lastUpdate: 0
            },
            scanner: {
                metrics: {},      // Z-scores, ATR, Funding Rates, OI changes
                isScanning: false
            },
            alpha: {
                hotList: [],      // Top 5 sorted setups
                bestTrade: null,  // Singular Command Center recommendation
                regime: 'AWAITING_DATA'
            },
            portfolio: {
                totalEquity: 0,
                availableMargin: 0,
                openExposure: 0,
                positions: []
            },
            risk: {
                maxDrawdown: 0,
                currentHeat: 'LOW',
                radarWarnings: []
            },
            journal: {
                trades: [],
                winRate: 0,
                expectancy: 0
            },
            settings: {
                wsEndpoint: 'wss://wspap.okx.com:443/ws/v5/public',
                fxRate: 84.50,
                riskPerTrade: 1.0,
                atrPeriods: 14
            },
            performance: {
                fps: 120,
                latency: 0,
                wsStatus: 'DISCONNECTED'
            },
            notifications: []
        };

        // Deep freeze initial state to prevent any accidental mutations
        this._deepFreeze(this._state);
    }

    /**
     * Recursively freezes an object to ensure strict immutability.
     * @param {Object} obj - The object to freeze.
     * @returns {Object} The deeply frozen object.
     * @private
     */
    _deepFreeze(obj) {
        Object.keys(obj).forEach(prop => {
            if (typeof obj[prop] === 'object' && obj[prop] !== null && !Object.isFrozen(obj[prop])) {
                this._deepFreeze(obj[prop]);
            }
        });
        return Object.freeze(obj);
    }

    /**
     * Retrieves a deep clone of the current global state or a specific slice.
     * Prevents reference-based mutations by external modules.
     * @param {string} [slice] - Optional state slice to retrieve (e.g., 'alpha').
     * @returns {*} Deep copy of the requested state data.
     */
    get(slice = null) {
        try {
            const target = slice ? this._state[slice] : this._state;
            if (target === undefined) {
                throw new Error(`[StateManager] Slice "${slice}" does not exist in state tree.`);
            }
            // Use structuredClone for highly performant deep copying of JS objects (ES2022+)
            return structuredClone(target);
        } catch (error) {
