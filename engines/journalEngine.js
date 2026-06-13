/**
 * @file /engines/journalEngine.js
 * @description The immutable ledger and historical performance engine for EDGE V6.
 * Implements O(1) metric aggregation, trade lifecycle upserts, and quantitative 
 * R-multiple expectancy tracking. Orchestrates debounced IndexedDB persistence.
 * @version 6.2.0
 * @module journalEngine
 */

import { SYSTEM_EVENTS, STORAGE_KEYS } from '../constants.js';
import { globalEventBus } from '../core/eventBus.js';
import { globalState } from '../core/state.js';
import { storageService } from '../services/storageService.js';
import { backgroundScheduler } from '../core/scheduler.js';

class JournalEngine {
    constructor() {
        this._trades = [];
        this._isDirty = false;
        
        // O(1) Running Aggregations
        this._running = {
            wins: 0,
            losses: 0,
            grossProfit: 0,
            grossLoss: 0,
            totalR: 0,
            closedCount: 0,
            openCount: 0
        };

        this._unsubscribers = [];
        this._persistDebounceTimer = null;

        this._handleTradeExecution = this._handleTradeExecution.bind(this);
        this._persistToStorage = this._persistToStorage.bind(this);
    }

    /**
     * Initializes the Journal Engine.
     * Hydrates historical data, builds O(1) running totals, and connects event streams.
     */
    async init() {
        try {
            const historicalData = await storageService.get(STORAGE_KEYS.JOURNAL_DATABASE);
            if (historicalData && Array.isArray(historicalData)) {
                // Sort descending by timestamp
                this._trades = historicalData.sort((a, b) => b.timestamp - a.timestamp);
                this._buildRunningTotals(); // Reconstruct O(1) metrics once on boot
            }
        } catch (error) {
            console.error('[JournalEngine] Failed to hydrate historical journal:', error);
        }

        this._commitToState();

        // Bind event stream and store unsubscribe reference for safe teardown
        const unsub = globalEventBus.on(SYSTEM_EVENTS.TRADE_EXECUTED, this._handleTradeExecution);
        this._unsubscribers.push(unsub);

        // Schedule background persistence
        backgroundScheduler.scheduleIdle('journal_persistence', this._persistToStorage);

        console.info(`[JournalEngine] Initialized. Tracking ${this._running.closedCount} closed and ${this._running.openCount} open records.`);
    }

    /**
     * Processes trade events: Automatically determines if this is a new OPEN order 
     * or a status update for an existing trade (CLOSED).
     * @param {Object} payload 
     * @private
     */
    _handleTradeExecution(payload) {
        if (!payload.id) {
            console.error('[JournalEngine] Execution payload missing required ID.');
            return;
        }

        const existingIndex = this._trades.findIndex(t => t.id === payload.id);
        const now = Date.now();

        if (existingIndex > -1) {
            // UPDATING EXISTING TRADE (e.g., Closing it)
            const trade = this._trades[existingIndex];
            
            // If it was open and is now closed, update O(1) running totals
            if (trade.status === 'OPEN' && payload.status === 'CLOSED') {
                this._running.openCount = Math.max(0, this._running.openCount - 1);
                this._running.closedCount++;
                
                trade.exitPrice = payload.exitPrice;
                trade.closedAt = now;
                trade.duration = now - trade.timestamp;
                trade.realizedPnL = payload.realizedPnL || 0;
                trade.realizedR = payload.realizedR || 0;
                trade.fees = payload.fees || 0;
                trade.status = 'CLOSED';

                // Aggregate new PnL / R-Multiples
                this._running.totalR += trade.realizedR;
                if (trade.realizedPnL > 0) {
                    this._running.wins++;
                    this._running.grossProfit += trade.realizedPnL;
                } else {
                    this._running.losses++;
                    this._running.grossLoss += Math.abs(trade.realizedPnL);
                }
            }
        } else {
            // NEW TRADE (OPEN)
            const currentAlpha = globalState.get('alpha');
            const currentRisk = globalState.get('risk');

            const newTrade = {
                id: payload.id,
                timestamp: now,
                symbol: payload.symbol,
                direction: payload.direction,
                entryPrice: payload.entryPrice,
                size: payload.size || 0,
                leverage: payload.leverage || 1,
                status: 'OPEN',
                
                // Enriched Institutional Metadata
                alphaScore: currentAlpha?.bestTrade?.alphaScore || 0,
                marketRegime: currentAlpha?.marketPulse?.status || 'UNKNOWN',
                heatScore: currentRisk?.heatScore || 0,
                expectancyAtEntry: payload.expectancyAtEntry || 0,
                
                // Nullable exit fields
                exitPrice: null,
                closedAt: null,
                duration: 0,
                realizedPnL: 0,
                realizedR: 0,
                fees: 0
            };

            this._running.openCount++;
            
            // Prepend new trade to maintain descending order
            this._trades.unshift(newTrade);
        }

        this._isDirty = true;
        this._commitToState();
        
        globalState.notify({
            type: 'INFO',
            message: `Ledger Updated: ${payload.direction} ${payload.symbol}`
        });
    }

