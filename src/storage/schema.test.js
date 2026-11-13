import test from 'node:test'
import assert from 'node:assert/strict'
import { STORAGE_VERSION, migrateInspectionData, normalizeItem, normalizeItems, cleanTemplateItems, remapMediaIds } from './schema.js'

const keyOf = (element, level) => `${element}-${level}`
function baseState() {
  return { storageVersion: STORAGE_VERSION, element: 'Slab', level: 'Standard', templates: { 'Slab-Standard': [] }, customTemplates: [], inspectionDrafts: {}, inspectionHistory: [], items: [] }
}

test('legacy remarks and corrective action migrate without losing text or status', () => {
  const migrated = normalizeItem({ id: 'old-item', status: 'Not OK', remarks: 'Honeycombing observed', correctiveAction: 'Repair and re-inspect' })
  assert.equal(migrated.notes.observations, 'Honeycombing observed')
  assert.equal(migrated.actions[0].description, 'Repair and re-inspect')
  assert.equal(migrated.actions[0].status, 'Open')
  assert.equal(migrated.status, 'Not OK')
  assert.equal(normalizeItem({ remarks: 'Old value', notes: { observations: '' }, correctiveAction: 'Old action', actions: [] }).notes.observations, 'Old value')
  assert.equal(normalizeItem({ correctiveAction: 'Old action', actions: [] }).actions[0].description, 'Old action')
})

test('migration keeps project, templates and history while upgrading schema version', () => {
  const saved = { storageVersion: 3, project: 'North Block', items: [{ id: 'i1', status: 'OK', remarks: 'Checked' }], inspectionHistory: [{ id: 'h1', items: [{ id: 'hi1', remarks: 'Archived note' }] }] }
  const migrated = migrateInspectionData(saved, baseState(), keyOf)
  assert.equal(migrated.storageVersion, STORAGE_VERSION)
  assert.equal(migrated.project, 'North Block')
  assert.equal(migrated.items[0].notes.observations, 'Checked')
  assert.equal(migrated.inspectionHistory[0].items[0].notes.observations, 'Archived note')
})

test('floor level migrates safely and is preserved in active and archived inspections', () => {
  const saved = {
    ...baseState(),
    floorLevel: 'Fourth Floor',
    inspectionHistory: [{ id: 'history-floor', floorLevel: 'Basement', items: [] }],
  }
  const migrated = migrateInspectionData(saved, baseState(), keyOf)
  assert.equal(migrated.floorLevel, 'Fourth Floor')
  assert.equal(migrated.inspectionHistory[0].floorLevel, 'Basement')

  const legacy = migrateInspectionData({ ...baseState(), inspectionHistory: [{ id: 'legacy-history', items: [] }] }, baseState(), keyOf)
  assert.equal(legacy.floorLevel, '')
  assert.equal(legacy.inspectionHistory[0].floorLevel, '')
})

test('template copies reset inspection values and evidence references', () => {
  const [copy] = cleanTemplateItems([{ id: 'source', status: 'Not OK', remarks: 'Keep in inspection', correctiveAction: 'Fix', mediaIds: ['photo-1'], subChecks: [{ id: 's1', label: 'Cover checked', checked: true }] }])
  assert.equal(copy.status, 'Pending')
  assert.equal(copy.notes.observations, '')
  assert.equal(copy.actions.length, 0)
  assert.deepEqual(copy.mediaIds, [])
  assert.deepEqual(copy.subChecks.map(check => check.checked), [false])
})

test('sub-check completion survives normalization, inspection migration and backup ID remapping', () => {
  const checkedItem = { id: 'item-1', status: 'N/A', subChecks: [{ id: 'check-1', label: 'Drawing checked', checked: true }], mediaIds: ['photo-1'] }
  assert.equal(normalizeItem(checkedItem).subChecks[0].checked, true)
  assert.deepEqual(normalizeItem({ id: 'legacy-item' }).subChecks, [])

  const migrated = migrateInspectionData({ ...baseState(), items: [checkedItem] }, baseState(), keyOf)
  assert.equal(migrated.items[0].subChecks[0].checked, true)

  const remapped = remapMediaIds({ ...baseState(), items: [checkedItem] }, new Map([['photo-1', 'photo-2']]))
  assert.equal(remapped.items[0].subChecks[0].checked, true)
  assert.deepEqual(remapped.items[0].mediaIds, ['photo-2'])

  const restored = normalizeItems([{ ...checkedItem }])
  assert.equal(restored[0].subChecks[0].checked, true)
})
