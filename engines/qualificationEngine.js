/**
 * @file /engines/qualificationEngine.js
 * @description Hard-filtering pipeline for EDGE V6.
 * Evaluates the normalized market and scanner data to ruthlessly eliminate 
 * sub-optimal assets based on rigid criteria (liquidity, chop, extreme funding).
 * Acts as a pre-filter before the Alpha Engine performs heavy computational scoring.
 * @version 6.0.0
 * @module qualificationEngine
 */

import { globalState } from '../core/state.js';
import { taskScheduler, PRIORITY } from '../core/scheduler.js';

class QualificationEngine {
    constructor() {
        /**
         * Rigid thresholds for disqualifying assets.
         * Prevents the system from attempting to trade in untradeable environments.
         * @type {Object}
         * @private
         */
        this._thresholds = {
            minVolatilityZ: 0.8,        // Reject assets deep in the chop matrix (Z < 0.8)
            maxFundingRate: 0.0075,     // Reject if funding is dangerously skewed (> 0.75% per epoch)
            minTrueRangePct: 0.015,     // Reject if expected daily move is < 1.5%
            maxDrawdownTolerance: -15.0 // Reject assets heavily bleeding intraday (-15% 24h)
        };

        this._evaluateUniverse = this._evaluateUniverse.bind(this);
    }

    /**
     * Initializes the Qualification Engine.
     * Hooks into the Task Scheduler for continuous background evaluation.
     * @returns {Promise<void>}
     */
    async init() {
        // Runs at a 1000ms interval (1Hz). Qualification doesn't need to be 
        // calculated on every single market tick, saving CPU overhead.
        taskScheduler.schedule(
            'qualification_evaluation_loop',
            this._evaluateUniverse,
            1000,
            PRIORITY.HIGH
        );

        console.info('[QualificationEngine] Initialized and enforcing parameters.');
    }

    /**
     * Iterates through the entire asset universe and applies hard-rejection logic.
     * Commits the resulting qualified array to the Alpha state slice.
     * @private
     */
    _evaluateUniverse() {
        const marketSlice = globalState.get('market');
        const scannerSlice = globalState.get('scanner');

        if (!marketSlice?.assets || !scannerSlice?.metrics) return;

        const qualifiedSymbols = [];
        const rejectionLog = new Map();

        // Evaluate every tracked asset
        for (const [symbol, marketData] of Object.entries(marketSlice.assets)) {
            const scannerData = scannerSlice.metrics[symbol];

            if (!scannerData) continue;

            const rejectionReason = this._testAsset(marketData, scannerData);

            if (rejectionReason === null) {
                qualifiedSymbols.push(symbol);
            } else {
                rejectionLog.set(symbol, rejectionReason);
            }
        }

        this._commitToState(qualifiedSymbols, rejectionLog);
    }

    /**
     * Applies the rigid boolean tests to a single asset.
     * @param {Object} marketData - Raw pricing and 24h metrics.
     * @param {Object} scannerData - Volatility and structural metrics.
     * @returns {string|null} The reason for rejection, or null if it passes all tests.
     * @private
     */
    _testAsset(marketData, scannerData) {
        try {
            // 1. Data Integrity Check
            if (marketData.price <= 0 || scannerData.volatility.atrM <= 0) {
                return 'INCOMPLETE_DATA';
            }

            // 2. Regime & Chop Filter (Volatility Z-Score)
            // We want assets that are either breaking out or aggressively compressing.
            // Anything lingering around the mean (Z near 0) is chop.
            const absZScore = Math.abs(scannerData.volatility.zScore);
            if (absZScore < this._thresholds.minVolatilityZ) {
                return `CHOP_MATRIX (Z: ${scannerData.volatility.zScore.toFixed(2)})`;
            }

            // 3. Implied Tradeability (True Range as % of Price)
            // If the asset isn't moving enough to cover expected fees + spread, reject it.
            const impliedRangePct = scannerData.volatility.atrM / marketData.price;
            if (impliedRangePct < this._thresholds.minTrueRangePct) {
                return `LOW_RANGE (${(impliedRangePct * 100).toFixed(2)}%)`;
            }

            // 4. Structural Risk (Funding Rate Extremes)
            // Extreme funding rates indicate a crowded trade ripe for a liquidation cascade.
            if (Math.abs(scannerData.fundingRate) > this._thresholds.maxFundingRate) {
                return `TOXIC_FUNDING (${(scannerData.fundingRate * 100).toFixed(2)}%)`;
            }

            // 5. Unrecoverable Trend Filter
            // If it's down massively on the day, going long is catching a knife, 
            // and shorting is chasing the bottom. Best to avoid entirely.
            if (marketData.chg24h < this._thresholds.maxDrawdownTolerance) {
                return `EXCESSIVE_DRAWDOWN (${marketData.chg24h.toFixed(2)}%)`;
            }

            // Asset passed all hard filters
            return null;

        } catch (error) {
            console.error(`[QualificationEngine] Test failure on ${marketData.symbol}:`, error);
            return 'SYSTEM_EVALUATION_ERROR';
        }
    }

    /**
     * Commits the qualified asset list to the global state tree.
     * Updates the alpha slice so the AlphaEngine only wastes CPU cycles 
     * scoring assets that have already proven tradeable.
     * @param {string[]} qualifiedSymbols - Array of symbols that passed the filter.
     * @param {Map<string, string>} rejectionLog - Internal tracking of why assets failed.
     * @private
     */
    _commitToState(qualifiedSymbols, rejectionLog) {
        globalState.update('alpha', (currentState) => ({
            ...currentState,
            qualifiedSymbols: qualifiedSymbols,
            // Keep the rejection log available in state for potential UI debugging 
            // or transparency in the Market Regime card.
            disqualifiedMap: Object.fromEntries(rejectionLog)
        }));
    }
}

// Export singleton instance
export const qualificationEngine = new QualificationEngine();
