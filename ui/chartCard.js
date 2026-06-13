/**
 * @file /ui/chartCard.js
 * @description Production-grade TradingView integration component for EDGE V6.
 * Features:
 * - Framework memoization
 * - Unique container IDs
 * - Single widget initialization
 * - Symbol updates without recreation
 * - ResizeObserver support
 * - Proper cleanup
 * - Lazy initialization ready
 * @version 7.0.0
 */
import { BaseComponent } from '../core/renderer.js';
import { presentationEngine } from '../engines/presentationEngine.js';
export class ChartCard extends BaseComponent {
    constructor(containerId, stateSubscriptions = ['market', 'alpha']) {
        super(containerId, stateSubscriptions);
        this.chartId = `tv_chart_${crypto.randomUUID()}`;
        this.widget = null;
        this.currentSymbol = null;
        this.currentInterval = null;
        this.currentTheme = null;
        this._lastVM = null;
        this.resizeObserver = new ResizeObserver(() => {
            if (
                this.widget &&
                typeof this.widget.resize === 'function'
            ) {
                this.widget.resize();
            }
        });
    }
    render(state) {
        const vm = presentationEngine.buildChartViewModel(state);
        this._lastVM = vm;
        const hash = [
            vm.symbol,
            vm.interval,
            vm.status,
            vm.theme,
            vm.indicators.join('|')
        ].join(':');
        return this.memo(hash, () => {
            const indicatorsHTML =
                vm.indicators
                    .map(ind => `<span class="data-label">${ind}</span>`)
                    .join('');
            return `
                <div class="glass-panel component-card full-height-card ${this.getEntranceClass()}">
                    <div class="chart-header">
                        <h3 class="view-title">
                            ${vm.symbol}
                        </h3>
                        ${vm.statusBadge}
                    </div>
                    <div
                        id="${this.chartId}"
                        class="chart-container hardware-accelerated">
                    </div>
                    <div class="chart-footer">
                        ${indicatorsHTML}
                    </div>
                </div>
            `;
        });
    }
    onRendered() {
        const vm = this._lastVM;
        if (!vm) return;
        this.resizeObserver.observe(this.container);
        /*
        ---------------------------------------
        Initialize widget only once
        ---------------------------------------
        */
        if (!this.widget) {
            this.widget = new TradingView.widget({
                container_id: this.chartId,
                symbol: vm.symbol,
                interval: vm.interval,
                theme: vm.theme,
                autosize: true,
                hide_top_toolbar: true,
                hide_side_toolbar: true,
                allow_symbol_change: false,
                studies: vm.studies || []
            });
            this.currentSymbol = vm.symbol;
            this.currentInterval = vm.interval;
            this.currentTheme = vm.theme;
            return;
        }
        /*
        ---------------------------------------
        Symbol update
        ---------------------------------------
        */
        if (
            vm.symbol !== this.currentSymbol &&
            typeof this.widget.setSymbol === 'function'
        ) {
            this.widget.setSymbol(vm.symbol);
            this.currentSymbol = vm.symbol;
        }
        /*
        ---------------------------------------
        Interval update
        ---------------------------------------
        */
        if (
            vm.interval !== this.currentInterval &&
            typeof this.widget.setInterval === 'function'
        ) {
            this.widget.setInterval(vm.interval);
            this.currentInterval = vm.interval;
        }
        /*
        ---------------------------------------
        Theme update
        ---------------------------------------
        */
        if (
            vm.theme !== this.currentTheme &&
            typeof this.widget.changeTheme === 'function'
        ) {
            this.widget.changeTheme(vm.theme);
            this.currentTheme = vm.theme;
        }
    }
    /**
     * Called by renderer before component removal.
     */
    onBeforeUnmount() {
        this.resizeObserver.disconnect();
        if (
            this.widget &&
            typeof this.widget.remove === 'function'
        ) {
            this.widget.remove();
        }
        this.widget = null;
        this.currentSymbol = null;
        this.currentInterval = null;
        this.currentTheme = null;
        this._lastVM = null;
    }
}