    /**
     * Boot helper: Reconstructs the O(1) state from hydrated IndexedDB array.
     * Runs exactly once during init().
     * @private
     */
    _buildRunningTotals() {
        this._running = { wins: 0, losses: 0, grossProfit: 0, grossLoss: 0, totalR: 0, closedCount: 0, openCount: 0 };
        
        for (const trade of this._trades) {
            if (trade.status === 'OPEN') {
                this._running.openCount++;
            } else if (trade.status === 'CLOSED') {
                this._running.closedCount++;
                this._running.totalR += trade.realizedR;
                
                if (trade.realizedPnL > 0) {
                    this._running.wins++;
                    this._running.grossProfit += trade.realizedPnL;
                } else {
                    this._running.losses++;
                    this._running.grossLoss += Math.abs(trade.realizedPnL);
                }
            }
        }
    }

    /**
     * Computes final metrics from O(1) aggregates and commits to the immutable state tree.
     * Prevents schema drift by maintaining the flat structure requested by the UI.
     * @private
     */
    _commitToState() {
        const total = this._running.closedCount;
        const winRate = total > 0 ? (this._running.wins / total) : 0;
        
        // Currency Expectancy: (Win% * AvgWin) - (Loss% * AvgLoss)
        const avgWin = this._running.wins > 0 ? (this._running.grossProfit / this._running.wins) : 0;
        const avgLoss = this._running.losses > 0 ? (this._running.grossLoss / this._running.losses) : 0;
        const expectancyCurrency = total > 0 ? (winRate * avgWin) - ((1 - winRate) * avgLoss) : 0;
        
        // Quantitative Expectancy: Average R-Multiple per trade
        const expectancyR = total > 0 ? (this._running.totalR / total) : 0;

        const netPnL = this._running.grossProfit - this._running.grossLoss;

        globalState.update('journal', current => ({
            ...current,
            trades: this._trades,
            openTrades: this._running.openCount,
            closedTrades: this._running.closedCount,
            winRate,
            expectancyCurrency,
            expectancyR,
            netPnL
        }));
    }

    /**
     * Synchronizes the in-memory ledger to IndexedDB.
     * Features debouncing so multiple rapid executions don't thrash the disk.
     * @private
     */
    _persistToStorage() {
        if (!this._isDirty) return;

        // Debounce: Wait for 5 seconds of idle inactivity before writing
        if (this._persistDebounceTimer) {
            clearTimeout(this._persistDebounceTimer);
        }

        this._persistDebounceTimer = setTimeout(async () => {
            try {
                // Ensure the storageService explicitly saves the Journal store
                await storageService.set(STORAGE_KEYS.JOURNAL_DATABASE, this._trades);
                this._isDirty = false;
                globalEventBus.emit(SYSTEM_EVENTS.JOURNAL_SYNCED);
                console.info('[JournalEngine] Historical ledger synchronized to IndexedDB.');
            } catch (error) {
                console.error('[JournalEngine] Background persistence failed:', error);
            }
        }, 5000);
    }

    /**
     * Graceful teardown.
     */
    destroy() {
        this._unsubscribers.forEach(unsub => unsub());
        this._unsubscribers = [];
        if (this._persistDebounceTimer) clearTimeout(this._persistDebounceTimer);
    }
}

export const journalEngine = new JournalEngine();
