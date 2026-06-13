/**
 * @file /core/renderer.js
 * @description Ultra-high performance UI rendering engine for EDGE V6.
 * Implements dirty-component tracking, state-driven reactivity, DOM batching, 
 * and DocumentFragment swaps. Completely avoids Virtual DOM overhead while 
 * preventing full-page reflows.
 * @version 6.0.0
 * @module renderer
 */

import { frameScheduler } from './scheduler.js';
import { globalState } from './state.js';
import { globalEventBus } from './eventBus.js';

/**
 * Parses an HTML string into a highly optimized DocumentFragment.
 * @performance-consideration Utilizing `<template>` tags prevents the browser from
 * requesting external resources (images, scripts) until the fragment is explicitly attached.
 * @param {string} htmlString - Raw HTML template string.
 * @returns {DocumentFragment}
 */
const stringToFragment = (htmlString) => {
    const template = document.createElement('template');
    template.innerHTML = htmlString.trim();
    return template.content;
};

/**
 * @class BaseComponent
 * Core UI building block. Components inherit from this to gain reactive lifecycle 
 * methods, automatic dirty tracking, and state-slice subscriptions.
 */
export class BaseComponent {
    /**
     * @param {string} containerId - DOM ID where this component mounts.
     * @param {string[]} stateSubscriptions - Array of global state slices to track (e.g., ['market', 'alpha']).
     */
    constructor(containerId, stateSubscriptions = []) {
        this.containerId = containerId;
        this.container = document.getElementById(containerId);
        this.stateSubscriptions = stateSubscriptions;
        
        /** @type {Object} Local component state, merged with global state upon render */
        this.localState = {};
        
        this.isDirty = true;
        this._unsubscribers = [];

        if (!this.container) {
            console.warn(`[Renderer] Critical Error: Mount target #${containerId} not found in DOM.`);
        }

        this._initReactivity();
    }

    /**
     * Hooks into the global EventBus to track mutations on specific state slices.
     * @private
     */
    _initReactivity() {
        this.stateSubscriptions.forEach(slice => {
            const unsub = globalEventBus.on(`state:${slice}_updated`, (newSliceData) => {
                if (this.shouldUpdate(slice, newSliceData)) {
                    this.markDirty();
                }
            });
            this._unsubscribers.push(unsub);
        });
    }

    /**
     * Flags the component for a re-render in the next animation frame.
     */
    markDirty() {
        if (!this.isDirty) {
            this.isDirty = true;
            uiRenderer.enqueue(this);
        }
    }

    /**
     * Lifecycle Hook: Determines if a specific state change warrants a re-render.
     * Can be overridden by subclasses for fine-grained rendering control.
     * @param {string} slice - The state slice that mutated.
     * @param {Object} newSliceData - The updated state data.
     * @returns {boolean} True if the component should re-render.
     */
    shouldUpdate(slice, newSliceData) {
        return true; 
    }

    /**
     * Generates the component's UI structure. Must be overridden by subclasses.
     * @param {Object} combinedState - Merged local and requested global state.
     * @returns {string|DocumentFragment} The computed HTML string or Fragment.
     */
    render(combinedState) {
        throw new Error(`[BaseComponent] render() method not implemented on ${this.constructor
