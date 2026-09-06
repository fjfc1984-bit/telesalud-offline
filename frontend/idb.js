/* Shared IndexedDB access layer, loaded both by the page (app.js, classic <script>) and by the
   service worker (importScripts), so background sync can flush the outbox even if no tab is open. */
(function (global) {
  const DB_NAME = 'telesalud-db';
  const DB_VERSION = 1;

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('outbox')) {
          db.createObjectStore('outbox', { keyPath: 'client_id' });
        }
        if (!db.objectStoreNames.contains('cache')) {
          db.createObjectStore('cache', { keyPath: 'client_id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function tx(storeName, mode) {
    const db = await openDB();
    return db.transaction(storeName, mode).objectStore(storeName);
  }

  function wrap(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function addToOutbox(item) {
    const store = await tx('outbox', 'readwrite');
    await wrap(store.put(item));
    const cacheStore = await tx('cache', 'readwrite');
    await wrap(cacheStore.put(item));
  }

  async function getOutbox() {
    const store = await tx('outbox', 'readonly');
    return wrap(store.getAll());
  }

  async function removeFromOutbox(clientId) {
    const store = await tx('outbox', 'readwrite');
    await wrap(store.delete(clientId));
  }

  async function updateCacheStatus(clientId, patch) {
    const store = await tx('cache', 'readwrite');
    const existing = await wrap(store.get(clientId));
    if (existing) await wrap(store.put({ ...existing, ...patch }));
  }

  async function getAllCache() {
    const store = await tx('cache', 'readonly');
    const items = await wrap(store.getAll());
    return items.sort((a, b) => (b.creado_en_cliente || '').localeCompare(a.creado_en_cliente || ''));
  }

  /* Sincroniza la cola en dos lotes: primero, solo los casos ROJO, en su propia petición
     pequeña; después, el resto. En una ventana de señal corta o intermitente (el escenario
     real en las zonas más golpeadas, no "cero conexión" sino "conexión a ratos"), esto evita
     que un caso urgente se pierda junto con el resto de un lote grande que no alcanza a
     completarse. Si el lote de rojos falla, no se intenta el resto — la ventana de señal ya
     se agotó y forzar el lote grande no ayuda al caso urgente. Compartido entre app.js (primer
     plano) y sw.js (Background Sync) para que ambos se comporten igual. */
  async function sincronizar(deviceId) {
    const pending = await getOutbox();
    if (pending.length === 0) return { enviados: 0, rojosPendientes: 0, totalPendientes: 0 };

    const rojos = pending.filter((it) => it.triage_nivel === 'rojo');
    const resto = pending.filter((it) => it.triage_nivel !== 'rojo');
    const lotes = rojos.length > 0 ? [rojos, resto] : [resto];

    let enviados = 0;
    for (const lote of lotes) {
      if (lote.length === 0) continue;
      try {
        const res = await fetch('/api/sync/encounters', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ device_id: deviceId, encounters: lote }),
        });
        if (!res.ok) break;
        const { resultados } = await res.json();
        for (const r of resultados) {
          if (r.status === 'creado' || r.status === 'ya_sincronizado') {
            await removeFromOutbox(r.client_id);
            await updateCacheStatus(r.client_id, { sync_status: 'sincronizado', server_id: r.server_id, codigo_corto: r.codigo_corto });
            enviados++;
          }
        }
      } catch (e) {
        break; // se cortó la conexión a mitad de la sincronización; se reintenta en el próximo ciclo
      }
    }

    const restante = await getOutbox();
    const rojosPendientes = restante.filter((it) => it.triage_nivel === 'rojo').length;
    return { enviados, rojosPendientes, totalPendientes: restante.length };
  }

  global.TelesaludDB = { openDB, addToOutbox, getOutbox, removeFromOutbox, updateCacheStatus, getAllCache, sincronizar };
})(typeof self !== 'undefined' ? self : this);
