import { createId } from '../utils/ids.js'

export const STORAGE_VERSION = 4
export const STATUSES = ['Pending', 'OK', 'Not OK', 'N/A']
export const ACTION_STATUSES = ['Open', 'In Progress', 'Completed']
export const EVIDENCE_TYPES = ['Before', 'After', 'General Inspection']

export function normalizeAction(action, index = 0) {
  return {
    id: typeof action?.id === 'string' && action.id.trim() ? action.id.trim() : createId(`action-${index + 1}`),
    description: String(action?.description || ''),
    responsiblePerson: String(action?.responsiblePerson || ''),
    dueDate: String(action?.dueDate || ''),
    status: ACTION_STATUSES.includes(action?.status) ? action.status : 'Open',
  }
}

export function normalizeItem(item, fallbackId = createId('item')) {
  const legacyRemarks = String(item?.remarks || '')
  const legacyAction = String(item?.correctiveAction || '')
  const existingNotes = item?.notes && typeof item.notes === 'object' ? item.notes : {}
  const actions = Array.isArray(item?.actions) && (item.actions.length || !legacyAction.trim())
    ? item.actions.map(normalizeAction)
    : (legacyAction.trim() ? [normalizeAction({ description: legacyAction }, 0)] : [])
  return {
    ...item,
    id: typeof item?.id === 'string' && item.id.trim() ? item.id.trim() : fallbackId,
    category: String(item?.category || 'GENERAL'),
    requirement: String(item?.requirement || ''),
    criteria: String(item?.criteria || ''),
    status: STATUSES.includes(item?.status) ? item.status : 'Pending',
    notes: {
      observations: String(existingNotes.observations || legacyRemarks),
      comments: String(existingNotes.comments || ''),
    },
    mediaIds: Array.isArray(item?.mediaIds) ? [...new Set(item.mediaIds.filter(x => typeof x === 'string'))] : [],
    subChecks: Array.isArray(item?.subChecks)
      ? item.subChecks
        .filter(check => check && typeof check === 'object' && String(check.label || '').trim())
        .map((check, index) => ({
          id: typeof check.id === 'string' && check.id.trim() ? check.id.trim() : createId(`subcheck-${index + 1}`),
          label: String(check.label).trim(),
          checked: check.checked === true,
        }))
      : [],
    actions,
    // Dual-write these legacy fields for one migration cycle and for older exports.
    remarks: String(existingNotes.observations || legacyRemarks),
    correctiveAction: actions[0]?.description || legacyAction,
  }
}

export function normalizeItems(items, prefix = 'item') {
  if (!Array.isArray(items)) return []
  const ids = new Set()
  return items.map((item, index) => {
    let normalized = normalizeItem(item, createId(`${prefix}-${index + 1}`))
    while (ids.has(normalized.id)) normalized = { ...normalized, id: createId(`${prefix}-${index + 1}`) }
    ids.add(normalized.id)
    return normalized
  })
}

export function cleanTemplateItems(items, prefix = 'template-item') {
  return normalizeItems(items, prefix).map(item => ({
    ...item,
    id: createId(prefix),
    status: 'Pending',
    notes: { observations: '', comments: '' },
    remarks: '',
    actions: [],
    correctiveAction: '',
    mediaIds: [],
    subChecks: (item.subChecks || []).map(check => ({ ...check, checked: false })),
  }))
}

