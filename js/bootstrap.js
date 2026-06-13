/**
 * @file /js/bootstrap.js
 * @description Application Kernel for EDGE V6. 
 * Orchestrates the exact boot sequence: Service Workers, Storage Hydration, 
 * State Initialization, UI Mounting, Engine Pipelines, and Schedulers.
 * Enforces strict order of operations and handles critical startup failures.
 * @version 6.0.0
 * @module bootstrap
 */

import { SYSTEM_EVENTS, STORAGE_KEYS, VIEWS } from './constants.js';
import { globalEventBus } from './core/eventBus.js';
import { globalState } from './core/state.js';
import { frameScheduler } from './core/scheduler.js';

// --- Services ---
import { storageService } from './services/storageService.js';
import { okxService } from './services/okxService.js';

// --- Engines ---
import { scannerEngine } from './engines/scannerEngine.js';
import { qualificationEngine } from './engines/qualificationEngine.js';
import { alphaEngine } from './engines/alphaEngine.js';
import { riskRadarEngine } from './engines/riskRadarEngine.js';
import { journalEngine } from './engines/journalEngine.js';
import { capitalAllocator } from './engines/capitalAllocator.js';
import { marketRegimeEngine } from './engines/marketRegimeEngine.js';

// --- UI Components ---
import { CommandCenter } from './ui/commandCenter.js';
import { AlphaHotList } from './ui/alphaHotList.js';
import { MarketRegimeCard } from './ui/marketRegimeCard.js';
import { RiskRadarCard } from './ui/riskRadarCard.js';
import { CapitalCard } from './ui/capitalCard.js';
import { ChartCard } from './ui/chartCard.js';
import { JournalCard } from './ui/journalCard.js';
import { NotificationCenter } from './ui/notificationCenter.js';
import { BottomNav } from './ui/bottomNav.js';

class ApplicationKernel {
    constructor() {
        this.uiComponents = [];
        this._bindRouting();
    }

    /**
     * Master initialization sequence.
     * Starts the trading OS and transitions to an interactive state.
     * @returns {Promise<void>}
     */
    async boot() {
        try {
            console.info('[Kernel] EDGE V6 Boot Sequence Initiated.');
            const bootStartTime = performance.now();

            this._setupGlobalDefenses();
            await this._registerServiceWorker();

            // 1. Storage & State Hydration (Must precede engine logic)
            console.info('[Kernel] Hydrating state from persistent storage...');
            await storageService.init();
            const savedSettings = await storageService.get(STORAGE_KEYS.USER_SETTINGS);
            if (savedSettings) {
                globalState.update('settings', savedSettings);
            }

            // 2. Mount UI Topology
            console.info('[Kernel] Mounting hardware-accelerated UI fragments...');
            this._mountUI();

            // 3. Initialize Analytical Engines (Order is critical for data pipelines)
            console.info('[Kernel] Spinning up Quantitative Engines...');
            await journalEngine.init();
            await marketRegimeEngine.init();
            await scannerEngine.init();
            await qualificationEngine.init();
            await alphaEngine.init();
            await riskRadarEngine.init();
            await capitalAllocator.init();

            // 4. Start Network & Real-Time Data Streams
            console.info('[Kernel] Establishing API topographies...');
            await okxService.connect();

            // 5. Engage Presentation Schedulers
            console.info('[Kernel] Engaging 120Hz Frame Scheduler...');
            frameScheduler.start();

            // 6. Finalize Boot
            const bootDuration = (performance.now() - bootStartTime).toFixed(2);
            console.info(`[Kernel] OS Online. Boot completed in ${bootDuration}ms.`);
            
            globalEventBus.emit(SYSTEM_EVENTS.BOOTSTRAP_COMPLETE, { duration: bootDuration });
            globalState.notify({
                type: 'SUCCESS',
                message: `EDGE V6 Online. Systems nominal. (${bootDuration}ms)`
            });

        } catch (error) {
            this._renderCriticalFailure(error);
        }
    }

