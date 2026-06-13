/**
 * @file /services/storageService.js
 * @description Highly resilient persistence layer for EDGE V6.
 * Implements an IndexedDB wrapper for high-volume, structured data (Trade Journal, Market Cache)
 * and LocalStorage for lightweight, synchronous config data (User Settings, API Keys).
 * Gracefully degrades if storage quotas are exceeded or browser context is restricted.
 * @version 6.0.0
 * @module storageService
 */

import { STORAGE_KEYS } from '../constants.js';

class StorageService {
    constructor() {
        this._dbName = 'edge_v6_database';
        this._dbVersion = 1;
        
        /** @type {IDBDatabase|null} */
        this._db = null;
        
        this._stores = {
            JOURNAL: 'journal',
            MARKET_CACHE: 'market_cache'
        };
        
        this._isDbReady = false;
    }

    /**
     * Initializes the persistence layer.
     * Opens the IndexedDB connection and performs schema migrations if necessary.
     * @returns {Promise<boolean>} True if DB is ready, false if degraded to LocalStorage only.
     */
    async init() {
        try {
            if (!('indexedDB' in window)) {
                console.warn('[StorageService] IndexedDB not supported. Operating in degraded LocalStorage mode.');
                return false;
            }

            this._db = await this._openIndexedDB();
            this._isDbReady = true;
            console.info('[StorageService] IndexedDB connection established. Persistence layer active.');
            return true;

        } catch (error) {
            console.error('[StorageService] IndexedDB initialization failed. Degrading gracefully.', error);
            this._isDbReady = false;
            return false;
        }
    }

    /**
     * Internal helper to wrap IndexedDB opening in a Promise.
     * Handles initial database creation and schema migrations (upgrades).
     * @private
     * @returns {Promise<IDBDatabase>}
     */
    _openIndexedDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this._dbName, this._dbVersion);

            request.onerror = (event) => {
                reject(new Error(`Failed to open IndexedDB: ${event.target.error}`));
            };

            request.onsuccess = (event) => {
                resolve(event.target.result);
            };

            // Triggered on first load or when _dbVersion is incremented.
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                
                // Create Trade Journal Store
                // Using 'id' as the primary key. Indexing by 'timestamp' and 'asset' for fast querying.
                if (!db.objectStoreNames.contains(this._stores.JOURNAL)) {
                    const journalStore = db.createObjectStore(this._stores.JOURNAL, { keyPath: 'id' });
                    journalStore.createIndex('timestamp', 'timestamp', { unique: false });
                    journalStore.createIndex('asset', 'asset', { unique: false });
                }

                // Create Market Cache Store (used to recover state immediately on reload)
                if (!db.objectStoreNames.contains(this._stores.MARKET_CACHE)) {
                    db.createObjectStore(this._stores.MARKET_CACHE, { keyPath: 'symbol' });
                }
            };
        });
    }

    /**
     * Sets a key-value pair. Routes to LocalStorage for
