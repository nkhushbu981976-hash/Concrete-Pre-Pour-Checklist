import { createId } from '../utils/ids.js'

export function archiveSnapshot(state, snapshot) {
  const history = state.inspectionHistory || []
  const existingIndex = history.findIndex(record => (record.inspectionInstanceId || record.id) === state.inspectionInstanceId)
  if (existingIndex >= 0) {
    const updated = [...history]
    updated[existingIndex] = { ...snapshot, id: history[existingIndex].id }
    return { ...state, inspectionHistory: updated }
  }
  return { ...state, inspectionHistory: [snapshot, ...history] }
}

export function makeRestoredInspection(record, normalizeItems) {
  return {
    ...record,
    inspectionInstanceId: createId('inspection'),
    items: normalizeItems(record.items, `${record.id || 'restored'}-item`),
  }
}
