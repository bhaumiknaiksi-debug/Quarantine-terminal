/**
 * @file /engines/presentationEngine.js
 * @description Translates raw quantitative state data into decorative View Models.
 * Decouples styling, grading, and badging logic from UI rendering components.
 * @version 6.0.0
 * @module presentationEngine
 */

import { formatter } from '../utils/formatter.js';

class PresentationEngine {
    
    /* ==========================================================================
       GRADING & STYLING MAPPERS
       ========================================================================== */

    getAlphaGrade(score) {
        if (score >= 98) return { label: 'S+', colorClass: 'text-accent', glow: true };
        if (score >= 95) return { label: 'S',  colorClass: 'text-accent', glow: true };
        if (score >= 90) return { label: 'A+', colorClass: 'text-long', glow: false };
        if (score >= 85) return { label: 'A',  colorClass: 'text-long', glow: false };
        if (score >= 80) return { label: 'B+', colorClass: 'text-primary', glow: false };
        if (score >= 70) return { label: 'B',  colorClass: 'text-primary', glow: false };
        if (score >= 60) return { label: 'C',  colorClass: 'text-warn', glow: false };
        return { label: 'D', colorClass: 'text-short', glow: false };
    }

    getHeatStyle(score) {
        if (score > 75) return { label: 'CRITICAL', colorClass: 'text-short', bgClass: 'bg-short-dim', glow: true };
        if (score > 50) return { label: 'HIGH', colorClass: 'text-warn', bgClass: 'bg-warn-dim', glow: false };
        if (score > 25) return { label: 'ELEVATED', colorClass: 'text-primary', bgClass: 'bg-surface-elevated', glow: false };
        return { label: 'LOW', colorClass: 'text-long', bgClass: 'bg-long-dim', glow: false };
    }

    getProbabilityStyle(pctLabel) {
        const pct = parseInt(pctLabel, 10);
        if (pct >= 75) return 'text-long';
        if (pct >= 50) return 'text-warn';
        return 'text-short';
    }

    formatHoldTime(holdTimeLabel) {
        const map = {
            '8-24H': '⚡ Intraday',
            '1-3D': '🌙 Overnight',
            '3-7D': '📅 Swing',
            '1W+': '📈 Position'
        };
        return map[holdTimeLabel] || `🕒 ${holdTimeLabel}`;
    }

    getDirectionStyle(direction) {
        if (direction === 'LONG') return { label: 'LONG', icon: '↗', colorClass: 'text-long' };
        if (direction === 'SHORT') return { label: 'SHORT', icon: '↘', colorClass: 'text-short' };
        return { label: 'STAY IN CASH', icon: '🛡', colorClass: 'text-accent' };
    }

    /* ==========================================================================
       VIEW MODEL FACTORIES
       ========================================================================== */

    /**
     * Constructs the complete View Model for the Command Center UI Component.
     * @param {Object} state - The global state tree slice
     * @returns {Object} Ready-to-render View Model
     */
    buildCommandCenterViewModel(state) {
        const { alpha, portfolio } = state;
        const bestTrade = alpha.bestTrade;

        // Failsafe for missing data
        if (!bestTrade || bestTrade.direction === 'STAY_IN_CASH') {
            return {
                isActive: false,
                title: 'SYSTEM PROTECTIVE MODE',
                badge: { label: 'N/A', colorClass: 'text-muted' },
                narrative: bestTrade?.narrative || 'Awaiting structural market alignment.',
                direction: this.getDirectionStyle('STAY_IN_CASH')
            };
        }

        const grade = this.getAlphaGrade(bestTrade.alphaScore);
        const dir = this.getDirectionStyle(bestTrade.direction);
        const sizing = portfolio.executionPlan;

        return {
            isActive: true,
            title: `${bestTrade.assetName} ${dir.label}`,
            direction: dir,
            grade: grade,
            convictionScore: bestTrade.alphaScore,
            
            // Decorative Labels
            probability: {
                label: bestTrade.probability,
                colorClass: this.getProbabilityStyle(bestTrade.probability)
            },
            expectedValueLabel: bestTrade.expectedValue,
            holdTimeLabel: this.formatHoldTime(bestTrade.execution.holdTime),
            narrative: bestTrade.narrative,

            // Execution Formatting (Pre-formatted Strings)
            execution: {
                entryZoneLabel: `${formatter.price(bestTrade.execution.entryZone[0])} - ${formatter.price(bestTrade.execution.entryZone[1])}`,
                stopLossLabel: formatter.price(bestTrade.execution.stopLoss),
                takeProfitLabel: formatter.price(bestTrade.execution.takeProfit),
                rrLabel: bestTrade.execution.riskReward
            },

            // Sizing Integration (If Portfolio Engine has calculated it)
            sizing: sizing ? {
                riskLabel: formatter.currencyINR(sizing.riskAmount),
                marginLabel: formatter.currencyINR(sizing.requiredMargin),
                coinQuantity: sizing.coinQuantity
            } : null
        };
    }
}

// Freeze singleton to prevent runtime mutations
export const presentationEngine = Object.freeze(new PresentationEngine());
