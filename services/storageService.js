/**
 * @file /js/services/storageService.js
 */

export class StorageService {
    constructor() {
        this.dbName = 'EdgeV6_DB';
        this.dbVersion = 1;
        this.db = null;
    }

    async init() {
        return new Promise((resolve) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);
            
            request.onupgradeneeded = (event) => {
                this.db = event.target.result;
                if (!this.db.objectStoreNames.contains('store')) {
                    this.db.createObjectStore('store');
                }
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                console.info('[StorageService] IndexedDB initialized.');
                resolve();
            };

            request.onerror = (event) => {
                console.warn('[StorageService] IndexedDB failed, falling back to localStorage.', event.target.error);
                resolve(); // Don't crash, just use localStorage fallback
            };
        });
    }

    async set(key, value) {
        if (!this.db) {
            localStorage.setItem(key, JSON.stringify(value));
            return;
        }
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('store', 'readwrite');
            const store = tx.objectStore('store');
            const request = store.put(value, key);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async get(key) {
        if (!this.db) {
            const val = localStorage.getItem(key);
            return val ? JSON.parse(val) : null;
        }
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('store', 'readonly');
            const store = tx.objectStore('store');
            const request = store.get(key);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
}

export const storageService = new StorageService();
