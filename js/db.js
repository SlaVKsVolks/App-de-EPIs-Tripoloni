
import { DB_NAME, DB_VERSION } from './config.js';

let db;

export function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = event => reject('DB Error: ' + event.target.error);

        request.onupgradeneeded = event => {
            const db = event.target.result;
            // Stores for data
            if (!db.objectStoreNames.contains('employees')) db.createObjectStore('employees', { keyPath: 'ID' });
            if (!db.objectStoreNames.contains('epis')) db.createObjectStore('epis', { keyPath: 'ID' });
            if (!db.objectStoreNames.contains('stock')) db.createObjectStore('stock', { keyPath: 'ID_EPI' });

            // Store for pending transactions
            if (!db.objectStoreNames.contains('pending_movements')) {
                db.createObjectStore('pending_movements', { keyPath: 'id' });
            }
        };

        request.onsuccess = event => {
            db = event.target.result;
            resolve(db);
        };
    });
}

export async function saveToDB(storeName, data) {
    if (!db) await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);

        // Clear existing data for catalogs (full refresh strategy)
        if (storeName !== 'pending_movements') {
            store.clear();
        }

        data.forEach(item => {
            store.put(item);
        });

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

export async function getFromDB(storeName) {
    if (!db) await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const request = store.getAll();

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

export async function addPendingTransaction(transaction) {
    if (!db) await initDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction('pending_movements', 'readwrite');
        const store = tx.objectStore('pending_movements');
        store.add(transaction);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

export async function clearPendingTransactions(idsToRemove) {
    if (!db) await initDB();
    const tx = db.transaction('pending_movements', 'readwrite');
    const store = tx.objectStore('pending_movements');

    idsToRemove.forEach(id => store.delete(id));

    return new Promise((resolve) => {
        tx.oncomplete = () => resolve();
    });
}
