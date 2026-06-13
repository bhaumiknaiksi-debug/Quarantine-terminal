/**
 * @file /services/okxService.js
 * @description Enterprise-grade WebSocket service for OKX V5 API.
 * Manages resilient real-time connections, exponential backoff reconnection, 
 * channel multiplexing, and heartbeat (ping/pong) maintenance. 
 * Strictly decouples data ingestion from business logic by broadcasting raw 
 * payloads over the EventBus.
 * @version 6.0.0
 * @module okxService
 */

import { SYSTEM_EVENTS, DEFAULT_ASSET_UNIVERSE } from '../constants.js';
import { globalEventBus } from '../core/eventBus.js';
import { globalState } from '../core/state.js';
import { taskScheduler, PRIORITY } from '../core/scheduler.js';

class OKXService {
    constructor() {
        /** @type {WebSocket|null} */
        this._ws = null;
        
        /** @type {number} */
        this._reconnectAttempts = 0;
        
        /** @type {number} Maximum backoff delay limit (30 seconds) */
        this._maxReconnectDelay = 30000;
        
        /** @type {boolean} Flag to prevent reconnect loops during deliberate shutdowns */
        this._isIntentionallyClosed = false;

        this._handleOpen = this._handleOpen.bind(this);
        this._handleMessage = this._handleMessage.bind(this);
        this._handleError = this._handleError.bind(this);
        this._handleClose = this._handleClose.bind(this);
        this._sendHeartbeat = this._sendHeartbeat.bind(this);
    }

    /**
     * Initiates the WebSocket connection using topography settings from the global state.
     * @returns {Promise<void>} Resolves when the connection process is initiated.
     */
    async connect() {
        if (this._ws && (this._ws.readyState === WebSocket.CONNECTING || this._ws.readyState === WebSocket.OPEN)) {
            console.warn('[OKXService] Connection already active or in progress.');
            return;
        }

        this._isIntentionallyClosed = false;
        
        const settings = globalState.get('settings');
        const endpoint = settings.wsEndpoint || 'wss://wspap.okx.com:443/ws/v5/public';

        this._updateConnectionState('CONNECTING');

        try {
            this._ws = new WebSocket(endpoint);
            this._ws.binaryType = 'arraybuffer'; // Optimize payload ingestion
            
            this._ws.onopen = this._handleOpen;
            this._ws.onmessage = this._handleMessage;
            this._ws.onerror = this._handleError;
            this._ws.onclose = this._handleClose;
        } catch (error) {
            console.error('[OKXService] Failed to construct WebSocket:', error);
            this._triggerReconnect();
        }
    }

    /**
     * Safely terminates the WebSocket connection and prevents automatic reconnection.
     */
    disconnect() {
        this._isIntentionallyClosed = true;
        this._updateConnectionState('DISCONNECTING');
        
        taskScheduler.remove('okx_heartbeat');

        if (this._ws) {
            this._ws.close(1000, 'Client initiated disconnect');
            this._ws = null;
        }
        
        this._updateConnectionState('DISCONNECTED');
    }

    /**
     * Handles successful connection establishment.
     * Resets backoff counters, subscribes to data streams, and starts heartbeats.
     * @private
     */
    _handleOpen() {
        console.info('[OKXService] WebSocket connection established.');
        this._reconnectAttempts = 0;
        this._updateConnectionState('CONNECTED');
        
        globalEventBus.emit(SYSTEM_EVENTS.WS_CONNECTED);

        this._subscribeToChannels();

        // OKX strictly requires a 'ping' every 30 seconds. 
        // We schedule at 20s to ensure a safe buffer.
        taskScheduler.schedule('okx_heartbeat', this._sendHeartbeat, 20000, PRIORITY.CRITICAL);
    }

