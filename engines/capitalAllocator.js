/**
 * @file /engines/capitalAllocator.js
 * @description Sovereign Portfolio & Position Sizing Engine for EDGE V6.
 * Dynamically computes optimal capital distribution (Cash vs. Assets) based on 
 * macro regime conviction. Calculates precise execution sizing for the "Best Trade" 
 * utilizing fractional risk and stop-loss distance mapping to neutralize emotional sizing.
 * @version 6.0.0
 * @module capitalAllocator
 */

import { globalState } from '../core/state.js';
import { taskScheduler, PRIORITY } from '../core/scheduler.js';
import { MARKET_REGIMES } from '../constants.js';

class CapitalAllocator {
    constructor() {
        /**
         * Hardcoded base portfolio limits.
         * @private
         */
        this._limits = {
            maxPositionRiskPct: 2.0, // Never risk more than 2% of total equity on a single trade
            minCashReserve: 10.0,    // Always hold at least 10% in fiat/stablecoins
        };

        this._evaluateAllocation = this._evaluateAllocation.bind(this);
    }

    /**
     * Initializes the Capital Allocator.
     * Hooks into the Task Scheduler to adjust portfolio weights dynamically.
     * @returns {Promise<void>}
     */
    async init() {
        // Runs at a 2500ms interval. Capital allocation depends on both Alpha 
        // and Risk engines, so it trails them slightly to ensure data is settled.
        taskScheduler.schedule(
            'capital_allocation_loop',
            this._evaluateAllocation,
            2500,
            PRIORITY.NORMAL
        );

        console.info('[CapitalAllocator] Initialized. Computing optimal portfolio topography.');
    }

    /**
     * Evaluates current market conditions and alpha scores to determine the ideal 
     * portfolio distribution and computes exact trade sizing for the top recommendation.
     * @private
     */
    _evaluateAllocation() {
        const state = globalState.get();
        const { alpha, risk, settings, portfolio } = state;

        if (!alpha.marketPulse) return;

        // 1. Determine Target Cash Weight (Defensive Positioning)
        const cashWeight = this._determineCashWeight(alpha.marketPulse.status, risk.heatScore);

        // 2. Distribute remaining weight to top conviction setups
        const assetWeights = this._distributeRiskCapital(100 - cashWeight, alpha.hotList);

        // 3. Calculate precise execution size for the Alpha Engine's Best Trade
        const executionSizing = this._computeExecutionSizing(
            alpha.bestTrade, 
            portfolio.totalEquity > 0 ? portfolio.totalEquity : 100000, // Fallback to 100k for simulation if unset
            settings.riskPerTrade || 1.0,
            settings.fxRate || 1.0
        );

        this._commitToState({
            targetWeights: {
                CASH: cashWeight,
                ...assetWeights
            },
            bestTradeSizing: executionSizing
        });
    }

    /**
     * Calculates the baseline cash/stablecoin requirement based on structural market risk.
     * @param {string} regime - Current macro regime.
     * @param {number} heatScore - Current risk heat (0-100).
     * @returns {number} Cash percentage (10 to 100).
     * @private
     */
    _determineCashWeight(regime, heatScore) {
        let baseCash = this._limits.minCashReserve;

        // Adjust based on macro regime
        switch (regime) {
            case MARKET_REGIMES.LIQUIDATION_CASCADE:
                baseCash = 80.0;
                break;
            case MARKET_REGIMES.CHOP_MATRIX:
                baseCash = 60.0;
                break;
            case MARKET_REGIMES.COMPRESSION_SQUEEZE:
                baseCash = 40.0;
                break;
            case MARKET_REGIMES.TREND_EXHAUSTION:
                baseCash = 50.0;
                break;
            case MARKET_REGIMES.TREND_EXPANSION:
                baseCash = 15.0; // Max aggression
                break;
            case MARKET_REGIMES.PRICE_DISCOVERY:
                baseCash = 20.0;
                break;
            default:
                baseCash = 100.0; // Failsafe
        }

        // Apply penalty for high structural heat (e.g., toxic funding across the board)
        if (heatScore > 75) {
            baseCash = Math.max(baseCash, 90.0);
        } else if (heatScore > 50) {
            baseCash += 20.0;
        }

        return Math.min(Math.round(baseCash), 100);
    }