export function migrateInspectionData(saved, base, keyOf) {
  const version = Number(saved.storageVersion ?? saved.version ?? 1)
  if (!Number.isFinite(version) || version < 1) throw new Error('Saved inspection data has an invalid version.')
  const element = ['Slab', 'Beam', 'Column', 'Footing'].includes(saved.element) ? saved.element : 'Slab'
  const level = ['Standard', 'Detailed'].includes(saved.level) ? saved.level : 'Standard'
  const templates = { ...base.templates, ...(saved.templates || {}) }

  // Migrate legacy element-only template keys into the Standard template slots.
  for (const name of ['Slab', 'Beam', 'Column', 'Footing']) {
    if (Array.isArray(saved.templates?.[name]) && !saved.templates?.[keyOf(name, 'Standard')]) {
      templates[keyOf(name, 'Standard')] = saved.templates[name]
    }
  }
  if (Array.isArray(saved.items)) templates[keyOf(element, level)] = saved.items
  for (const key of Object.keys(templates)) templates[key] = normalizeItems(templates[key], `${key}-item`)

  const customTemplates = Array.isArray(saved.customTemplates)
    ? saved.customTemplates.map((template, index) => {
      const id = typeof template?.id === 'string' && template.id ? template.id : createId(`custom-${index + 1}`)
      const templateElement = ['Slab', 'Beam', 'Column', 'Footing'].includes(template?.element) ? template.element : 'Slab'
      return {
        id,
        name: String(template?.name || 'Custom template'),
        element: templateElement,
        items: cleanTemplateItems(template?.items, `${id}-item`),
      }
    })
    : []
  const draftsSource = saved.inspectionDrafts && typeof saved.inspectionDrafts === 'object' && !Array.isArray(saved.inspectionDrafts)
    ? saved.inspectionDrafts
    : {}
  const inspectionDrafts = Object.fromEntries(Object.entries(draftsSource).map(([id, list]) => [id, normalizeItems(list, `${id}-item`)]))
  const selectedCustom = customTemplates.find(template => template.id === saved.selectedTemplateId)
  const selectedTemplateId = selectedCustom?.id || keyOf(element, level)
  const currentElement = selectedCustom?.element || element
  const currentLevel = selectedCustom ? 'Custom' : level
  const currentItems = selectedCustom
    ? (inspectionDrafts[selectedCustom.id] || normalizeItems(saved.items || selectedCustom.items, `${selectedCustom.id}-item`))
    : templates[keyOf(element, level)]

  return {
    ...base,
    ...saved,
    storageVersion: STORAGE_VERSION,
    inspectionInstanceId: typeof saved.inspectionInstanceId === 'string' && saved.inspectionInstanceId
      ? saved.inspectionInstanceId
      : createId('inspection'),
    floorLevel: typeof saved.floorLevel === 'string' ? saved.floorLevel : '',
    element: currentElement,
    level: currentLevel,
    selectedTemplateId,
    templates,
    customTemplates,
    inspectionDrafts,
    inspectionHistory: Array.isArray(saved.inspectionHistory)
      ? saved.inspectionHistory.map((record, index) => ({
        ...record,
        id: record?.id || createId(`history-${index + 1}`),
        inspectionInstanceId: record?.inspectionInstanceId || record?.id || createId(`restored-inspection-${index + 1}`),
        floorLevel: typeof record?.floorLevel === 'string' ? record.floorLevel : '',
        items: normalizeItems(record?.items, `history-${index + 1}-item`),
      }))
      : [],
    reportDesign: ['Professional', 'Detailed', 'Compact'].includes(saved.reportDesign) ? saved.reportDesign : 'Professional',
    items: normalizeItems(currentItems, `${selectedTemplateId}-item`),
  }
}

export function collectMediaIds(data) {
  const ids = new Set()
  const addItems = list => {
    if (!Array.isArray(list)) return
    for (const item of list) for (const id of item?.mediaIds || []) if (typeof id === 'string') ids.add(id)
  }
  addItems(data?.items)
  Object.values(data?.templates || {}).forEach(addItems)
  Object.values(data?.inspectionDrafts || {}).forEach(addItems)
  for (const template of data?.customTemplates || []) addItems(template.items)
  for (const record of data?.inspectionHistory || []) addItems(record.items)
  return ids
}

export function remapMediaIds(data, idMap) {
  const remapItems = list => (list || []).map(item => ({
    ...normalizeItem(item),
    mediaIds: (item.mediaIds || []).map(id => idMap.get(id) || id),
  }))
  return {
    ...data,
    items: remapItems(data.items),
    templates: Object.fromEntries(Object.entries(data.templates || {}).map(([key, list]) => [key, remapItems(list)])),
    inspectionDrafts: Object.fromEntries(Object.entries(data.inspectionDrafts || {}).map(([key, list]) => [key, remapItems(list)])),
    customTemplates: (data.customTemplates || []).map(template => ({ ...template, items: remapItems(template.items) })),
    inspectionHistory: (data.inspectionHistory || []).map(record => ({ ...record, items: remapItems(record.items) })),
  }
}
