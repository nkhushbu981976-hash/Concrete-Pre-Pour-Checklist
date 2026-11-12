import { collectMediaIds, remapMediaIds } from './schema.js'
import { createId } from '../utils/ids.js'
import { getPhotos, putPhoto } from './mediaDb.js'

const BACKUP_FORMAT = 'concretecheck-backup'
const BACKUP_VERSION = 1

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error || new Error('Could not read photo data.'))
    reader.readAsDataURL(blob)
  })
}
function dataUrlToBlob(value) {
  if (typeof value !== 'string' || !value.startsWith('data:')) throw new Error('Backup contains invalid photo data.')
  const [head, encoded] = value.split(',')
  const mimeType = head.match(/^data:([^;]+)/)?.[1] || 'application/octet-stream'
  const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0))
  return new Blob([bytes], { type: mimeType })
}

export async function createBackup(data) {
  const photos = await getPhotos([...collectMediaIds(data)])
  const photoRecords = await Promise.all(photos.map(async photo => ({
    ...photo,
    originalBlob: await blobToDataUrl(photo.originalBlob),
    previewBlob: await blobToDataUrl(photo.previewBlob || photo.originalBlob),
    printBlob: await blobToDataUrl(photo.printBlob || photo.originalBlob),
  })))
  return { manifest: { format: BACKUP_FORMAT, version: BACKUP_VERSION, schemaVersion: data.storageVersion || 4, exportedAt: new Date().toISOString(), photoCount: photoRecords.length }, data, photos: photoRecords }
}

export async function parseBackup(file) {
  const bundle = JSON.parse(await file.text())
  if (bundle?.manifest?.format !== BACKUP_FORMAT || bundle.manifest.version !== BACKUP_VERSION) throw new Error('Unsupported or invalid ConcreteCheck backup.')
  if (!bundle.data || typeof bundle.data !== 'object' || !Array.isArray(bundle.data.items) || !Array.isArray(bundle.photos)) throw new Error('Backup is missing inspection or photo data.')
  if (!Number.isFinite(Number(bundle.data.storageVersion)) || Number(bundle.data.storageVersion) > 4) throw new Error('Backup uses an unsupported inspection schema version.')
  if (Number(bundle.manifest.schemaVersion) !== Number(bundle.data.storageVersion)) throw new Error('Backup manifest and inspection schema versions do not match.')
  if (bundle.photos.length !== Number(bundle.manifest.photoCount)) throw new Error('Backup photo count does not match its manifest.')
  const photoIds = new Set()
  for (const photo of bundle.photos) {
    if (!photo || typeof photo.id !== 'string' || photoIds.has(photo.id)) throw new Error('Backup contains a missing or duplicate photo ID.')
    photoIds.add(photo.id)
    for (const field of ['originalBlob', 'previewBlob', 'printBlob']) {
      if (typeof photo[field] !== 'string' || !photo[field].startsWith('data:')) throw new Error(`Backup photo ${photo.id} is missing ${field}.`)
    }
  }
  const presentPhotoIds = new Set(bundle.photos.map(photo => photo.id))
  for (const referencedId of collectMediaIds(bundle.data)) {
    if (!presentPhotoIds.has(referencedId)) throw new Error(`Backup is missing referenced photo ${referencedId}.`)
  }
  return bundle
}

export async function importBackup(bundle) {
  const idMap = new Map()
  for (const photo of bundle.photos) idMap.set(photo.id, createId('photo'))
  const incoming = remapMediaIds(bundle.data, idMap)
  const addedPhotoIds = []
  try {
    for (const photo of bundle.photos) {
      const id = idMap.get(photo.id)
      await putPhoto({ ...photo, id,
        originalBlob: dataUrlToBlob(photo.originalBlob),
        previewBlob: dataUrlToBlob(photo.previewBlob),
        printBlob: dataUrlToBlob(photo.printBlob),
      })
      addedPhotoIds.push(id)
    }
    return { ...incoming, storageVersion: 4 }
  } catch (error) {
    // Keep any successfully imported blobs as recovery evidence if cleanup itself fails.
    throw new Error(`Backup data was not applied. ${addedPhotoIds.length} photo blobs were staged and retained for recovery: ${error.message}`)
  }
}
