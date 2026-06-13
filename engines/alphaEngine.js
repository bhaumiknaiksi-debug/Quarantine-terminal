/**
 * @file /engines/alphaEngine.js
 * @description The core quantitative intelligence and "Trader Brain" for EDGE V6.
 * Processes pre-qualified assets to compute proprietary Alpha Scores, Expected Value (EV),
 * and probability matrixes. Generates execution parameters (Entry, Stop, Take Profit) 
 * and selects the single highest-conviction setup for the Command Center.
 * @version 6.0.0
 * @module alphaEngine
 */

import { globalState } from '../core/state.js';
import { taskScheduler, PRIORITY } from '../core/scheduler.js';

class AlphaEngine {
    constructor() {
        /**
         * Core weightings for the Composite Alpha Score (Maximum 100).
         * @private
         */
        this._weights = {
            MOMENTUM_Z: 35,       // High weighting for volatility/momentum expansion
            TREND_ALIGNMENT: 25,  // 24h structural trend alignment
            OI_CONFIRMATION: 20,  // Open Interest delta confirming participation
            FUNDING_EDGE: 20      // Contrarian or neutral funding advantage
        };

        this._scoreUniverse = this._scoreUniverse.bind(this);
    }

    /**
     * Initializes the Alpha Engine.
     * Hooks into the Task Scheduler to run continuously, but slightly offset 
     * from the Qualification Engine to ensure fresh filtered data.
     * @returns {Promise<void>}
     */
    async init() {
        taskScheduler.schedule(
            'alpha_scoring_loop',
            this._scoreUniverse,
            1500, // 1.5s interval to preserve CPU while maintaining high responsiveness
            PRIORITY.HIGH
        );

        console.info('[AlphaEngine] Initialized. Awaiting qualified asset streams.');
    }

    /**
     * Retrieves qualified assets, scores them, generates execution plans, 
     * sorts the Hot List, and identifies the absolute Best Trade.
     * @private
     */
    _scoreUniverse() {
        const state = globalState.get();
        const { market, scanner, alpha, settings } = state;

        if (!alpha.qualifiedSymbols || alpha.qualifiedSymbols.length === 0) {
            this._handleNoQualifiedAssets(market.lastUpdate);
            return;
        }

        const scoredMatrix = [];

        for (const symbol of alpha.qualifiedSymbols) {
            const mData = market.assets[symbol];
            const sData = scanner.metrics[symbol];

            if (!mData || !sData) continue;

            const setup = this._computeSetup(symbol, mData, sData, settings);
            if (setup) {
                scoredMatrix.push(setup);
            }
        }

        // Sort by pure Alpha Score (descending)
        scoredMatrix.sort((a, b) => b.alphaScore - a.alphaScore);

        this._commitToState(scoredMatrix);
    }

    /**
     * Computes the full execution profile and Alpha Score for a single asset.
     * @param {string} symbol 
     * @param {Object} mData - Market pricing data.
     * @param {Object} sData - Scanner structural data.
     * @param {Object} settings - System settings (FX rates, multipliers).
     * @returns {Object|null} The computed setup profile.
     * @private
     */
    _computeSetup(symbol, mData, sData, settings) {
        try {
            // 1. Establish Directional Bias
            const direction = mData.chg24h >= 0 ? 'LONG' : 'SHORT';
            const dirMultiplier = direction === 'LONG' ? 1 : -1;

            // 2. Compute Base Alpha Score Matrix
            let score = 0;

            // Momentum Contribution (Using Z-Score)
            // Reward high Z-Scores that align with the 24h trend direction
            const alignedZ = sData.volatility.zScore * dirMultiplier;
            if (alignedZ > 0) {
                // Cap Z-Score contribution at 3.0 Standard Deviations
                const zFactor = Math.min(alignedZ / 3.0, 1.0);
                score += this._weights.MOMENTUM_Z * zFactor;
            }

            // Trend Contribution
            const chgFactor = Math.min(Math.abs(mData.chg24h) / 10.0, 1.0); // Normalize to 10% move
            score += this._weights.TREND_ALIGNMENT * chgFactor;

            // Open Interest Contribution (Increasing OI confirms trend)
            if (sData.oiChange > 0) {
                const oiFactor = Math.min(sData.oiChange / 5.0, 1.0); // Normalize to 5% delta
                score += this._weights.OI_CONFIRMATION * oiFactor;
            }

            // Funding Edge (Penalty for crowded trades, reward for getting paid to hold)
            // If LONG, negative funding is good. If SHORT, positive funding is good.
            const alignedFunding = sData.fundingRate * dirMultiplier * -1;
            if (alignedFunding > 0) {
                score += this._weights.FUNDING_EDGE; // Max points if being paid
            } else {
                // Penalize crowded side, but cap penalty
                const penalty = Math.min(Math.abs(sData.fundingRate) / 0.005, 1.0);
                score += this._weights.FUNDING_EDGE * (1 - penalty);
            }

            // Clamp total score
            const alphaScore = Math.max(0, Math.min(Math.round(score), 100));

            // 3. Execution Parameter Generation
            const meanATR = sData.volatility.atrM;
            const fxRate = settings.fxRate || 1; // Default to USD if INR FX missing
            
            // Dynamic Entry Zone (± 15% of ATR around current price)
            const ezOffset = meanATR * 0.15;
            const entryLow = (mData.price - ezOffset) * fxRate;
            const entryHigh = (mData.price + ezOffset) * fxRate;

            // Stop Loss (2 ATRs against the trade)
            const stopLoss = (mData.price - (meanATR * 2 * dirMultiplier)) * fxRate;
            
            // Take Profit (Targeting 2.5 Reward/Risk ratio by default -> 5 ATRs)
            const takeProfit = (mData.price + (meanATR * 5 * dirMultiplier)) * fxRate;

            // Probability & Expected Value Mapping
            // A score of 50 = ~40% win rate. A score of 95 = ~80% win rate.
            const probability = Math.round(30 + (alphaScore * 0.55)); 
            const expectedValueR = ((probability / 100) * 2.5) - (((100 - probability) / 100) * 1.0);

            // Hold Time Estimation based on Volatility
            const holdTime = sData.volatility.zScore > 1.5 ? "8-24H" : "1-3D";

            return {
                symbol,
                assetName: symbol.replace('-USDT-SWAP', '').replace('-SWAP', ''),
                direction,
                alphaScore,
                probability: `${probability}%`,
                expectedValue: `+${expectedValueR.toFixed(2)}R`,
                execution: {
                    price: mData.price * fxRate,
                    entryZone: [Math.min(entryLow, entryHigh), Math.max(entryLow, entryHigh)],
                    stopLoss,
                    takeProfit,
                    riskReward: '1:2.5',
                    holdTime
                },
                metrics: {
                    zScore: sData.volatility.zScore,
                    oiChange: sData.oiChange,
                    funding: sData.fundingRate
                }
            };
        } catch (error) {
            console.error(`[AlphaEngine] Execution generation failed for ${symbol}:`, error);
            return null;
        }
    }

