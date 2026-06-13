/**
 * @file /ui/capitalCard.js
 * @description Sovereign Portfolio UI Component.
 * Renders account equity, margin utilization, and optimal capital distribution.
 * Implements strict view-model consumption and GPU-accelerated progress bars.
 * @version 6.1.0
 * @module capitalCard
 */

import { BaseComponent } from '../core/renderer.js';
import { presentationEngine } from '../engines/presentationEngine.js';
import { UI } from './helpers.js';

export class CapitalCard extends BaseComponent {
    constructor(containerId, stateSubscriptions = ['portfolio']) {
        super(containerId, stateSubscriptions);
        
        // Built-in component state to manage rendering optimizations
        this._lastHash = null;
        this._cachedHTML = '';
        this._hasAnimatedEntrance = false;
    }

    render(state) {
        const vm = presentationEngine.buildCapitalViewModel(state);

        // 1. Skeleton State
        if (!vm.isReady) {
            return UI.skeletonCard(4);
        }

        // 2. Hash Optimization
        // Hash the specific numerical values the UI cares about.
        const currentHash = `${vm.metrics.equity}-${vm.health.scale}-${vm.allocations.length}`;
        if (this._lastHash === currentHash) {
            return this._cachedHTML; // Prevents undefined wiping and skips redundant string interpolation
        }
        this._lastHash = currentHash;

        // 3. Entrance Animation Management
        const animationClass = this._hasAnimatedEntrance ? '' : 'animate-slide-up';
        this._hasAnimatedEntrance = true;

        // 4. Construct Layout
        const html = `
            <div class="glass-panel component-card full-width-component-wrapper ${animationClass}">
                ${this._renderHeader()}
                ${this._renderTopLineMetrics(vm.metrics)}
                ${UI.divider(true)}
                ${this._renderMarginHealth(vm.health)}
                ${UI.divider(true)}
                ${this._renderAllocations(vm.allocations)}
            </div>
        `;

        this._cachedHTML = html;
        return html;
    }

    _renderHeader() {
        return `
            <div class="card-header">
                <h3 class="view-title">CAPITAL ALLOCATION</h3>
                ${UI.getIcon('STAY_IN_CASH')} </div>
            ${UI.divider()}
        `;
    }

    _renderTopLineMetrics(metrics) {
        return `
            <div class="equity-hero-container">
                <span class="data-label text-muted">TOTAL EQUITY</span>
                <div class="equity-hero-value text-primary text-mono">
                    ${metrics.equity}
                </div>
            </div>
            
            <div class="metric-grid-2">
                ${UI.metricBox('AVAILABLE MARGIN', metrics.margin, 'text-long')}
                ${UI.metricBox('OPEN EXPOSURE', metrics.exposure, 'text-warn')}
            </div>
        `;
    }

    _renderMarginHealth(health) {
        // GPU Accelerated Progress Bar using transform: scaleX()
        return `
            <div class="margin-health-container">
                <div class="flex-between">
                    <span class="data-label">MARGIN UTILIZATION</span>
                    <span class="data-label ${health.colorClass}">${health.label}</span>
                </div>
                <div class="progress-bar-standard bg-surface-base">
                    <div class="progress-fill ${health.bgClass} hardware-accelerated" 
                         style="transform: scaleX(${health.scale}); transform-origin: left; transition: transform 0.4s cubic-bezier(0.4, 0, 0.2, 1);">
                    </div>
                </div>
            </div>
        `;
    }

    _renderAllocations(allocations) {
        return `
            <div class="allocations-container">
                <span class="data-label text-muted section-spacing-bottom">TARGET TOPOGRAPHY</span>
                <div class="allocations-list">
                    ${allocations.map(a => this._renderAllocationRow(a)).join('')}
                </div>
            </div>
        `;
    }

    _renderAllocationRow(allocation) {
        return `
            <div class="allocation-row">
                <div class="flex-between">
                    <span class="data-label ${allocation.colorClass}">${allocation.asset}</span>
                    <span class="data-value text-sm text-mono">${allocation.percentageLabel}</span>
                </div>
                <div class="progress-bar-mini bg-surface-base">
                    <div class="progress-fill ${allocation.bgClass} hardware-accelerated" 
                         style="transform: scaleX(${allocation.scale}); transform-origin: left; transition: transform 0.4s ease;">
                    </div>
                </div>
            </div>
        `;
    }
}
