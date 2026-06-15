/**
 * @file /js/bootstrap.js
 * @description Kernel ignition sequence for EDGE V6.
 * Bootstraps services, quantitative engines, and dynamically imports UI components.
 * @version 6.2.0
 * @module kernel
 */

import { globalEventBus } from './core/eventBus.js';
import { globalState } from './core/state.js';
import { taskScheduler, backgroundScheduler, renderScheduler } from './core/scheduler.js';

// Services
import { storageService } from './services/storageService.js';
import { okxService } from './services/okxService.js';

// Engines
import { scannerEngine } from './engines/scannerEngine.js';
import { qualificationEngine } from './engines/qualificationEngine.js';
import { alphaEngine } from './engines/alphaEngine.js';
import { marketRegimeEngine } from './engines/marketRegimeEngine.js';
import { riskRadarEngine } from './engines/riskRadarEngine.js';
import { capitalAllocator } from './engines/capitalAllocator.js';
import { journalEngine } from './engines/journalEngine.js';

class Kernel {
    constructor() {
        this.uiComponents = [];
    }

    /**
     * Master Boot Sequence
     */
    async boot() {
        try {
            console.info('[Kernel] Initiating EDGE V6 Boot Sequence...');

            // 1. Storage & Persistence Layer
            await storageService.init();

            // 2. Quantitative Engine Pipeline (Order matters for data dependencies)
            await scannerEngine.init();
            await qualificationEngine.init();
            await alphaEngine.init();
            await marketRegimeEngine.init();
            await riskRadarEngine.init();
            await capitalAllocator.init();
            await journalEngine.init();

            // 3. UI Component Layer (Dynamic Imports to prevent 404 halts & improve load time)
            await this._mountUI();

            // 4. Header Telemetry Binding
            this._initTelemetryBinding();

            // 5. Ignite Data Streams
            await okxService.connect();

            console.info('[Kernel] Boot Sequence Complete. System is LIVE.');
        } catch (error) {
            console.error('[Kernel] FATAL BOOT ERROR:', error);
            // Failsafe UI render if kernel panics
            document.body.innerHTML = `
                <div style="color: var(--text-short); padding: 20px; font-family: monospace; background: #000; height: 100vh;">
                    <h3>FATAL SYSTEM ERROR</h3>
                    <p>${error.message}</p>
                </div>
            `;
        }
    }

    /**
     * Dynamically imports and instantiates only the built UI components.
     * @private
     */
    async _mountUI() {
        console.info('[Kernel] Mounting UI Components via Dynamic Import...');
        
        const [
            { CommandCenter },
            { AlphaHotList },
            { MarketRegimeCard },
            { RiskRadarCard },
            { CapitalCard },
            { JournalCard }
        ] = await Promise.all([
            import('./ui/commandCenter.js'),
            import('./ui/alphaHotList.js'),
            import('./ui/marketRegimeCard.js'),
            import('./ui/riskRadarCard.js'),
            import('./ui/capitalCard.js'),
            import('./ui/journalCard.js')
        ]);

        // Push instances to memory to prevent garbage collection and trigger initial renders
        this.uiComponents.push(
            new CommandCenter('command-center-root'),
            new AlphaHotList('alpha-hot-list-root'),
            new MarketRegimeCard('market-regime-card-root'),
            new RiskRadarCard('risk-radar-card-root'),
            new CapitalCard('capital-card-root'),
            new JournalCard('journal-card-root')
        );
    }

    /**
     * Connects global performance state directly to the DOM header.
     * @private
     */
    _initTelemetryBinding() {
        const fpsEl = document.getElementById('telemetry-fps');
        const wsEl = document.getElementById('telemetry-ws');

        globalEventBus.on('state:performance_updated', (perfState) => {
            if (!perfState) return;

            // Update FPS
            if (fpsEl && perfState.fps !== undefined) {
                fpsEl.textContent = perfState.fps;
            }

            // Update WS Status with color coding
            if (wsEl && perfState.wsStatus) {
                wsEl.textContent = perfState.wsStatus;
                
                if (perfState.wsStatus === 'CONNECTED') {
                    wsEl.className = 'telemetry-status-badge text-long';
                } else if (perfState.wsStatus === 'DISCONNECTED') {
                    wsEl.className = 'telemetry-status-badge text-short';
                } else {
                    wsEl.className = 'telemetry-status-badge text-warn';
                }
            }
        });
    }
}

// Ignite
const kernel = new Kernel();
kernel.boot();
