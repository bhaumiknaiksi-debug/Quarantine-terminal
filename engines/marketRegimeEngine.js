/**
 * @file /engines/marketRegimeEngine.js
 * @description Macro-environmental analysis engine for EDGE V6.
 * Evaluates the collective state of the entire crypto asset universe to determine 
 * overarching market conditions (Regime, Bias, Volatility, Participation).
 * Prevents local asset-level anomalies from overriding macro structural warnings.
 * @version 6.0.0
 * @module marketRegimeEngine
 */

import { globalState } from '../core/state.js';
import { taskScheduler, PRIORITY } from '../core/scheduler.js';
import { MARKET_REGIMES } from '../constants.js';

class MarketRegimeEngine {
    constructor() {
        this._evaluateRegime = this._evaluateRegime.bind(this);
    }

    /**
     * Initializes the Market Regime Engine.
     * Hooks into the Task Scheduler for continuous macro evaluation.
     * @returns {Promise<void>}
     */
    async init() {
        // Macro environments evolve slower than tick data.
        // A 3000ms (3s) interval is highly optimal for evaluating the total universe.
        taskScheduler.schedule(
            'market_regime_loop',
            this._evaluateRegime,
            3000,
            PRIORITY.HIGH
        );

        console.info('[MarketRegimeEngine] Initialized. Monitoring macro structural breadth.');
    }

    /**
     * Aggregates data across the entire asset universe to formulate the Market Pulse.
     * Commits the macro regime state to the Alpha slice for UI consumption.
     * @private
     */
    _evaluateRegime() {
        const state = globalState.get();
        const { market, scanner } = state;

        if (!market.assets || !scanner.metrics || Object.keys(market.assets).length === 0) {
            return;
        }

        const universeMetrics = this._aggregateUniverseMetrics(market.assets, scanner.metrics);
        const marketPulse = this._classifyRegime(universeMetrics);

        this._commitToState(marketPulse);
    }

    /**
     * Condenses the entire tracked asset universe into unified macro averages.
     * @param {Object} marketAssets - Raw pricing slice.
     * @param {Object} scannerMetrics - Structural data slice.
     * @returns {Object} Aggregated metrics.
     * @private
     */
    _aggregateUniverseMetrics(marketAssets, scannerMetrics) {
        let totalZScore = 0;
        let totalFunding = 0;
        let totalOIChange = 0;
        let advancingAssets = 0;
        let decliningAssets = 0;
        let validAssetCount = 0;

        for (const [symbol, marketData] of Object.entries(marketAssets)) {
            const scannerData = scannerMetrics[symbol];
            if (!scannerData) continue;

            totalZScore += Math.abs(scannerData.volatility.zScore);
            totalFunding += scannerData.fundingRate;
            totalOIChange += scannerData.oiChange;
            
            if (marketData.chg24h > 0.5) {
                advancingAssets++;
            } else if (marketData.chg24h < -0.5) {
                decliningAssets++;
            }

            validAssetCount++;
        }

        if (validAssetCount === 0) return null;

        const breadthPercentage = ((advancingAssets - decliningAssets) / validAssetCount) * 100;

        return {
            avgZScore: totalZScore / validAssetCount,
            avgFunding: totalFunding / validAssetCount,
            avgOIChange: totalOIChange / validAssetCount,
            breadth: breadthPercentage, // Range: -100 (all down) to +100 (all up)
            totalAssets: validAssetCount
        };
    }

    /**
     * Translates raw aggregated metrics into the structured Bloomberg-style "Market Pulse".
     * @param {Object} metrics - Aggregated universe metrics.
     * @returns {Object} The Market Pulse object.
     * @private
     */
    _classifyRegime(metrics) {
        if (!metrics) {
            return {
                status: 'AWAITING_DATA',
                bias: 'NEUTRAL',
                volatility: 'UNKNOWN',
                participation: 'UNKNOWN',
                riskState: 'OFF',
                confidence: 0
            };
        }

        // 1. Determine Bias (Directional Breadth)
        let bias = 'NEUTRAL';
        if (metrics.breadth > 40) bias = 'BULLISH';
        if (metrics.breadth > 75) bias = 'STRONG_BULLISH';
        if (metrics.breadth < -40) bias = 'BEARISH';
        if (metrics.breadth < -75) bias = 'STRONG_BEARISH';

        // 2. Determine Volatility Environment
        let volatility = 'NORMAL';
        if (metrics.avgZScore > 1.8) volatility = 'EXTREME';
        else if (metrics.avgZScore > 1.2) volatility = 'EXPANDING';
        else if (metrics.avgZScore < 0.6) volatility = 'COMPRESSED';

        // 3. Determine Market Participation (Open Interest)
        let participation = 'FLAT';
        if (metrics.avgOIChange > 2.0) participation = 'INCREASING';
        if (metrics.avgOIChange > 5.0) participation = 'SURGING';
        if (metrics.avgOIChange < -2.0) participation = 'DECREASING';
        if (metrics.avgOIChange < -5.0) participation = 'PLUMMETING (LIQUIDATIONS)';

        // 4. Classify Macro Regime
        let status = MARKET_REGIMES.CHOP_MATRIX; // Default assumption
        let riskState = 'OFF';
        let baseConfidence = 50;

        const isTrendBias = Math.abs(metrics.breadth) > 40;
        const isExpandingVol = metrics.avgZScore > 1.0;
        const isIncreasingOI = metrics.avgOIChange > 1.0;

        if (isTrendBias && isExpandingVol && isIncreasingOI) {
            status = MARKET_REGIMES.TREND_EXPANSION;
            riskState = 'ON';
            baseConfidence = 85 + Math.min((metrics.avgZScore - 1.0) * 10, 15);
        } 
        else if (metrics.avgZScore < 0.6 && Math.abs(metrics.breadth) < 30) {
            status = MARKET_REGIMES.COMPRESSION_SQUEEZE;
            riskState = 'NEUTRAL';
            baseConfidence = 70; // High confidence that we are in a squeeze
        }
        else if (metrics.avgOIChange < -5.0 && metrics.avgZScore > 1.5) {
            status = MARKET_REGIMES.LIQUIDATION_CASCADE;
            riskState = 'OFF';
            baseConfidence = 95; // Liquidations are mathematically obvious
        }
        else if (isTrendBias && !isIncreasingOI) {
            status = MARKET_REGIMES.TREND_EXHAUSTION;
            riskState = 'CAUTION';
            baseConfidence = 65;
        }
        else {
            status = MARKET_REGIMES.CHOP_MATRIX;
            riskState = 'OFF';
            baseConfidence = 80; // High confidence to avoid trading
        }

        // Adjust confidence slightly based on funding anomalies
        if (Math.abs(metrics.avgFunding) > 0.005) {
            // High funding means crowded market, lower our confidence in trend continuation
            baseConfidence -= 10;
        }

        return {
            status,
            bias,
            volatility,
            participation,
            riskState,
            confidence: Math.round(Math.min(Math.max(baseConfidence, 0), 100))
        };
    }

    /**
     * Commits the calculated Market Pulse to the Alpha state slice.
     * UI components will reactively update upon this mutation.
     * @param {Object} pulse - The complete Market Pulse object.
     * @private
     */
    _commitToState(pulse) {
        globalState.update('alpha', (currentState) => ({
            ...currentState,
            marketPulse: pulse,
            // Legacy support for basic regime string
            regime: pulse.status 
        }));
    }
}

// Export singleton instance
export const marketRegimeEngine = new MarketRegimeEngine();
