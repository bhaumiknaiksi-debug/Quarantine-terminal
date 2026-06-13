/**
 * @file /core/eventBus.js
 * @description Centralized Publisher/Subscriber (PubSub) architecture for EDGE V6.
 * Completely decouples UI, Services, and Engines. Ensures memory safety, 
 * synchronized UI state updates, and asynchronous event handling.
 * @version 6.0.0
 * @module eventBus
 */

class EventBus {
    constructor() {
        /**
         * Core registry for event listeners.
         * Using Map with Set to enforce uniqueness and provide O(1) addition/removal.
         * @type {Map<string, Set<Function>>}
         * @private
         */
        this._registry = new Map();

        /**
         * Dedicated registry for wildcard ('*') listeners to optimize lookup times
         * during high-frequency event emissions (e.g., market ticks).
         * @type {Set<Function>}
         * @private
         */
        this._wildcards = new Set();
    }

    /**
     * Subscribe to an event.
     * @param {string} eventName - The semantic name of the event (e.g., 'market:tick'). Use '*' for all events.
     * @param {Function} callback - The function to execute when the event is emitted.
     * @returns {Function} A localized unsubscribe function for clean memory management.
     * @throws {TypeError} If callback is not a valid function.
     */
    on(eventName, callback) {
        if (typeof callback !== 'function') {
            throw new TypeError(`[EventBus] Callback for event "${eventName}" must be a function.`);
        }

        if (eventName === '*') {
            this._wildcards.add(callback);
            return () => this.off('*', callback);
        }

        if (!this._registry.has(eventName)) {
            this._registry.set(eventName, new Set());
        }

        this._registry.get(eventName).add(callback);

        // Return a closure that acts as an immediate deregistration mechanism (memory safety)
        return () => this.off(eventName, callback);
    }

    /**
     * Unsubscribe from an event.
     * @param {string} eventName - The semantic name of the event.
     * @param {Function} callback - The specific function reference to remove.
     * @returns {boolean} True if the listener was successfully removed, false otherwise.
     */
    off(eventName, callback) {
        if (eventName === '*') {
            return this._wildcards.delete(callback);
        }

        const subscribers = this._registry.get(eventName);
        if (subscribers) {
            const removed = subscribers.delete(callback);
            // Garbage collection optimization: Delete the Map key if Set is empty
            if (subscribers.size === 0) {
                this._registry.delete(eventName);
            }
            return removed;
        }

        return false;
    }

    /**
     * Subscribe to an event for exactly one execution, then automatically deregister.
     * @param {string} eventName - The semantic name of the event.
     * @param {Function} callback - The function to execute once.
     */
    once(eventName, callback) {
        if (typeof callback !== 'function') {
            throw new TypeError(`[EventBus] Callback for once() on "${eventName}" must be a function.`);
        }

        const wrapper = (...args) => {
            this.off(eventName, wrapper);
            callback(...args);
        };

        this.on(eventName, wrapper);
    }

    /**
     * Synchronously broadcast an event to all registered subscribers.
     * Wraps execution in a try-catch block to prevent a single crashing listener 
     * from halting the entire application execution pipeline.
     * @param {string} eventName - The event identifier.
     * @param {*} [payload] - The data payload to pass to the listeners.
     */
    emit(eventName, payload = null) {
        // Execute wildcard listeners first
        if (this._wildcards.size > 0) {
            for (const callback of this._wildcards) {
                try {
                    callback(eventName, payload);
                } catch (error) {
                    console.error(`[EventBus] Wildcard listener failed on event "${eventName}":`, error);
                }
            }
        }

        // Execute specific event listeners
        const subscribers = this._registry.get(eventName);
        if (subscribers) {
            for (const callback of subscribers) {
                try {
                    callback(payload);
                } catch (error) {
                    console.error(`[EventBus] Listener failed during event "${eventName}":`, error);
                }
            }
        }
    }

    /**
     * Asynchronously broadcast an event and wait for all asynchronous listeners to resolve.
     * Critical for orchestrating sequential async tasks (e.g., IndexedDB writes before UI updates).
     * @param {string} eventName - The event identifier.
     * @param {*} [payload] - The data payload.
     * @returns {Promise<void>} Resolves when all listeners have settled (either fulfilled or rejected).
     */
    async emitAsync(eventName, payload = null) {
        const promises = [];

        // Aggregate wildcard promises
        if (this._wildcards.size > 0) {
            for (const callback of this._wildcards) {
                promises.push(
                    Promise.resolve().then(() => callback(eventName, payload))
                );
            }
        }

        // Aggregate specific listener promises
        const subscribers = this._registry.get(eventName);
        if (subscribers) {
            for (const callback of subscribers) {
                promises.push(
                    Promise.resolve().then(() => callback(payload))
                );
            }
        }

        if (promises.length === 0) return;

        // Use Promise.allSettled to ensure all callbacks execute even if one throws
        const results = await Promise.allSettled(promises);
        
        // Log rejections for debugging, but don't crash the bus
        const failures = results.filter(res => res.status === 'rejected');
        if (failures.length > 0) {
            console.error(`[EventBus] emitAsync encountered ${failures.length} rejected promises for event "${eventName}".`, failures);
        }
    }

    /**
     * Get the total number of active listeners for a specific event.
     * @param {string} eventName - The specific event name.
     * @returns {number} The count of listeners.
     */
    listenerCount(eventName) {
        if (eventName === '*') {
            return this._wildcards.size;
        }
        const subscribers = this._registry.get(eventName);
        return subscribers ? subscribers.size : 0;
    }

    /**
     * Purge all listeners for a specific event, or wipe the entire event bus clean.
     * Essential for memory safety during major application state tear-downs.
     * @param {string} [eventName] - If provided, clears only this event. If omitted, clears EVERYTHING.
     */
    cleanup(eventName) {
        if (eventName) {
            if (eventName === '*') {
                this._wildcards.clear();
            } else {
                this._registry.delete(eventName);
            }
        } else {
