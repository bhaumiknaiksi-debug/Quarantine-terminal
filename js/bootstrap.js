import { globalEventBus } from './core/eventBus.js';
import { globalState } from './core/state.js';

// 🛑 TEMPORARILY DISABLED TO BYPASS GITHUB FOLDER 404s
// import { storageService } from './services/storageService.js';
// import { okxService } from './services/okxService.js';

import { scannerEngine } from './engines/scannerEngine.js';
import { qualificationEngine } from './engines/qualificationEngine.js';
import { alphaEngine } from './engines/alphaEngine.js';
import { marketRegimeEngine } from './engines/marketRegimeEngine.js';
import { riskRadarEngine } from './engines/riskRadarEngine.js';
import { capitalAllocator } from './engines/capitalAllocator.js';

// 🛑 TEMPORARILY DISABLED TO BYPASS GITHUB FOLDER 404s
// import { journalEngine } from './engines/journalEngine.js';

class Kernel {
    constructor() {
        this.uiComponents = [];
    }

    async boot() {
        try {
            console.info('[Kernel] Initiating EDGE V6 Boot Sequence...');

            // 🛑 DISABLED
            // await storageService.init();

            await scannerEngine.init();
            await qualificationEngine.init();
            await alphaEngine.init();
            await marketRegimeEngine.init();
            await riskRadarEngine.init();
            await capitalAllocator.init();
            
            // 🛑 DISABLED
            // await journalEngine.init();

            await this._mountUI();
            this._initTelemetryBinding();
            
            // 🛑 DISABLED
            // await okxService.connect();

            console.info('[Kernel] System is LIVE. (Services bypassed)');
        } catch (error) {
            console.error('[Kernel] FATAL BOOT ERROR:', error);
            document.body.innerHTML = `<div style="color:red; padding:20px; font-family:monospace;">${error.message}</div>`;
        }
    }

    async _mountUI() {
        const [
            { CommandCenter }, { AlphaHotList }, { MarketRegimeCard },
            { RiskRadarCard }, { CapitalCard }, { JournalCard }
        ] = await Promise.all([
            import('./ui/commandCenter.js'), import('./ui/alphaHotList.js'),
            import('./ui/marketRegimeCard.js'), import('./ui/riskRadarCard.js'),
            import('./ui/capitalCard.js'), import('./ui/journalCard.js')
        ]);

        this.uiComponents.push(
            new CommandCenter('command-center-root'), new AlphaHotList('alpha-hot-list-root'),
            new MarketRegimeCard('market-regime-card-root'), new RiskRadarCard('risk-radar-card-root'),
            new CapitalCard('capital-card-root'), new JournalCard('journal-card-root')
        );
    }

    _initTelemetryBinding() {
        const fpsEl = document.getElementById('telemetry-fps');
        const wsEl = document.getElementById('telemetry-ws');
        globalEventBus.on('state:performance_updated', (perfState) => {
            if (!perfState) return;
            if (fpsEl && perfState.fps !== undefined) fpsEl.textContent = perfState.fps;
            if (wsEl && perfState.wsStatus) {
                wsEl.textContent = perfState.wsStatus;
                wsEl.className = perfState.wsStatus === 'CONNECTED' ? 'telemetry-status-badge text-long' : 'telemetry-status-badge text-warn';
            }
        });
    }
}

const kernel = new Kernel();
kernel.boot();
