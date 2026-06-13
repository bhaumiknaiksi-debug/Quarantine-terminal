/**
 * @file /engines/riskRadarEngine.js
 * @description Operational Risk and Capital Preservation Engine for EDGE V6.
 * Continuously monitors the unified data streams for structural vulnerabilities 
 * (extreme funding, OI spikes, weekend liquidity, liquidation clusters).
 * Computes portfolio "Heat Level" and generates actionable "Danger Panel" warnings.
 * @version 6.0.0
 * @module riskRadarEngine
 */

import { globalState } from '../core/state.js';
import { taskScheduler, PRIORITY } from '../core/scheduler.js';
import { MARKET_REGIMES } from '../constants.js';

class RiskRadarEngine {
    constructor() {
        /**
         * Risk calibration thresholds.
         * @private
         */
        this._thresholds = {
            toxicFunding: 0.0075,      // 0.75% per epoch is dangerously crowded
            oiSpike: 10.0,             // 10% sudden jump in Open Interest implies leverage buildup
            maxPortfolioHeat: 80,      // Max acceptable heat score before forced deleveraging
            drawdownAlert: -10.0       // 10% drop within 24h triggers an asset-specific warning
        };

        this._evaluateEnvironment = this._evaluateEnvironment.bind(this);
    }

    /**
     * Initializes the Risk Radar Engine.
     * Hooks into the Task Scheduler for continuous background evaluation.
     * @returns {Promise<void>}
     */
    async init() {
        // Runs at a 2000ms (2s) interval. Risk vectors evolve slightly slower 
        // than tick data but require faster reaction times than the macro regime.
        taskScheduler.schedule(
            'risk_radar_loop',
            this._evaluateEnvironment,
            2000,
            PRIORITY.HIGH
        );

        console.info('[RiskRadarEngine] Initialized. Monitoring structural vulnerabilities.');
    }

    /**
     * Evaluates all data slices to generate the overarching Risk State.
     * Commits warnings and heat levels to the 'risk' state slice.
     * @private
     */
    _evaluateEnvironment() {
        const state = globalState.get();
        const { market, scanner, alpha, portfolio } = state;

        if (!market?.assets || !scanner?.metrics) return;

        const warnings = [];
        let heatScore = 0; // Scale 0 - 100

        // 1. Evaluate Time/Macro Based Risk
        const timeRisk = this._evaluateTemporalRisk();
        if (timeRisk) {
            warnings.push(timeRisk);
            heatScore += timeRisk.heatPenalty;
        }

        // 2. Evaluate Regime Based Risk
        if (alpha.marketPulse && alpha.marketPulse.riskState === 'OFF') {
            warnings.push({
                type: 'SYSTEMIC',
                severity: 'CRITICAL',
                message: `Macro regime is ${alpha.marketPulse.status}. Capital protection prioritized.`
            });
            heatScore += 40;
        }

        // 3. Evaluate Asset-Specific Structural Vulnerabilities
        const assetRisks = this._evaluateAssetRisks(market.assets, scanner.metrics);
        warnings.push(...assetRisks.warnings);
        heatScore += assetRisks.heatContribution;

        // 4. Evaluate Portfolio Exposure Risk (If data is available)
        if (portfolio.openExposure > 0 && portfolio.totalEquity > 0) {
            const exposureRisk = this._evaluatePortfolioRisk(portfolio);
            if (exposureRisk) {
                warnings.push(exposureRisk);
                heatScore += exposureRisk.heatPenalty;
            }
        }

        // 5. Finalize and Commit Heat Matrix
        heatScore = Math.min(Math.max(Math.round(heatScore), 0), 100);
        
        let currentHeat = 'LOW';
        if (heatScore > 75) currentHeat = 'CRITICAL';
        else if (heatScore > 50) currentHeat = 'HIGH';
        else if (heatScore > 25) currentHeat = 'ELEVATED';

        // Sort warnings by severity
        const severityMap = { 'CRITICAL': 3, 'HIGH': 2, 'MODERATE': 1 };
        warnings.sort((a, b) => severityMap[b.severity] - severityMap[a.severity]);

        this._commitToState(currentHeat, heatScore, warnings);
    }

