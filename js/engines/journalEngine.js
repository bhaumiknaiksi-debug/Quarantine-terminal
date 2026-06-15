/**
 * @file /js/engines/journalEngine.js
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
        
        this._running = { wins: 0, losses: 0, grossProfit: 0, grossLoss: 0, totalR: 0, closedCount: 0, openCount: 0 };
        this._unsubscribers = [];
        this._persistDebounceTimer = null;

        this._handleTradeExecution = this._handleTradeExecution.bind(this);
        this._persistToStorage = this._persistToStorage.bind(this);
    }

    async init() {
        try {
            const data = await storageService.get(STORAGE_KEYS.JOURNAL_DATABASE);
            if (data && Array.isArray(data)) {
                this._trades = data.sort((a, b) => b.timestamp - a.timestamp);
                this._buildRunningTotals();
            }
        } catch (e) {
            console.error('[JournalEngine] Hydration failed', e);
        }

        this._commitToState();
        const unsub = globalEventBus.on(SYSTEM_EVENTS.TRADE_EXECUTED, this._handleTradeExecution);
        this._unsubscribers.push(unsub);
        
        backgroundScheduler.scheduleIdle('journal_persistence', this._persistToStorage);
    }

    _handleTradeExecution(payload) {
        if (!payload.id) return;

        const idx = this._trades.findIndex(t => t.id === payload.id);
        const now = Date.now();

        if (idx > -1) {
            const t = this._trades[idx];
            if (t.status === 'OPEN' && payload.status === 'CLOSED') {
                this._running.openCount = Math.max(0, this._running.openCount - 1);
                this._running.closedCount++;
                
                t.exitPrice = payload.exitPrice;
                t.realizedPnL = payload.realizedPnL || 0;
                t.realizedR = payload.realizedR || 0;
                t.status = 'CLOSED';

                this._running.totalR += t.realizedR;
                if (t.realizedPnL > 0) {
                    this._running.wins++;
                    this._running.grossProfit += t.realizedPnL;
                } else {
                    this._running.losses++;
                    this._running.grossLoss += Math.abs(t.realizedPnL);
                }
            }
        } else {
            this._running.openCount++;
            this._trades.unshift({
                id: payload.id,
                timestamp: now,
                symbol: payload.symbol,
                direction: payload.direction,
                status: 'OPEN',
                realizedPnL: 0,
                realizedR: 0
            });
        }

        this._isDirty = true;
        this._commitToState();
    }

    _buildRunningTotals() {
        this._running = { wins: 0, losses: 0, grossProfit: 0, grossLoss: 0, totalR: 0, closedCount: 0, openCount: 0 };
        for (const t of this._trades) {
            if (t.status === 'OPEN') {
                this._running.openCount++;
            } else if (t.status === 'CLOSED') {
                this._running.closedCount++;
                this._running.totalR += t.realizedR;
                if (t.realizedPnL > 0) { this._running.wins++; this._running.grossProfit += t.realizedPnL; }
                else { this._running.losses++; this._running.grossLoss += Math.abs(t.realizedPnL); }
            }
        }
    }

    _commitToState() {
        const total = this._running.closedCount;
        const winRate = total > 0 ? (this._running.wins / total) : 0;
        const avgWin = this._running.wins > 0 ? (this._running.grossProfit / this._running.wins) : 0;
        const avgLoss = this._running.losses > 0 ? (this._running.grossLoss / this._running.losses) : 0;
        
        globalState.update('journal', current => ({
            ...current,
            trades: this._trades,
            winRate,
            expectancyCurrency: total > 0 ? (winRate * avgWin) - ((1 - winRate) * avgLoss) : 0,
            expectancyR: total > 0 ? (this._running.totalR / total) : 0,
            netPnL: this._running.grossProfit - this._running.grossLoss,
            closedTrades: this._running.closedCount
        }));
    }

    _persistToStorage() {
        if (!this._isDirty) return;
        if (this._persistDebounceTimer) clearTimeout(this._persistDebounceTimer);
        
        this._persistDebounceTimer = setTimeout(async () => {
            try {
                await storageService.set(STORAGE_KEYS.JOURNAL_DATABASE, this._trades);
                this._isDirty = false;
            } catch (e) {}
        }, 5000);
    }
}

export const journalEngine = new JournalEngine();
