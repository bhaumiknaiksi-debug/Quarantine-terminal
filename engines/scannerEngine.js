/**
 * @file /engines/scannerEngine.js
 * @description Ingestion and normalization pipeline for EDGE V6.
 * Subscribes to raw data streams, calculates structural market metrics (Volatility Z-Scores, 
 * True Range, Open Interest Delta), and maintains the unified Asset view in the global state.
 * Implements high-frequency buffering to prevent state-thrashing.
 * @version 6.0.0
 * @module scannerEngine
 */

import { SYSTEM_EVENTS } from '../constants.js';
import { globalEventBus } from '../core/eventBus.js';
import { globalState } from '../core/state.js';
import { taskScheduler, PRIORITY } from '../core/scheduler.js';

class ScannerEngine {
    constructor() {
        /**
         * High-performance in-memory cache for asset data.
         * Prevents constant reading from the immutable state tree during tick processing.
         * @type {Map<string, Object>}
         * @private
         */
        this._assetCache = new Map();

        /**
         * Queue for incoming raw websocket payloads.
         * @type {Array<Object>}
         * @private
         */
        this._tickBuffer = [];

        /**
         * Indicates if the cache has mutations that need to be committed to global state.
         * @type {boolean}
         * @private
         */
        this._isDirty = false;

        this._settings = { atrPeriods: 14 };

        this._handleMarketTick = this._handleMarketTick.bind(this);
        this._processBufferAndCommit = this._processBufferAndCommit.bind(this);
    }

    /**
     * Initializes the Scanner Engine.
     * Loads settings, hydrates initial cache from state, and hooks into data streams.
     * @returns {Promise<void>}
     */
    async init() {
        // Hydrate settings
        const currentSettings = globalState.get('settings');
        if (currentSettings?.atrPeriods) {
            this._settings.atrPeriods = currentSettings.atrPeriods;
        }

        // Hydrate cache from existing state (useful after a reload/reboot)
        const marketState = globalState.get('market');
        if (marketState && marketState.assets) {
            for (const [symbol, data] of Object.entries(marketState.assets)) {
                this._assetCache.set(symbol, structuredClone(data));
            }
        }

        // Subscribe to raw data streams
        globalEventBus.on(SYSTEM_EVENTS.MARKET_DATA_TICK, this._handleMarketTick);

        // Schedule the batch-processing and state-commit loop.
        // Runs at 250ms intervals (4 updates/sec) to keep UI buttery smooth without thrashing.
        taskScheduler.schedule(
            'scanner_engine_commit',
            this._processBufferAndCommit,
            250,
            PRIORITY.HIGH
        );

        console.info('[ScannerEngine] Initialized. Awaiting market telemetry.');
    }

    /**
     * Rapidly ingests raw ticks into the buffer.
     * Performs ZERO heavy calculations to ensure the WebSocket thread is never blocked.
     * @param {Object} payload 
     * @private
     */
    _handleMarketTick(payload) {
        if (!payload || !payload.data || !Array.isArray(payload.data)) return;
        
        // Push the channel type alongside the data for accurate parsing later
        for (const tick of payload.data) {
            this._tickBuffer.push({
                channel: payload.channel,
                raw: tick
            });
        }
    }

    /**
     * Drains the tick buffer, performs mathematical normalizations, updates the 
     * in-memory cache, and atomically commits to the global state tree.
     * @private
     */
    _processBufferAndCommit() {
        if (this._tickBuffer.length === 0) return;

        // Drain buffer completely
        const processQueue = this._tickBuffer.splice(0, this._tickBuffer.length);

        for (const item of processQueue) {
            this._normalizeTick(item.channel, item.raw);
        }

        if (this._isDirty) {
            this._commitToState();
            this._isDirty = false;
        }
    }

    /**
     * Routes and normalizes specific OKX data channels into the unified Asset model.
     * @param {string} channel - The OKX websocket channel (e.g., 'tickers', 'funding-rate').
     * @param {Object} raw - The raw JSON tick data.
     * @private
     */
    _normalizeTick(channel, raw) {
        const symbol = raw.instId;
        if (!symbol) return;

        // Ensure baseline asset structure exists
        if (!this._assetCache.has(symbol)) {
            this._assetCache.set(symbol, this._createBaselineAsset(symbol));
        }

        const asset = this._assetCache.get(symbol);
        const prevPrice = asset.price;

        try {
            switch (channel) {
                case 'tickers':
                    asset.price = parseFloat(raw.last);
                    asset.open24h = parseFloat(raw.open24h);
                    asset.high24h = parseFloat(raw.high24h);
                    asset.low24h = parseFloat(raw.low24h);
                    
                    // Calculate 24h percentage change
                    if (asset.open24h > 0) {
                        asset.chg24h = ((asset.price - asset.open24h) / asset.open24h) * 100;
                    }

                    // Only compute volatility math if price actually mutated
                    if (asset.price !== prevPrice) {
                        asset.prevPrice = prevPrice > 0 ? prevPrice : asset.price;
                        this._computeVolatility(asset);
                    }
                    break;

                case 'funding-rate':
                    // OKX funding rate is typically highly fractional; convert to absolute percentage format
                    asset.fundingRate = parseFloat(raw.fundingRate);
                    break;

                case 'open-interest':
                    const currentOI = parseFloat(raw.oi);
                    
                    // Calculate OI Delta
                    if (asset.openInterest > 0) {
                        asset.oiChange = ((currentOI - asset.openInterest) / asset.openInterest) * 100;
                    } else {
                        asset.oiChange = 0;
                    }
                    
                    asset.openInterest = currentOI;
                    break;
            }

            asset.lastUpdated = performance.now();
            this._isDirty = true;

        } catch (error) {
            console.error(`[ScannerEngine] Normalization failure for ${symbol} on channel ${channel}:`, error);
        }
    }

