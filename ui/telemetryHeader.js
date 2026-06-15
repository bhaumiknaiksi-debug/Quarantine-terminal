import { globalEventBus } from '../core/eventBus.js';
import { globalState } from '../core/state.js';

export function initTelemetryHeader() {
    const fpsEl = document.getElementById('telemetry-fps');
    const wsEl = document.getElementById('telemetry-ws');

    globalEventBus.on('state:performance_updated', (perfState) => {
        if (!perfState) return;

        // Update FPS
        if (fpsEl && perfState.fps !== undefined) {
            fpsEl.textContent = perfState.fps;
        }

        // Update WS Status
        if (wsEl && perfState.wsStatus) {
            wsEl.textContent = perfState.wsStatus;
            
            if (perfState.wsStatus === 'CONNECTED') {
                wsEl.className = 'telemetry-status-badge status-connected';
            } else if (perfState.wsStatus === 'DISCONNECTED') {
                wsEl.className = 'telemetry-status-badge status-disconnected';
            } else {
                // Syncing / Reconnecting
                wsEl.className = 'telemetry-status-badge bg-warn text-inverse';
            }
        }
    });
}
