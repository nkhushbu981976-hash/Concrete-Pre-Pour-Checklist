import { createId } from '../utils/ids.js'

const DATABASE_NAME = 'concretecheck-evidence'
const DATABASE_VERSION = 1
const STORE_NAME = 'photos'
const MAX_PHOTO_BYTES = 25 * 1024 * 1024
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
let databasePromise

function openDatabase() {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB is unavailable in this browser.'))
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
          store.createIndex('inspectionInstanceId', 'inspectionInstanceId', { unique: false })
          store.createIndex('itemId', 'itemId', { unique: false })
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error || new Error('Could not open the evidence database.'))
      request.onblocked = () => reject(new Error('Evidence database upgrade is blocked by another open tab.'))
    }).catch(error => {
      databasePromise = null
      throw error
    })
  }
  return databasePromise
}

function transaction(mode, operation) {
  return openDatabase().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode)
    const store = tx.objectStore(STORE_NAME)
    let result
    try { result = operation(store) } catch (error) { reject(error); return }
    tx.oncomplete = () => resolve(result && typeof result === 'object' && 'result' in result ? result.result : result)
    tx.onerror = () => reject(tx.error || new Error('Evidence database transaction failed.'))
    tx.onabort = () => reject(tx.error || new Error('Evidence database transaction was aborted.'))
  }))
}

export function putPhoto(photo) { return transaction('readwrite', store => store.put(photo)) }
export function updatePhoto(photo) { return transaction('readwrite', store => store.put(photo)) }
export function getPhoto(id) { return transaction('readonly', store => store.get(id)) }
export function getPhotos(ids) {
  return Promise.all(ids.map(getPhoto)).then(records => records.filter(Boolean))
}
export function getAllPhotos() { return transaction('readonly', store => store.getAll()) }
export function deletePhoto(id) { return transaction('readwrite', store => store.delete(id)) }
export function deletePhotos(ids) {
  return transaction('readwrite', store => { ids.forEach(id => store.delete(id)); return true })
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not encode image.')), type, quality))
}

async function resizeImage(file, maxDimension, quality) {
  if (typeof createImageBitmap !== 'function') return file
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d', { alpha: false })
    if (!context) return file
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return await canvasBlob(canvas, 'image/jpeg', quality)
  } finally {
    bitmap.close?.()
  }
}

export async function preparePhoto(file, { inspectionInstanceId, itemId, evidenceType = 'General Inspection' }) {
  if (!file || !ALLOWED_TYPES.has(file.type)) throw new Error('Choose a JPEG, PNG, WebP or HEIC image.')
  if (file.size <= 0 || file.size > MAX_PHOTO_BYTES) throw new Error('Each photo must be smaller than 25 MB.')
  let previewBlob = file
  let printBlob = file
  try {
    [previewBlob, printBlob] = await Promise.all([resizeImage(file, 480, 0.78), resizeImage(file, 1800, 0.86)])
  } catch {
    // Keep the original evidence if browser image decoding/optimization is unavailable.
  }
  return {
    id: createId('photo'), inspectionInstanceId, itemId,
    caption: '', evidenceType, createdAt: new Date().toISOString(),
    mimeType: file.type, originalBlob: file, previewBlob, printBlob,
  }
}

export function createPhotoUrl(blob) { return URL.createObjectURL(blob) }
export function revokePhotoUrl(url) { if (url) URL.revokeObjectURL(url) }