    /**
     * Generates a concise, Bloomberg-style AI narrative for the top setup.
     * Reduces cognitive load by translating raw metrics into actionable English.
     * @param {Object} setup - The highest ranked setup.
     * @returns {string} 
     * @private
     */
    _generateTraderBrainNarrative(setup) {
        const parts = [];
        const dirText = setup.direction === 'LONG' ? 'upward' : 'downward';

        parts.push(`High-conviction ${setup.direction} detected on ${setup.assetName}.`);
        
        if (Math.abs(setup.metrics.zScore) > 1.5) {
            parts.push(`Momentum is aggressively expanding ${dirText}.`);
        } else {
            parts.push(`Trend is stable with standard variance.`);
        }

        if (setup.metrics.oiChange > 2.0) {
            parts.push(`Open Interest (+${setup.metrics.oiChange.toFixed(1)}%) confirms institutional participation.`);
        }

        if ((setup.direction === 'LONG' && setup.metrics.funding < 0) || 
            (setup.direction === 'SHORT' && setup.metrics.funding > 0)) {
            parts.push(`Funding edge provides a holding advantage.`);
        }

        parts.push(`Expected value highly positive (${setup.expectedValue}). Recommended action: Scale in immediately.`);

        return parts.join(' ');
    }

    /**
     * Gracefully handles states where no assets pass the qualification engine.
     * Prevents forced trades during chop or toxic regimes.
     * @param {number} lastUpdate - Timestamp of the last market tick.
     * @private
     */
    _handleNoQualifiedAssets(lastUpdate) {
        const isStale = (performance.now() - lastUpdate) > 10000;
        
        const statePayload = {
            hotList: [],
            bestTrade: {
                direction: 'STAY_IN_CASH',
                reason: isStale ? 'SYSTEM_AWAITING_DATA_STREAM' : 'MARKET_CONDITION_TOXIC',
                narrative: isStale 
                    ? 'Awaiting live telemetry from websocket connection.'
                    : 'No assets passed rigid qualification metrics. Market is currently exhibiting uncompensated risk. Capital preservation prioritized. Stay in cash.',
                alphaScore: 0,
                probability: '0%'
            }
        };

        globalState.update('alpha', (current) => ({ ...current, ...statePayload }));
    }

    /**
     * Commits the scored matrix to the global state tree.
     * Slices the Top 5 for the Hot List and formats the Best Trade.
     * @param {Array<Object>} scoredMatrix 
     * @private
     */
    _commitToState(scoredMatrix) {
        if (scoredMatrix.length === 0) {
            this._handleNoQualifiedAssets(performance.now());
            return;
        }

        const bestTrade = scoredMatrix[0];
        bestTrade.narrative = this._generateTraderBrainNarrative(bestTrade);

        globalState.update('alpha', (currentState) => ({
            ...currentState,
            matrix: scoredMatrix,
            hotList: scoredMatrix.slice(0, 5),
            bestTrade: bestTrade
        }));
    }
}

// Export singleton instance
export const alphaEngine = new AlphaEngine();