    /**
     * Distributes the remaining active capital across the top quantified setups.
     * Uses a score-weighted distribution model.
     * @param {number} availableWeight - Percentage of portfolio designated for active risk.
     * @param {Array<Object>} hotList - Top 5 scored setups.
     * @returns {Object} Key-value pairs of Asset Symbol to Portfolio Percentage.
     * @private
     */
    _distributeRiskCapital(availableWeight, hotList) {
        if (availableWeight <= 0 || !hotList || hotList.length === 0) {
            return {};
        }

        const allocations = {};
        
        // We only allocate to the top 3 to prevent dilution of edge
        const topSetups = hotList.slice(0, 3);
        
        // Sum the alpha scores to create a proportional distribution pool
        const totalScore = topSetups.reduce((sum, setup) => sum + setup.alphaScore, 0);

        topSetups.forEach(setup => {
            const assetName = setup.symbol.split('-')[0];
            // Proportional weight based on Alpha Score dominance
            const rawWeight = (setup.alphaScore / totalScore) * availableWeight;
            
            // Round to nearest whole number for cleaner UI
            allocations[assetName] = Math.round(rawWeight);
        });

        // Resolve rounding errors by adjusting the highest conviction asset
        const assignedWeight = Object.values(allocations).reduce((a, b) => a + b, 0);
        if (assignedWeight !== availableWeight && topSetups.length > 0) {
            const topAsset = topSetups[0].symbol.split('-')[0];
            allocations[topAsset] += (availableWeight - assignedWeight);
        }

        return allocations;
    }

    /**
     * Calculates absolute position size and required margin for execution.
     * Utilizes Fixed Fractional Risk sizing: Position = Risk Amount / Stop Loss %
     * @param {Object} bestTrade - The top setup from AlphaEngine.
     * @param {number} equityBase - Total portfolio equity.
     * @param {number} riskPct - Percentage of equity to risk if stop hit.
     * @param {number} fxRate - Multiplier for local currency formatting.
     * @returns {Object|null} Execution sizing object.
     * @private
     */
    _computeExecutionSizing(bestTrade, equityBase, riskPct, fxRate) {
        if (!bestTrade || bestTrade.direction === 'STAY_IN_CASH') {
            return null;
        }

        try {
            const entryPrice = bestTrade.execution.price; // Already in local currency via AlphaEngine
            const stopPrice = bestTrade.execution.stopLoss;

            if (entryPrice <= 0 || stopPrice <= 0 || entryPrice === stopPrice) return null;

            // 1. Calculate Absolute Risk Amount
            // Cap the user's risk parameter at the hardcoded safety limit
            const clampedRiskPct = Math.min(riskPct, this._limits.maxPositionRiskPct);
            const riskAmountLocal = equityBase * (clampedRiskPct / 100);

            // 2. Calculate Stop Loss Distance (Percentage)
            const slDistancePct = Math.abs(entryPrice - stopPrice) / entryPrice;

            if (slDistancePct === 0) return null;

            // 3. Compute Position Size (Notional Value)
            const notionalSizeLocal = riskAmountLocal / slDistancePct;

            // 4. Calculate actual coin quantity required
            const coinQuantity = notionalSizeLocal / entryPrice;

            // 5. Estimate Margin Required (Assuming standard 10x leverage for crypto perps)
            // This does not dictate risk, merely capital lockup required by exchange
            const assumedLeverage = 10;
            const requiredMargin = notionalSizeLocal / assumedLeverage;

            return {
                riskAmount: Math.round(riskAmountLocal),
                riskPercent: clampedRiskPct.toFixed(2),
                notionalSize: Math.round(notionalSizeLocal),
                coinQuantity: coinQuantity.toFixed(4),
                requiredMargin: Math.round(requiredMargin),
                slDistancePct: (slDistancePct * 100).toFixed(2),
                leverage: assumedLeverage
            };

        } catch (error) {
            console.error('[CapitalAllocator] Execution sizing calculation failed:', error);
            return null;
        }
    }

    /**
     * Commits the allocations and sizing math to the global state tree.
     * @param {Object} allocationData 
     * @private
     */
    _commitToState(allocationData) {
        globalState.update('portfolio', (currentState) => ({
            ...currentState,
            targetAllocations: allocationData.targetWeights,
            executionPlan: allocationData.bestTradeSizing
        }));
    }
}

// Export singleton instance
export const capitalAllocator = new CapitalAllocator();
