/**
 * @file /engines/presentationEngine.js (Extensions)
 * @description Added mappers for Market Regime, Network Status, and Capital Allocation.
 */

// ... (previous Alpha & Heat mappers remain) ...

    /* ==========================================================================
       NETWORK & TELEMETRY MAPPERS
       ========================================================================== */

    getNetworkStatus(wsStatus) {
        const map = {
            'CONNECTED': { label: 'LIVE', colorClass: 'text-long', glow: true },
            'CONNECTING': { label: 'SYNCING', colorClass: 'text-warn', glow: true },
            'RECONNECTING': { label: 'SYNCING', colorClass: 'text-warn', glow: true },
            'DISCONNECTED': { label: 'OFFLINE', colorClass: 'text-short', glow: false }
        };
        return map[wsStatus] || map['DISCONNECTED'];
    }

    /* ==========================================================================
       MACRO REGIME MAPPERS
       ========================================================================== */

    buildMarketRegimeViewModel(state) {
        const { alpha, performance } = state;
        const pulse = alpha.marketPulse;

        if (!pulse || pulse.status === 'AWAITING_DATA') {
            return { isReady: false };
        }

        // Structural Color Mappings
        const getBias = (bias) => {
            if (bias.includes('BULLISH')) return { label: bias.replace('_', ' '), color: 'text-long' };
            if (bias.includes('BEARISH')) return { label: bias.replace('_', ' '), color: 'text-short' };
            return { label: 'NEUTRAL', color: 'text-info' };
        };

        const getVol = (vol) => {
            if (vol === 'EXTREME') return { label: vol, color: 'text-short' };
            if (vol === 'EXPANDING') return { label: vol, color: 'text-long' };
            return { label: vol, color: 'text-info' };
        };

        const getPart = (part) => {
            if (part.includes('SURGING')) return { label: part, color: 'text-long' };
            if (part.includes('LIQUIDATIONS')) return { label: part, color: 'text-short' };
            if (part.includes('DECREASING')) return { label: part, color: 'text-warn' };
            return { label: 'FLAT', color: 'text-muted' };
        };

        const getRisk = (state) => {
            const map = { 'ON': 'text-long', 'CAUTION': 'text-warn', 'NEUTRAL': 'text-info', 'OFF': 'text-short' };
            const bgMap = { 'ON': 'bg-long', 'CAUTION': 'bg-warn', 'NEUTRAL': 'bg-info', 'OFF': 'bg-short' };
            return { colorClass: map[state], bgClass: bgMap[state] };
        };

        // Narrative Generation
        let narrative = `Broad participation and standard variance.`;
        if (pulse.status === 'TREND_EXPANSION') narrative = `Broad participation with expanding volatility confirms a healthy trend regime. Risk allocation can remain elevated.`;
        if (pulse.status === 'COMPRESSION_SQUEEZE') narrative = `Volatility is highly compressed. The market is coiling for a major directional expansion. Avoid overtrading chop.`;
        if (pulse.status === 'LIQUIDATION_CASCADE') narrative = `Violent liquidation event in progress. Open interest is plummeting. Capital preservation is the absolute priority.`;

        const riskTheme = getRisk(pulse.riskState);

        return {
            isReady: true,
            network: this.getNetworkStatus(performance.wsStatus),
            regime: {
                label: pulse.status.replace('_', ' '),
                colorClass: riskTheme.colorClass,
                progressClass: riskTheme.bgClass
            },
            narrative: narrative,
            confidence: {
                value: pulse.confidence,
                label: `${pulse.confidence}%`,
                scale: pulse.confidence / 100 // 0.0 to 1.0 for GPU scaling
            },
            metrics: [
                { title: 'BREADTH BIAS', ...getBias(pulse.bias) },
                { title: 'VOLATILITY', ...getVol(pulse.volatility) },
                { title: 'PARTICIPATION', ...getPart(pulse.participation) }
            ]
        };
    }

    /* ==========================================================================
       CAPITAL & PORTFOLIO MAPPERS
       ========================================================================== */

    buildCapitalViewModel(state) {
        const { portfolio } = state;
        
        // Failsafe / Skeleton
        if (!portfolio || portfolio.totalEquity === undefined) {
            return { isReady: false };
        }

        const equity = portfolio.totalEquity;
        const margin = portfolio.availableMargin;
        const exposure = portfolio.openExposure;
        
        // Calculate health (Margin usage)
        const marginUsagePct = equity > 0 ? ((equity - margin) / equity) : 0;
        let healthColor = 'text-long';
        let healthBg = 'bg-long';
        if (marginUsagePct > 0.8) { healthColor = 'text-short'; healthBg = 'bg-short'; }
        else if (marginUsagePct > 0.5) { healthColor = 'text-warn'; healthBg = 'bg-warn'; }

        // Process Target Allocations from Capital Allocator Engine
        const allocations = portfolio.targetAllocations || { CASH: 100 };
        const allocationList = Object.entries(allocations).map(([asset, pct]) => {
            return {
                asset,
                percentageLabel: `${pct}%`,
                scale: pct / 100,
                colorClass: asset === 'CASH' ? 'text-info' : 'text-primary',
                bgClass: asset === 'CASH' ? 'bg-info' : 'bg-primary'
            };
        });

        // Sort: Cash always first, then largest to smallest
        allocationList.sort((a, b) => {
            if (a.asset === 'CASH') return -1;
            if (b.asset === 'CASH') return 1;
            return b.scale - a.scale;
        });

        return {
            isReady: true,
            metrics: {
                equity: formatter.currencyINR(equity, true),
                margin: formatter.currencyINR(margin, true),
                exposure: formatter.currencyINR(exposure, true)
            },
            health: {
                label: formatter.percentage(marginUsagePct, false) + ' USED',
                colorClass: healthColor,
                bgClass: healthBg,
                scale: Math.min(marginUsagePct, 1.0)
            },
            allocations: allocationList
        };
    }
