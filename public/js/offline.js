/* ============================================================
 * offline.js — Registro del Service Worker + cola de ventas offline
 *
 * 1) Registra public/sw.js (solo en HTTPS o localhost).
 * 2) Expone helpers para encolar ventas cuando no hay red:
 *    - offlineEnqueueSale(payload)      → guarda en IndexedDB
 *    - offlineGetPendingCount()         → cuántas ventas pendientes
 *    - offlineSyncPending()             → intenta enviarlas
 * 3) Escucha 'online'/'offline' y notifica al POS.
 * ============================================================ */

(function () {
    const QUEUE_DB = 'tomodachi_offline';
    const QUEUE_STORE = 'sales_queue';

    function openQueueDB() {
        return new Promise((resolve, reject) => {
            if (!('indexedDB' in window)) { reject(new Error('IndexedDB no disponible')); return; }
            const req = indexedDB.open(QUEUE_DB, 1);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(QUEUE_STORE)) {
                    db.createObjectStore(QUEUE_STORE, { keyPath: 'id', autoIncrement: true });
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async function enqueueSale(payload) {
        const db = await openQueueDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(QUEUE_STORE, 'readwrite');
            tx.objectStore(QUEUE_STORE).add({
                payload,
                created_at: new Date().toISOString(),
                status: 'pending'
            });
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    async function getPendingCount() {
        try {
            const db = await openQueueDB();
            return new Promise((resolve) => {
                const tx = db.transaction(QUEUE_STORE, 'readonly');
                const countReq = tx.objectStore(QUEUE_STORE).count();
                countReq.onsuccess = () => resolve(countReq.result || 0);
                countReq.onerror = () => resolve(0);
            });
        } catch (e) { return 0; }
    }

    async function syncPending() {
        const db = await openQueueDB();
        const all = await new Promise((resolve) => {
            const tx = db.transaction(QUEUE_STORE, 'readonly');
            const req = tx.objectStore(QUEUE_STORE).getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => resolve([]);
        });
        let synced = 0;
        for (const entry of all) {
            try {
                const res = await fetch('/api/sales/create_sale.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify(entry.payload)
                });
                const data = await res.json();
                if (data.success) {
                    await new Promise((resolve) => {
                        const tx = db.transaction(QUEUE_STORE, 'readwrite');
                        tx.objectStore(QUEUE_STORE).delete(entry.id);
                        tx.oncomplete = () => resolve();
                    });
                    synced++;
                }
            } catch (e) { /* sigue pendiente */ }
        }
        return synced;
    }

    // Registrar SW
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/public/sw.js').catch((e) => console.warn('SW no registrado:', e));
        });
    }

    // Notificar cambios de conectividad
    window.addEventListener('online', async () => {
        document.dispatchEvent(new CustomEvent('tomodachi:online'));
        const synced = await syncPending();
        if (synced > 0 && typeof showNotification === 'function') {
            showNotification(`Conexión recuperada: ${synced} venta(s) sincronizada(s)`, 'success');
        }
    });
    window.addEventListener('offline', () => {
        document.dispatchEvent(new CustomEvent('tomodachi:offline'));
    });

    // Exponer API global
    window.offlineEnqueueSale = enqueueSale;
    window.offlineGetPendingCount = getPendingCount;
    window.offlineSyncPending = syncPending;
})();