    /**
     * Registers the PWA Service Worker for offline capabilities and caching.
     * @private
     */
    async _registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            try {
                const registration = await navigator.serviceWorker.register('./service-worker.js');
                console.info('[Kernel] Service Worker active with scope:', registration.scope);
                globalEventBus.emit(SYSTEM_EVENTS.SERVICE_WORKER_REGISTERED);
            } catch (error) {
                console.warn('[Kernel] Service Worker registration failed:', error);
                // Non-fatal error; system can operate without SW caching in secure contexts
            }
        }
    }

    /**
     * Instantiates and mounts all decoupled UI components to their DOM targets.
     * @private
     */
    _mountUI() {
        // Core View
        this.uiComponents.push(
            new CommandCenter('command-center-root', ['alpha', 'market']),
            new AlphaHotList('alpha-hot-list-root', ['alpha', 'market']),
            new MarketRegimeCard('market-regime-card-root', ['alpha', 'market']),
            new RiskRadarCard('risk-radar-card-root', ['risk']),
            new CapitalCard('capital-card-root', ['portfolio'])
        );

        // Extended Views & Overlays
        this.uiComponents.push(
            new ChartCard('chart-card-root', ['market', 'alpha']),
            new JournalCard('journal-card-root', ['journal']),
            new NotificationCenter('notification-center-root', ['notifications']),
            new BottomNav('bottom-nav-root', ['settings'])
        );
    }

    /**
     * Binds the application-wide view routing mechanism to the EventBus.
     * @private
     */
    _bindRouting() {
        globalEventBus.on(SYSTEM_EVENTS.VIEW_CHANGED, (targetView) => {
            const views = Object.values(VIEWS);
            if (!views.includes(targetView)) return;

            const container = document.getElementById('workspace-container');
            if (container) {
                container.setAttribute('data-active-view', targetView);
                
                // Toggle active classes on sections for GPU-accelerated opacity transitions
                document.querySelectorAll('.workspace-view').forEach(el => {
                    if (el.id === `view-${targetView}`) {
                        el.classList.add('active');
                    } else {
                        el.classList.remove('active');
                    }
                });
            }
        });
    }

    /**
     * Intercepts unhandled exceptions and promise rejections to prevent silent failures.
     * @private
     */
    _setupGlobalDefenses() {
        window.addEventListener('error', (event) => {
            console.error('[Kernel] Uncaught Exception:', event.error);
            globalState.notify({ type: 'ERROR', message: 'Critical System Exception Detected.' });
        });

        window.addEventListener('unhandledrejection', (event) => {
            console.error('[Kernel] Unhandled Promise Rejection:', event.reason);
        });
    }

    /**
     * Tears down the DOM and renders a low-level error state if boot fails.
     * Bypasses the standard UI renderer completely.
     * @param {Error} error 
     * @private
     */
    _renderCriticalFailure(error) {
        console.error('[Kernel] FATAL BOOT SEQUENCE FAILURE:', error);
        
        frameScheduler.pause();
        
        const shell = document.getElementById('app-shell');
        if (shell) {
            shell.innerHTML = `
                <div style="display:flex; flex-direction:column; justify-content:center; align-items:center; height:100vh; background:#010203; color:#ef4444; font-family:monospace; padding:20px; text-align:center;">
                    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-bottom:20px;">
                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                        <line x1="12" y1="9" x2="12" y2="13"></line>
                        <line x1="12" y1="17" x2="12.01" y2="17"></line>
                    </svg>
                    <h1 style="font-size:1.5rem; margin-bottom:10px;">EDGE V6: KERNEL PANIC</h1>
                    <p style="color:#94a3b8; font-size:0.85rem; max-width:500px; margin-bottom:20px;">${error.message}</p>
                    <pre style="background:rgba(239, 68, 68, 0.1); padding:15px; border-radius:4px; font-size:0.75rem; text-align:left; overflow-x:auto; max-width:800px; color:#f8fafc;">${error.stack || 'No stack trace available.'}</pre>
                    <button onclick="window.location.reload()" style="margin-top:30px; padding:10px 20px; background:#ef4444; color:#fff; border:none; border-radius:4px; font-family:monospace; cursor:pointer; font-weight:bold;">REBOOT SYSTEM</button>
                </div>
            `;
        }
    }
}

// Instantiate and export the kernel
export const appKernel = new ApplicationKernel();

// Auto-execute boot sequence when the DOM is fully parsed
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => appKernel.boot());
} else {
    appKernel.boot();
}
