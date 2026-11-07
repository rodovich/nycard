// Image files live in IndexedDB; the design JSON references them by asset id.
const DB_NAME = 'nycard';
const STORE = 'blobs';

let dbPromise;
function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run(mode, fn) {
  const tx = (await db()).transaction(STORE, mode);
  const req = fn(tx.objectStore(STORE));
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

export const putBlob = (id, blob) => run('readwrite', (s) => s.put(blob, id));
export const getBlob = (id) => run('readonly', (s) => s.get(id));
export const deleteBlob = (id) => run('readwrite', (s) => s.delete(id));
