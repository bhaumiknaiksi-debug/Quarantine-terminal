/**
 * @file /js/services/okxService.js
 */

import { globalEventBus } from '../core/eventBus.js';
import { SYSTEM_EVENTS } from '../constants.js';
import { globalState } from '../core/state.js';

class OKXService {
    constructor() {
        this.ws = null;
        this.url = 'wss://ws.okx.com:8443/ws/v5/public';
        this.pingInterval = null;
    }

    async connect() {
        this._updateStatus('CONNECTING');
        
        try {
            this.ws = new WebSocket(this.url);
            
            this.ws.onopen = () => {
                console.info('[OKXService] Public WebSocket Connected.');
                this._updateStatus('CONNECTED');
                this._subscribe();
                
                // Keep-alive ping
                this.pingInterval = setInterval(() => {
                    if (this.ws.readyState === WebSocket.OPEN) {
                        this.ws.send('ping');
                    }
                }, 20000);
            };

            this.ws.onmessage = (event) => {
                if (event.data === 'pong') return;
                try {
                    const payload = JSON.parse(event.data);
                    if (payload.data && payload.arg && payload.arg.channel === 'tickers') {
                        globalEventBus.emit(SYSTEM_EVENTS.MARKET_DATA_RECEIVED, payload.data);
                    }
                } catch (e) {
                    // Ignore raw string errors
                }
            };

            this.ws.onclose = () => {
                console.warn('[OKXService] WebSocket Closed. Reconnecting...');
                this._updateStatus('DISCONNECTED');
                if (this.pingInterval) clearInterval(this.pingInterval);
                setTimeout(() => this.connect(), 5000);
            };

        } catch (error) {
            this._updateStatus('DISCONNECTED');
        }
    }

    _subscribe() {
        // Core universe to watch for signals
        const msg = {
            op: 'subscribe',
            args: [
                { channel: 'tickers', instId: 'BTC-USDT' },
                { channel: 'tickers', instId: 'ETH-USDT' },
                { channel: 'tickers', instId: 'SOL-USDT' }
            ]
        };
        this.ws.send(JSON.stringify(msg));
    }

    _updateStatus(status) {
        globalState.update('performance', current => ({
            ...current,
            wsStatus: status
        }));
    }
}

export const okxService = new OKXService();