    /**
     * Computes the True Range (TR), Exponential Average True Range (ATR), 
     * and the Volatility Z-Score dynamically without requiring historical arrays.
     * @performance Uses EMA (Exponential Moving Average) math to approximate variance continuously.
     * @param {Object} asset - The cached asset object.
     * @private
     */
    _computeVolatility(asset) {
        const h = asset.high24h;
        const l = asset.low24h;
        const pc = asset.prevPrice;

        // True Range calculation: max(High - Low, |High - PrevClose|, |Low - PrevClose|)
        // For sub-day continuous ticks, we estimate TR based on session extremes and tick variance.
        const tr = Math.max(
            h - l,
            Math.abs(h - pc),
            Math.abs(l - pc)
        );
        asset.volatility.tr = tr;

        // Initialize ATR metrics on first pass
        if (asset.volatility.atrM === 0) {
            asset.volatility.atrM = tr || (asset.price * 0.02); // Fallback to 2% proxy
            return;
        }

        // EMA Alpha calculation based on configured periods
        const alpha = 2 / (this._settings.atrPeriods + 1);

        // Update Mean ATR
        const prevAtrM = asset.volatility.atrM;
        asset.volatility.atrM = (tr * alpha) + (prevAtrM * (1 - alpha));

        // Update Variance of TR to approximate Standard Deviation
        const diff = tr - asset.volatility.atrM;
        const prevVar = Math.pow(asset.volatility.atrS, 2);
        const newVar = (Math.pow(diff, 2) * alpha) + (prevVar * (1 - alpha));
        
        asset.volatility.atrS = Math.sqrt(newVar);

        // Calculate Z-Score: (Value - Mean) / Standard Deviation
        // Protect against divide-by-zero on completely flat assets
        if (asset.volatility.atrS > 0) {
            asset.volatility.zScore = diff / asset.volatility.atrS;
        } else {
            asset.volatility.zScore = 0;
        }
    }

    /**
     * Generates a structural baseline for newly discovered assets.
     * @param {string} symbol 
     * @returns {Object}
     * @private
     */
    _createBaselineAsset(symbol) {
        return {
            symbol: symbol,
            price: 0,
            prevPrice: 0,
            open24h: 0,
            high24h: 0,
            low24h: 0,
            chg24h: 0,
            fundingRate: 0,
            openInterest: 0,
            oiChange: 0,
            volatility: {
                tr: 0,
                atrM: 0,
                atrS: 1, // Default to 1 to prevent init division by zero
                zScore: 0
            },
            lastUpdated: 0
        };
    }

    /**
     * Atomically commits the mutated asset cache to the global state tree.
     * Separates the raw 'market' data slice from the computed 'scanner' metrics slice 
     * to allow downstream engines to subscribe to only what they need.
     * @private
     */
    _commitToState() {
        const marketAssets = {};
        const scannerMetrics = {};

        for (const [symbol, asset] of this._assetCache.entries()) {
            marketAssets[symbol] = {
                symbol: asset.symbol,
                price: asset.price,
                prevPrice: asset.prevPrice,
                open24h: asset.open24h,
                high24h: asset.high24h,
                low24h: asset.low24h,
                chg24h: asset.chg24h,
                lastUpdated: asset.lastUpdated
            };

            scannerMetrics[symbol] = {
                fundingRate: asset.fundingRate,
                openInterest: asset.openInterest,
                oiChange: asset.oiChange,
                volatility: asset.volatility
            };
        }

        // Commit Market slice (Raw Pricing)
        globalState.update('market', (currentState) => ({
            ...currentState,
            assets: marketAssets,
            lastUpdate: performance.now()
        }));

        // Commit Scanner slice (Structural Metrics)
        globalState.update('scanner', (currentState) => ({
            ...currentState,
            metrics: scannerMetrics,
            isScanning: true
        }));
    }
}

// Export singleton instance
export const scannerEngine = new ScannerEngine();
