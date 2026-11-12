import test from 'node:test'
import assert from 'node:assert/strict'
import { archiveSnapshot, makeRestoredInspection } from './history.js'
import { normalizeItems } from './schema.js'

test('archiving the same inspection instance updates rather than duplicates history', () => {
  const state = { inspectionInstanceId: 'instance-1', inspectionHistory: [{ id: 'history-1', inspectionInstanceId: 'instance-1', project: 'Old' }] }
  const result = archiveSnapshot(state, { id: 'history-new', inspectionInstanceId: 'instance-1', project: 'Updated' })
  assert.equal(result.inspectionHistory.length, 1)
  assert.equal(result.inspectionHistory[0].id, 'history-1')
  assert.equal(result.inspectionHistory[0].project, 'Updated')
})

test('restoring keeps archived snapshot identity separate from active inspection identity', () => {
  const record = { id: 'history-1', inspectionInstanceId: 'instance-old', items: [{ id: 'item-1', subChecks: [{ id: 'check-1', label: 'Drawing checked', checked: true }] }] }
  const restored = makeRestoredInspection(record, normalizeItems)
  assert.notEqual(restored.inspectionInstanceId, record.inspectionInstanceId)
  assert.equal(record.inspectionInstanceId, 'instance-old')
  assert.equal(restored.items[0].subChecks[0].checked, true)
})
