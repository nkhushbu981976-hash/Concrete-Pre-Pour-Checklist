const DATABASE_NAME = 'concretecheck-reference-documents'
const DATABASE_VERSION = 1
const STORE_NAME = 'documents'
const ACTIVE_DOCUMENT_KEY = 'active-reference-pdf'
const MAX_REFERENCE_PDF_BYTES = 50 * 1024 * 1024

function openDatabase() {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB is unavailable in this browser.'))
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Could not open the reference PDF store.'))
    request.onblocked = () => reject(new Error('The reference PDF store is blocked by another open tab.'))
  })
}

async function runTransaction(mode, operation) {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode)
    const request = operation(transaction.objectStore(STORE_NAME))
    transaction.oncomplete = () => resolve(request?.result)
    transaction.onerror = () => reject(transaction.error || new Error('Reference PDF storage failed.'))
    transaction.onabort = () => reject(transaction.error || new Error('Reference PDF storage was aborted.'))
  })
}

export async function saveReferencePdf(file) {
  if (!file || file.type !== 'application/pdf' || !file.name.toLowerCase().endsWith('.pdf')) {
    throw new Error('Choose a PDF file.')
  }
  if (file.size <= 0 || file.size > MAX_REFERENCE_PDF_BYTES) {
    throw new Error('The reference PDF must be smaller than 50 MB.')
  }
  const record = {
    id: ACTIVE_DOCUMENT_KEY,
    name: file.name,
    size: file.size,
    updatedAt: new Date().toISOString(),
    blob: file,
  }
  await runTransaction('readwrite', store => store.put(record))
  return record
}

export function getReferencePdf() {
  return runTransaction('readonly', store => store.get(ACTIVE_DOCUMENT_KEY))
}

export function removeReferencePdf() {
  return runTransaction('readwrite', store => store.delete(ACTIVE_DOCUMENT_KEY))
}