    /**
     * Checks for temporal risks (e.g., Weekend low-liquidity gaps).
     * @returns {Object|null} Warning object or null.
     * @private
     */
    _evaluateTemporalRisk() {
        const now = new Date();
        const day = now.getUTCDay();
        const isWeekend = (day === 0 || day === 6);

        if (isWeekend) {
            return {
                type: 'LIQUIDITY',
                severity: 'MODERATE',
                message: 'Weekend environment detected. Beware of low liquidity sweeps and fakeouts.',
                heatPenalty: 15
            };
        }
        return null;
    }

    /**
     * Scans the asset universe for localized structural risks like toxic funding or massive OI spikes.
     * @param {Object} marketAssets 
     * @param {Object} scannerMetrics 
     * @returns {Object} Aggregated warnings and heat contribution.
     * @private
     */
    _evaluateAssetRisks(marketAssets, scannerMetrics) {
        const warnings = [];
        let heatContribution = 0;

        for (const [symbol, marketData] of Object.entries(marketAssets)) {
            const scannerData = scannerMetrics[symbol];
            if (!scannerData) continue;

            const assetName = symbol.split('-')[0];

            // A. Toxic Funding Rate Check (Crowded Trade)
            if (Math.abs(scannerData.fundingRate) > this._thresholds.toxicFunding) {
                const bias = scannerData.fundingRate > 0 ? 'LONG' : 'SHORT';
                warnings.push({
                    type: 'STRUCTURAL',
                    severity: 'HIGH',
                    message: `Toxic funding on ${assetName} (${(scannerData.fundingRate * 100).toFixed(2)}%). ${bias}s are crowded. High squeeze probability.`
                });
                heatContribution += 10;
            }

            // B. Sudden Open Interest Spike
            if (scannerData.oiChange > this._thresholds.oiSpike) {
                warnings.push({
                    type: 'VOLATILITY',
                    severity: 'MODERATE',
                    message: `Massive OI injection on ${assetName} (+${scannerData.oiChange.toFixed(1)}%). Imminent volatility expansion.`
                });
                heatContribution += 5;
            }

            // C. Excessive Intraday Drawdown
            if (marketData.chg24h < this._thresholds.drawdownAlert) {
                warnings.push({
                    type: 'TREND',
                    severity: 'HIGH',
                    message: `${assetName} exhibiting severe weakness (${marketData.chg24h.toFixed(1)}%). Avoid long entries.`
                });
                // Does not add system heat unless we are holding it (handled in portfolio risk)
            }
        }

        return { warnings, heatContribution };
    }

    /**
     * Evaluates gross exposure and leverage limits.
     * @param {Object} portfolio 
     * @returns {Object|null}
     * @private
     */
    _evaluatePortfolioRisk(portfolio) {
        // Calculate gross leverage (Exposure / Equity)
        const leverage = portfolio.openExposure / portfolio.totalEquity;

        if (leverage > 2.5) {
            return {
                type: 'EXPOSURE',
                severity: 'CRITICAL',
                message: `Gross leverage (${leverage.toFixed(2)}x) exceeds safe quantitative boundaries. De-risk immediately.`,
                heatPenalty: 30
            };
        } else if (leverage > 1.5) {
             return {
                type: 'EXPOSURE',
                severity: 'HIGH',
                message: `Elevated gross leverage (${leverage.toFixed(2)}x). Monitor margins closely.`,
                heatPenalty: 15
            };
        }

        return null;
    }

    /**
     * Commits the risk calculations to the global state tree.
     * @param {string} currentHeat 
     * @param {number} heatScore 
     * @param {Array<Object>} warnings 
     * @private
     */
    _commitToState(currentHeat, heatScore, warnings) {
        globalState.update('risk', (currentState) => ({
            ...currentState,
            currentHeat: currentHeat,
            heatScore: heatScore,
            radarWarnings: warnings
        }));
    }
}

// Export singleton instance
export const riskRadarEngine = new RiskRadarEngine();