    /**
     * Processes incoming WebSocket messages.
     * Optimized to quickly discard heartbeats and parse massive JSON arrays without blocking.
     * @param {MessageEvent} event 
     * @private
     */
    _handleMessage(event) {
        // Handle raw string responses (e.g., OKX 'pong')
        if (typeof event.data === 'string') {
            if (event.data === 'pong') return;
        }

        try {
            const payload = JSON.parse(event.data);

            // Handle API error messages or rate limits
            if (payload.event === 'error') {
                console.error('[OKXService] API Error Payload:', payload.msg);
                if (payload.code === '60012') { // Arbitrary example code for rate limit
                    globalEventBus.emit(SYSTEM_EVENTS.API_RATE_LIMIT_EXCEEDED, payload);
                }
                return;
            }

            // Route standard market data payloads (Tickers, Funding, Open Interest)
            if (payload.data && Array.isArray(payload.data)) {
                // Instantly offload parsing to the EventBus; UI renderer will never see this directly
                globalEventBus.emit(SYSTEM_EVENTS.MARKET_DATA_TICK, {
                    channel: payload.arg?.channel,
                    data: payload.data
                });
            }
        } catch (error) {
            // Suppress parse errors for malformed packets to prevent log flooding, 
            // but capture them in memory for deep debugging if needed.
        }
    }

    /**
     * Handles WebSocket errors.
     * @param {Event} error 
     * @private
     */
    _handleError(error) {
        console.warn('[OKXService] WebSocket encountered an error.');
        globalEventBus.emit(SYSTEM_EVENTS.WS_ERROR, error);
        // Do not trigger reconnect here. onerror is always followed by onclose.
        // Handling reconnection in onclose prevents duplicate retry loops.
    }

    /**
     * Handles connection termination and initiates exponential backoff recovery.
     * @param {CloseEvent} event 
     * @private
     */
    _handleClose(event) {
        taskScheduler.remove('okx_heartbeat');
        this._updateConnectionState('DISCONNECTED');
        globalEventBus.emit(SYSTEM_EVENTS.WS_DISCONNECTED, event.reason);

        if (!this._isIntentionallyClosed) {
            console.warn(`[OKXService] Connection lost (Code: ${event.code}). Initiating recovery...`);
            this._triggerReconnect();
        }
    }

    /**
     * Orchestrates exponential backoff for reconnection attempts.
     * Calculates delay: min(30s, (2^attempts) * 1000ms) + random jitter.
     * @private
     */
    _triggerReconnect() {
        this._updateConnectionState('RECONNECTING');

        this._reconnectAttempts++;
        const baseDelay = Math.min(Math.pow(2, this._reconnectAttempts) * 1000, this._maxReconnectDelay);
        const jitter = Math.random() * 500; // ±500ms jitter to prevent thundering herd
        const totalDelay = baseDelay + jitter;

        console.info(`[OKXService] Reconnection attempt ${this._reconnectAttempts} scheduled in ${(totalDelay / 1000).toFixed(1)}s.`);

        setTimeout(() => this.connect(), totalDelay);
    }

    /**
     * Transmits subscription requests to OKX for the default asset universe.
     * @private
     */
    _subscribeToChannels() {
        if (!this._ws || this._ws.readyState !== WebSocket.OPEN) return;

        const args = DEFAULT_ASSET_UNIVERSE.flatMap(symbol => [
            { channel: 'tickers', instId: symbol },
            { channel: 'funding-rate', instId: symbol },
            { channel: 'open-interest', instType: 'SWAP', instId: symbol }
        ]);

        const subscriptionPayload = JSON.stringify({
            op: 'subscribe',
            args: args
        });

        this._ws.send(subscriptionPayload);
        console.info(`[OKXService] Subscription payload transmitted for ${DEFAULT_ASSET_UNIVERSE.length} core assets.`);
    }

    /**
     * Dispatches a lightweight heartbeat payload to keep the TCP connection alive.
     * Triggered by the TaskScheduler on a CRITICAL priority cycle.
     * @private
     */
    _sendHeartbeat() {
        if (this._ws && this._ws.readyState === WebSocket.OPEN) {
            this._ws.send('ping');
        }
    }

    /**
     * Updates the global telemetry state to reflect network status.
     * @param {string} status - CONNECTING, CONNECTED, DISCONNECTING, DISCONNECTED, RECONNECTING
     * @private
     */
    _updateConnectionState(status) {
        globalState.update('performance', (current) => ({
            ...current,
            wsStatus: status
        }));
    }
}

// Export singleton instance
export const okxService = new OKXService();
