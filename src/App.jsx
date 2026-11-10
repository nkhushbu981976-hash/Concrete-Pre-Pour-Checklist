import { useEffect, useMemo, useRef, useState } from 'react'

const STORAGE_KEY = 'concretecheck-inspection-v1'
const STORAGE_VERSION = 3
const STORAGE_RECOVERY_KEY = `${STORAGE_KEY}-recovery`
const ELEMENTS = ['Slab', 'Beam', 'Column', 'Footing']
const LEVELS = ['Standard', 'Detailed']
const STATUSES = ['Pending', 'OK', 'Not OK', 'N/A']
const DESIGNS = ['Professional', 'Detailed', 'Compact']
let storageLoadWarning = ''
let storageLoadBlocked = false
let unreadableStorageBackup = null

// [category, inspection requirement, suggested acceptance reference]
const T = {
  Slab: {
    Standard: [
      ['FORMWORK','Slab formwork dimensions and levels verified','Check dimensions, levels and soffit alignment against approved drawings.'],
      ['FORMWORK','Formwork alignment and stability checked','Check alignment, supports, bracing and stability.'],
      ['FORMWORK','Formwork joints are tight and leak-proof','Check joints to prevent cement grout leakage.'],
      ['FORMWORK','Formwork is clean and free from debris','Remove loose materials, dust and standing water.'],
      ['REINFORCEMENT','Reinforcement bar diameter and spacing verified','Verify bar diameter, spacing and arrangement against approved drawings.'],
      ['REINFORCEMENT','Concrete cover and spacers checked','Verify specified concrete cover and proper spacer placement.'],
      ['REINFORCEMENT','Laps, anchorage and binding checked','Verify lap lengths, anchorage and secure binding.'],
      ['EMBEDDED ITEMS','Sleeves, conduits and inserts installed','Verify locations and sizes against approved drawings.'],
      ['CLEANLINESS','Slab surface and pour area cleaned','Remove debris, loose binding wire and unwanted materials.'],
      ['APPROVAL','Required inspection and approvals completed','Record required inspections and approvals before pouring.'],
    ],
    Detailed: [
      ['DRAWING','Latest approved structural drawings available','Confirm drawing number and revision against the latest approved documents.'],
      ['FORMWORK','Slab thickness and dimensions verified','Check slab thickness, dimensions and step locations against approved drawings.'],
      ['FORMWORK','Soffit level and slab top level checked','Verify levels, camber where specified and finished level references.'],
      ['FORMWORK','Formwork alignment and stability checked','Inspect supports, props, bracing, joints and overall stability.'],
      ['FORMWORK','Formwork joints sealed properly','Check joints for gaps and possible grout leakage.'],
      ['FORMWORK','Formwork surface cleaned and treated','Remove debris and confirm release agent is properly applied where specified.'],
      ['REINFORCEMENT','Bottom reinforcement diameter and spacing verified','Check bar size, spacing, direction and arrangement against drawings.'],
      ['REINFORCEMENT','Top reinforcement and extra bars verified','Check top bars, additional reinforcement and support arrangements.'],
      ['REINFORCEMENT','Concrete cover and cover blocks checked','Verify specified cover, cover block type, spacing and stability.'],
      ['REINFORCEMENT','Lap lengths and lap locations checked','Verify lap lengths and locations against approved details.'],
      ['REINFORCEMENT','Reinforcement anchorage and binding checked','Check anchorage, hooks, bends and secure binding.'],
      ['REINFORCEMENT','Reinforcement clean and free from harmful contamination','Check for loose rust, oil, mud, paint or other harmful materials.'],
      ['EMBEDDED ITEMS','Electrical conduits and junction boxes checked','Verify locations, fixing and coordination with reinforcement.'],
      ['EMBEDDED ITEMS','Plumbing sleeves and openings checked','Verify size, location and fixing against coordinated drawings.'],
      ['CONSTRUCTION JOINTS','Construction joint preparation checked','Verify location and preparation against approved method and drawings.'],
      ['CLEANLINESS','Slab and formwork cleaned before pouring','Remove debris, binding wire, standing water and loose materials.'],
      ['ACCESS','Concrete placing and vibration access checked','Confirm access for concrete placement, vibration and inspection.'],
      ['APPROVAL','Required inspection and approvals completed','Confirm required inspection records and approvals before pouring.'],
    ],
  },
  Beam: {
    Standard: [
      ['FORMWORK','Beam dimensions and alignment verified','Verify beam width, depth, levels and alignment against approved drawings.'],
      ['FORMWORK','Beam formwork properly supported','Check props, supports, bracing and stability.'],
      ['FORMWORK','Formwork joints are tight and clean','Check joints for grout leakage and remove debris.'],
      ['REINFORCEMENT','Main reinforcement size and arrangement verified','Verify bar diameter, number and arrangement against approved drawings.'],
      ['REINFORCEMENT','Stirrups size and spacing verified','Check stirrup diameter, spacing and positioning.'],
      ['REINFORCEMENT','Concrete cover and spacers checked','Verify specified cover and proper spacer placement.'],
      ['REINFORCEMENT','Laps, anchorage and beam-column connections checked','Verify lap lengths, anchorage and connection details.'],
      ['EMBEDDED ITEMS','Sleeves and embedded items checked','Verify required openings and embedded items.'],
      ['CLEANLINESS','Beam formwork cleaned before pouring','Remove loose materials, dust and standing water.'],
      ['APPROVAL','Required inspection and approvals completed','Record required inspections and approvals before pouring.'],
    ],
    Detailed: [
      ['DRAWING','Latest approved beam drawings available','Confirm drawing number and revision against approved documents.'],
      ['FORMWORK','Beam width, depth and levels verified','Check dimensions, soffit level, top level and alignment.'],
      ['FORMWORK','Beam formwork supports and bracing checked','Inspect props, bracing, support spacing and stability.'],
      ['FORMWORK','Beam formwork joints sealed','Check side and soffit joints for grout leakage.'],
      ['FORMWORK','Beam formwork cleaned','Remove debris, sawdust, binding wire and standing water.'],
      ['REINFORCEMENT','Top and bottom main bars verified','Check bar diameter, quantity, position and arrangement.'],
      ['REINFORCEMENT','Stirrups diameter and spacing verified','Check stirrup size, spacing, hooks and positioning.'],
      ['REINFORCEMENT','Extra bars and support reinforcement checked','Verify additional bars and support reinforcement against drawings.'],
      ['REINFORCEMENT','Concrete cover and spacers checked','Verify specified cover and stable spacer placement.'],
      ['REINFORCEMENT','Lap lengths and lap locations checked','Verify lap lengths and locations against approved details.'],
      ['REINFORCEMENT','Anchorage and development details checked','Verify anchorage, hooks and development details.'],
      ['CONNECTIONS','Beam-column reinforcement connection checked','Check continuity, anchorage and reinforcement congestion at joints.'],
      ['EMBEDDED ITEMS','Sleeves and embedded services checked','Verify openings and service locations against coordinated drawings.'],
      ['CONSTRUCTION JOINTS','Construction joint location checked','Verify joint location and preparation against approved details.'],
      ['CLEANLINESS','Beam reinforcement and formwork cleaned','Remove loose materials and harmful contamination.'],
      ['ACCESS','Concrete placement and vibration access checked','Confirm access for concrete placement and proper vibration.'],
      ['APPROVAL','Required inspection and approvals completed','Record required inspections and approvals before pouring.'],
    ],
  },
  Column: {
    Standard: [
      ['FORMWORK','Column dimensions and position verified','Verify column size and position against approved drawings.'],
      ['FORMWORK','Column verticality and alignment checked','Check verticality, line and alignment.'],
      ['FORMWORK','Column formwork stability and bracing checked','Verify tight joints, bracing and stability.'],
      ['FORMWORK','Formwork is clean and free from debris','Remove debris and unwanted materials before closing.'],
      ['REINFORCEMENT','Main reinforcement size and number verified','Check bar diameter and number against approved drawings.'],
      ['REINFORCEMENT','Tie spacing and arrangement checked','Verify tie diameter, spacing and arrangement.'],
      ['REINFORCEMENT','Concrete cover and spacers checked','Verify specified cover and spacer placement.'],
      ['REINFORCEMENT','Lap length and anchorage checked','Verify lap length, location and anchorage details.'],
      ['EMBEDDED ITEMS','Required inserts and embedded items checked','Verify required inserts and embedded items.'],
      ['APPROVAL','Required inspection and approvals completed','Record required inspections and approvals before pouring.'],
    ],
    Detailed: [
      ['DRAWING','Latest approved column drawings available','Confirm drawing number and revision against approved documents.'],
      ['SETTING OUT','Column location and grid position verified','Check column centreline and position against setting-out references.'],
      ['FORMWORK','Column dimensions and cross-section verified','Check column width, depth and shape against approved drawings.'],
      ['FORMWORK','Column verticality and alignment checked','Verify plumb, line and alignment before concrete placement.'],
      ['FORMWORK','Column formwork joints sealed','Check joints for gaps and possible grout leakage.'],
      ['FORMWORK','Formwork bracing and stability checked','Inspect ties, clamps, supports and bracing.'],
      ['FORMWORK','Column formwork cleaned internally','Remove debris and standing water before closing.'],
      ['REINFORCEMENT','Main bar diameter and quantity verified','Check bar diameter, number and arrangement against drawings.'],
      ['REINFORCEMENT','Tie diameter, spacing and hooks checked','Verify tie size, spacing, hook details and arrangement.'],
      ['REINFORCEMENT','Lap length and lap location checked','Verify lap length and location against approved details.'],
      ['REINFORCEMENT','Concrete cover and spacers checked','Verify specified cover and proper spacer placement.'],
      ['REINFORCEMENT','Column reinforcement alignment checked','Check cage position, verticality and secure binding.'],
      ['CONNECTIONS','Beam-column joint reinforcement checked','Verify joint reinforcement, anchorage and congestion details.'],
      ['STARTER BARS','Starter bars and dowels checked','Verify position, projection, spacing and anchorage.'],
      ['EMBEDDED ITEMS','Required inserts and embedded items checked','Verify embedded items and openings against approved drawings.'],
      ['CLEANLINESS','Reinforcement and formwork free from contamination','Remove loose materials, mud, oil and other harmful contamination.'],
      ['ACCESS','Concrete placement and vibration access checked','Confirm access for placing and compacting concrete.'],
      ['APPROVAL','Required inspection and approvals completed','Record required inspection records and approvals before pouring.'],
    ],
  },
  Footing: {
    Standard: [
      ['EXCAVATION','Footing location and dimensions verified','Check location, length, width and depth against approved drawings.'],
      ['EXCAVATION','Founding level and bearing surface checked','Verify founding level and obtain required ground approval.'],
      ['BLINDING','Blinding concrete or base preparation checked','Verify specified blinding or base preparation, where required.'],
      ['FORMWORK','Footing formwork dimensions and alignment checked','Verify dimensions, position, levels and stability.'],
      ['REINFORCEMENT','Reinforcement size and spacing verified','Check bar diameter, spacing and arrangement.'],
      ['REINFORCEMENT','Concrete cover and spacers checked','Verify specified cover and spacer placement.'],
      ['REINFORCEMENT','Column starter bars and anchorage checked','Verify starter bar position, projection and anchorage.'],
      ['EMBEDDED ITEMS','Sleeves and embedded items checked','Verify required sleeves and embedded items, where applicable.'],
      ['CLEANLINESS','Footing base and formwork cleaned','Remove loose soil, debris and standing water.'],
      ['APPROVAL','Required inspection and approvals completed','Record required inspections and approvals before pouring.'],
    ],
    Detailed: [
      ['DRAWING','Latest approved foundation drawings available','Confirm drawing number and revision against approved documents.'],
      ['SETTING OUT','Footing location and dimensions verified','Check grid, centreline, length, width and depth against drawings.'],
      ['EXCAVATION','Excavation depth and founding level checked','Verify excavation depth and founding level against approved details.'],
      ['EXCAVATION','Bearing surface condition inspected','Check bearing surface and obtain required geotechnical or engineer approval.'],
      ['EXCAVATION','Excavation base free from loose soil and water','Remove loose soil, debris and standing water.'],
      ['BLINDING','Blinding concrete or base preparation checked','Verify specified thickness, level and condition where required.'],
      ['FORMWORK','Footing formwork dimensions and levels verified','Check dimensions, position, levels and stability.'],
      ['FORMWORK','Formwork joints and supports checked','Verify tight joints, bracing and support stability.'],
      ['REINFORCEMENT','Bottom reinforcement diameter and spacing verified','Check bar diameter, spacing and arrangement against drawings.'],
      ['REINFORCEMENT','Top reinforcement checked where specified','Verify additional or top reinforcement where shown in drawings.'],
      ['REINFORCEMENT','Concrete cover and spacers checked','Verify specified cover and stable spacer placement.'],
      ['REINFORCEMENT','Lap lengths and anchorage checked','Verify lap lengths, hooks and anchorage details.'],
      ['STARTER BARS','Column starter bars position and projection checked','Verify position, spacing, projection and anchorage.'],
      ['STARTER BARS','Starter bars secured and aligned','Check verticality, binding and stability before pouring.'],
      ['EMBEDDED ITEMS','Sleeves and embedded items checked','Verify locations and sizes where required by approved drawings.'],
      ['CLEANLINESS','Footing base and reinforcement cleaned','Remove loose soil, mud, debris and harmful contamination.'],
      ['ACCESS','Concrete placement and vibration access checked','Confirm access for placing and compacting concrete.'],
      ['APPROVAL','Required inspection and approvals completed','Record required inspections and approvals before pouring.'],
    ],
  },
}

const keyOf = (el, level) => `${el}-${level}`
const makeInspectionId = () => `active-inspection-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
const localDate = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function makeItems(el, level = 'Standard') {
  return (T[el]?.[level] || T.Slab.Standard).map((r, i) => ({
    id: `${el}-${level}-${i + 1}`, category: r[0], requirement: r[1], criteria: r[2],
    status: 'Pending', remarks: '', correctiveAction: '',
  }))
}
function normalizeItems(list, el = 'Slab') {
  if (!Array.isArray(list)) return makeItems(el)
  const usedIds = new Set()
  return list.map((x, i) => {
    let id = typeof x?.id === 'string' && x.id.trim() ? x.id.trim() : `item-${Date.now()}-${i}`
    while (usedIds.has(id)) id = `item-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`
    usedIds.add(id)
    return {
      id, category: x?.category || 'GENERAL', requirement: x?.requirement || '',
      criteria: x?.criteria || '', status: STATUSES.includes(x?.status) ? x.status : 'Pending',
      remarks: x?.remarks || '', correctiveAction: x?.correctiveAction || '',
    }
  })
}
function cleanTemplateItems(list, el = 'Slab', templateId = `${el}-template`) {
  return normalizeItems(list, el).map((item, i) => ({
    ...item, id: `${templateId}-item-${i + 1}`, status: 'Pending', remarks: '', correctiveAction: '',
  }))
}
function saveRecoveryCopy(raw) {
  const baseKey = `${STORAGE_RECOVERY_KEY}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  let recoveryKey = baseKey
  let suffix = 1
  while (localStorage.getItem(recoveryKey) !== null) {
    recoveryKey = `${baseKey}-${suffix}`
    suffix += 1
  }
  localStorage.setItem(recoveryKey, raw)
  return recoveryKey
}
function snapshotInspection(data) {
  return {
    id: `inspection-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    inspectionInstanceId: data.inspectionInstanceId,
    savedAt: new Date().toISOString(), project: data.project, element: data.element,
    level: data.level, location: data.location, drawing: data.drawing, revision: data.revision,
    inspector: data.inspector, date: data.date, contractor: data.contractor, engineer: data.engineer,
    reportDesign: data.reportDesign, selectedTemplateId: data.selectedTemplateId,
    templateName: data.level === 'Custom' ? (data.customTemplates.find(t => t.id === data.selectedTemplateId)?.name || 'Custom template') : `${data.element} ${data.level}`,
    items: normalizeItems(data.items, data.element),
  }
}
function initialData() {
  storageLoadWarning = ''
  storageLoadBlocked = false
  unreadableStorageBackup = null
  const templates = {}
  ELEMENTS.forEach(el => LEVELS.forEach(level => { templates[keyOf(el, level)] = makeItems(el, level) }))
  const base = {
    storageVersion: STORAGE_VERSION,
    inspectionInstanceId: makeInspectionId(),
    project: '', element: 'Slab', level: 'Standard', location: '', drawing: '', revision: '',
    inspectionHistory: [],
    inspector: '', date: localDate(), contractor: '', engineer: '', reportDesign: 'Professional',
    selectedTemplateId: 'Slab-Standard', templates, customTemplates: [], inspectionDrafts: {}, items: templates['Slab-Standard'],
  }
  let raw = null
  try {
    raw = localStorage.getItem(STORAGE_KEY)
  } catch {
    storageLoadWarning = 'Browser storage is unavailable; changes may not persist.'
    return base
  }
  try {
    const saved = JSON.parse(raw || 'null')
    if (!saved) return base
    if (typeof saved !== 'object' || Array.isArray(saved)) throw new Error('Saved inspection data has an invalid format.')
    const savedVersion = Number(saved.storageVersion ?? saved.version ?? 1)
    if (!Number.isFinite(savedVersion) || savedVersion < 1) throw new Error('Saved inspection data has an invalid version.')
    if (savedVersion > STORAGE_VERSION) {
      storageLoadBlocked = true
      storageLoadWarning = `Saved data version ${savedVersion} is newer than this application. It has been preserved and will not be overwritten.`
      return base
    }
    const el = ELEMENTS.includes(saved.element) ? saved.element : 'Slab'
    const level = LEVELS.includes(saved.level) ? saved.level : 'Standard'
    const merged = { ...templates, ...(saved.templates || {}) }
    // Migrate old format templates stored under element-only keys.
    ELEMENTS.forEach(name => {
      if (Array.isArray(saved.templates?.[name]) && !saved.templates?.[keyOf(name, 'Standard')]) {
        merged[keyOf(name, 'Standard')] = normalizeItems(saved.templates[name], name)
      }
    })
    if (Array.isArray(saved.items)) merged[keyOf(el, level)] = normalizeItems(saved.items, el)
    Object.keys(merged).forEach(k => { merged[k] = normalizeItems(merged[k], k.split('-')[0]) })
    const customs = Array.isArray(saved.customTemplates) ? saved.customTemplates.map((t, i) => ({
      id: t.id || `custom-old-${i}`, name: t.name || 'Custom template',
      element: ELEMENTS.includes(t.element) ? t.element : 'Slab',
      items: cleanTemplateItems(t.items, ELEMENTS.includes(t.element) ? t.element : 'Slab', t.id || `custom-old-${i}`),
    })) : []
    const selectedCustom = customs.find(t => t.id === saved.selectedTemplateId)
    const savedDrafts = saved.inspectionDrafts && typeof saved.inspectionDrafts === 'object' && !Array.isArray(saved.inspectionDrafts)
      ? saved.inspectionDrafts
      : {}
    return {
      ...base, ...saved, storageVersion: STORAGE_VERSION, templates: merged, customTemplates: customs,
      inspectionDrafts: Object.fromEntries(Object.entries(savedDrafts).map(([id, list]) => [id, normalizeItems(list)])),
      inspectionInstanceId: typeof saved.inspectionInstanceId === 'string' && saved.inspectionInstanceId.trim()
        ? saved.inspectionInstanceId
        : base.inspectionInstanceId,
      inspectionHistory: Array.isArray(saved.inspectionHistory) ? saved.inspectionHistory : [],
      element: selectedCustom ? selectedCustom.element : el,
      level: selectedCustom ? 'Custom' : level,
      selectedTemplateId: selectedCustom ? selectedCustom.id : keyOf(el, level),
      items: selectedCustom
        ? normalizeItems(savedDrafts[selectedCustom.id] || saved.items || selectedCustom.items, selectedCustom.element)
        : merged[keyOf(el, level)],
      reportDesign: DESIGNS.includes(saved.reportDesign) ? saved.reportDesign : 'Professional',
    }
  } catch (error) {
    if (raw) unreadableStorageBackup = raw
    storageLoadWarning = error?.message || 'Saved inspection data could not be read.'
    return base
  }
}

export default function App() {
  const [data, setData] = useState(initialData)
  const [saveMessage, setSaveMessage] = useState(() => storageLoadWarning ? `Save Failed — ${storageLoadWarning}` : 'Saved')
  const [newTemplateName, setNewTemplateName] = useState('')
  const [showCriteria, setShowCriteria] = useState(true)
  const [searchText, setSearchText] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const [showHistory, setShowHistory] = useState(false)
  const initialDataRef = useRef(data)
  const { project, element, level, location, drawing, revision, inspector, date, contractor,
    engineer, reportDesign, selectedTemplateId, templates, customTemplates, items } = data

  useEffect(() => {
    if (storageLoadWarning && data === initialDataRef.current) {
      setSaveMessage(`Save Failed — ${storageLoadWarning}`)
      return
    }
    if (storageLoadBlocked) {
      setSaveMessage(`Save Failed — ${storageLoadWarning}`)
      return
    }
    setSaveMessage('Saving…')
    let snapshotSaved = false
    const saveNow = () => {
      if (snapshotSaved) return true
      try {
        const hasRecoveryCopy = Boolean(unreadableStorageBackup)
        if (unreadableStorageBackup) {
          saveRecoveryCopy(unreadableStorageBackup)
          unreadableStorageBackup = null
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...data, storageVersion: STORAGE_VERSION }))
        snapshotSaved = true
        setSaveMessage(hasRecoveryCopy ? 'Saved — recovery copy preserved' : 'Saved')
        storageLoadWarning = ''
        return true
      } catch {
        setSaveMessage('Save Failed — browser storage could not save these changes')
        return false
      }
    }
    const timeout = window.setTimeout(saveNow, 120)
    const flushPendingSave = () => { saveNow() }
    const flushWhenHidden = () => {
      if (document.visibilityState === 'hidden') saveNow()
    }
    window.addEventListener('pagehide', flushPendingSave)
    window.addEventListener('beforeunload', flushPendingSave)
    document.addEventListener('visibilitychange', flushWhenHidden)
    return () => {
      window.clearTimeout(timeout)
      window.removeEventListener('pagehide', flushPendingSave)
      window.removeEventListener('beforeunload', flushPendingSave)
      document.removeEventListener('visibilitychange', flushWhenHidden)
    }
  }, [data])

  const counts = useMemo(() => ({
    ok: items.filter(x => x.status === 'OK').length,
    failed: items.filter(x => x.status === 'Not OK').length,
    pending: items.filter(x => x.status === 'Pending').length,
    na: items.filter(x => x.status === 'N/A').length,
  }), [items])
  const reviewed = counts.ok + counts.failed + counts.na
  const progress = items.length ? Math.round(reviewed / items.length * 100) : 0
  const dateText = date ? new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  }) : 'Not specified'
  const activeTemplateName = level === 'Custom'
    ? customTemplates.find(t => t.id === selectedTemplateId)?.name || 'Custom template'
    : `${element} ${level}`
  const filteredItems = items
    .map((item, originalIndex) => ({ ...item, originalIndex }))
    .filter(item => (statusFilter === 'All' || item.status === statusFilter)
      && `${item.category} ${item.requirement} ${item.criteria} ${item.remarks} ${item.correctiveAction}`.toLowerCase().includes(searchText.toLowerCase()))
  const templateOptions = [
    ...ELEMENTS.flatMap(el => LEVELS.map(l => ({ id: keyOf(el, l), label: `${el} — ${l}` }))),
    ...customTemplates.map(t => ({ id: t.id, label: `${t.name} — Custom` })),
  ]

  function persistCurrent(s) {
    if (s.level === 'Custom') {
      return { ...s, inspectionDrafts: { ...(s.inspectionDrafts || {}), [s.selectedTemplateId]: s.items } }
    }
    return { ...s, templates: { ...s.templates, [keyOf(s.element, s.level)]: s.items } }
  }
  function field(name, value) { setData(s => ({ ...s, [name]: value })) }
  function chooseTemplate(id) {
    setData(s => {
      const saved = persistCurrent(s)
      const custom = saved.customTemplates.find(t => t.id === id)
      if (custom) return {
        ...saved, element: custom.element, level: 'Custom', selectedTemplateId: id,
        items: saved.inspectionDrafts?.[id] || custom.items,
      }
      const [el, lev] = id.split('-')
      return { ...saved, element: el, level: lev, selectedTemplateId: id, items: saved.templates[id] || makeItems(el, lev) }
    })
  }
  function editItem(id, prop, value) {
    setData(s => persistCurrent({ ...s, items: s.items.map(x => x.id === id ? { ...x, [prop]: value } : x) }))
  }
  function addItem() {
    setData(s => persistCurrent({ ...s, items: [...s.items, {
      id: `custom-item-${Date.now()}`, category: 'GENERAL', requirement: '', criteria: '',
      status: 'Pending', remarks: '', correctiveAction: '',
    }] }))
  }
  function removeItem(id) {
    if (!window.confirm('Remove this checklist item?')) return
    setData(s => persistCurrent({ ...s, items: s.items.filter(x => x.id !== id) }))
  }
  function createTemplateFromSource(sourceItems, state, name) {
    const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const items = cleanTemplateItems(sourceItems, state.element, id)
    const custom = { id, name, element: state.element, items }
    return {
      ...state, level: 'Custom', selectedTemplateId: id,
      customTemplates: [...state.customTemplates, custom],
      inspectionDrafts: { ...(state.inspectionDrafts || {}), [id]: items },
      items,
    }
  }
  function requestedTemplateName() {
    const name = newTemplateName.trim()
    if (!name) window.alert('Please enter a name for the custom template.')
    return name
  }
  function createFromStandard() {
    const name = requestedTemplateName()
    if (!name) return
    setData(s => createTemplateFromSource(makeItems(s.element, 'Standard'), s, name))
    setNewTemplateName('')
  }
  function saveCurrentAsCustom() {
    const name = requestedTemplateName()
    if (!name) return
    setData(s => createTemplateFromSource(s.items, s, name))
    setNewTemplateName('')
  }
  function duplicateCurrentTemplate() {
    const name = requestedTemplateName()
    if (!name) return
    setData(s => {
      const selectedCustom = s.customTemplates.find(t => t.id === s.selectedTemplateId)
      const source = selectedCustom?.items || s.templates[s.selectedTemplateId] || makeItems(s.element, s.level === 'Custom' ? 'Standard' : s.level)
      return createTemplateFromSource(source, s, name)
    })
    setNewTemplateName('')
  }
  function deleteTemplate() {
    if (level !== 'Custom') return
    if (!window.confirm('Delete this custom template from this browser?')) return
    setData(s => {
      const key = keyOf(s.element, 'Standard')
      return { ...s, level: 'Standard', selectedTemplateId: key,
        customTemplates: s.customTemplates.filter(t => t.id !== s.selectedTemplateId),
        inspectionDrafts: Object.fromEntries(Object.entries(s.inspectionDrafts || {}).filter(([id]) => id !== s.selectedTemplateId)),
        items: s.templates[key] || makeItems(s.element, 'Standard') }
    })
  }
  function archiveCurrent(s) {
    const inspectionInstanceId = s.inspectionInstanceId || makeInspectionId()
    const record = snapshotInspection({ ...s, inspectionInstanceId })
    const history = s.inspectionHistory || []
    const alreadyArchived = history.some(existing => (existing.inspectionInstanceId || existing.id) === inspectionInstanceId)
    if (alreadyArchived) return s
    return { ...s, inspectionInstanceId, inspectionHistory: [record, ...history] }
  }
  function archiveInspection() {
    setData(s => archiveCurrent(persistCurrent(s)))
  }
  function removeInspection(record, recordIndex) {
    if (!record || data.inspectionHistory[recordIndex] !== record) return
    const label = `${record.project || 'Untitled project'} · ${record.date || 'No date'}`
    if (!window.confirm(`Remove the archived inspection “${label}” from history? This will not change the active inspection.`)) return
    setData(s => ({
      ...s,
      inspectionHistory: (s.inspectionHistory || []).filter((item, index) => index !== recordIndex || item !== record),
    }))
  }
  function startNewInspection() {
    if (!window.confirm('Archive this inspection and start a new one? Project, element, location, drawing number and revision, inspector, contractor, engineer, report design, and selected template will be retained. The inspection date will be set to today, and every checklist status, remark, and corrective action will be reset.')) return
    setSearchText('')
    setStatusFilter('All')
    const nextInspectionInstanceId = makeInspectionId()
    setData(s => {
      const archived = archiveCurrent(persistCurrent(s))
      const fresh = s.level === 'Custom'
        ? (s.customTemplates.find(t => t.id === s.selectedTemplateId)?.items || makeItems(s.element, 'Standard'))
        : (s.templates[keyOf(s.element, s.level)] || makeItems(s.element, s.level))
      const reset = cleanTemplateItems(fresh, s.element, `${s.selectedTemplateId}-inspection-${Date.now()}`)
      const next = { ...archived, inspectionInstanceId: nextInspectionInstanceId, date: localDate(), items: reset }
      return s.level === 'Custom'
        ? { ...next, inspectionDrafts: { ...(next.inspectionDrafts || {}), [s.selectedTemplateId]: reset } }
        : { ...next, templates: { ...next.templates, [keyOf(s.element, s.level)]: reset } }
    })
  }
  function restoreInspection(selectedRecord, recordIndex) {
    if (!selectedRecord || data.inspectionHistory[recordIndex] !== selectedRecord) return
    if (!window.confirm('Restore this archived inspection? The current checklist will be replaced. Archive the current inspection first if you need to keep it.')) return
    setData(s => {
      const record = (s.inspectionHistory || [])[recordIndex]
      if (record !== selectedRecord) return s
      const safeElement = ELEMENTS.includes(record.element) ? record.element : 'Slab'
      const safeLevel = ['Standard', 'Detailed', 'Custom'].includes(record.level) ? record.level : 'Standard'
      let customTemplatesNext = s.customTemplates
      let selectedTemplateId = keyOf(safeElement, safeLevel)
      if (safeLevel === 'Custom') {
        let custom = customTemplatesNext.find(t => t.id === record.selectedTemplateId)
        if (!custom) {
          const id = record.selectedTemplateId && !customTemplatesNext.some(t => t.id === record.selectedTemplateId) ? record.selectedTemplateId : `custom-${Date.now()}`
          custom = { id, name: record.templateName || 'Restored custom template', element: safeElement, items: cleanTemplateItems(record.items, safeElement, id) }
          customTemplatesNext = [...customTemplatesNext, custom]
        }
        selectedTemplateId = custom.id
      }
      const drafts = { ...(s.inspectionDrafts || {}) }
      if (safeLevel === 'Custom') drafts[selectedTemplateId] = normalizeItems(record.items, safeElement)
      return { ...s, project: record.project || '', element: safeElement, level: safeLevel,
        location: record.location || '', drawing: record.drawing || '', revision: record.revision || '',
        inspector: record.inspector || '', date: record.date || localDate(), contractor: record.contractor || '',
        engineer: record.engineer || '', reportDesign: DESIGNS.includes(record.reportDesign) ? record.reportDesign : 'Professional',
        inspectionInstanceId: record.inspectionInstanceId || record.id || makeInspectionId(),
        selectedTemplateId, customTemplates: customTemplatesNext, inspectionDrafts: drafts,
        items: normalizeItems(record.items, safeElement) }
    })
    setShowHistory(false)
  }
  function updateCustomTemplate() {
    if (level !== 'Custom') return
    if (!window.confirm('Update this custom template with the current checklist wording? Statuses, remarks and corrective actions will not be saved.')) return
    setData(s => ({ ...s, customTemplates: s.customTemplates.map(t => t.id === s.selectedTemplateId
      ? { ...t, element: s.element, items: cleanTemplateItems(s.items, s.element, t.id) } : t) }))
  }
  function printReport() { window.print() }

  const failedItems = items.map((x, i) => ({ ...x, number: i + 1 })).filter(x => x.status === 'Not OK')
  const checklistNumber = counts.failed ? 4 : 3
  const signoffNumber = checklistNumber + 1

  return <>
    <div className="screen-only">
      <div className="app-shell">
        <header className="topbar">
          <div className="brand"><div className="brand-icon">CC</div><div><strong>ConcreteCheck</strong><span>Pre-Pour Inspection</span></div></div>
          <div className="topbar-actions"><span className="draft-label">{saveMessage}</span><button className="primary-button" onClick={printReport}>Export report</button></div>
        </header>
        <main className="main-content">
          <section className="hero"><div><p className="eyebrow">SMART PRE-POUR INSPECTION BUILDER</p><h1>Concrete Pre-Pour Checklist</h1><p className="hero-description">Create, customize and download professional concrete inspection reports.</p></div></section>

          <section className="overview-grid">
            <div className="overview-card"><span>Total items</span><strong>{items.length}</strong></div>
            <div className="overview-card"><span>OK</span><strong>{counts.ok}</strong></div>
            <div className="overview-card"><span>Not OK</span><strong>{counts.failed}</strong></div>
            <div className="overview-card"><span>Pending</span><strong>{counts.pending}</strong></div>
          </section>

          <section className="panel progress-panel">
            <div className="section-heading"><div><h2>Inspection progress</h2><p>{reviewed} of {items.length} items reviewed (OK, Not OK or N/A)</p></div><strong>{progress}%</strong></div>
            <div className="progress-track"><div className="progress-fill" style={{ width: `${progress}%` }} /></div>
            <div className="legend"><span>● OK: {counts.ok}</span><span>● Not OK: {counts.failed}</span><span>● Pending: {counts.pending}</span><span>● N/A: {counts.na}</span></div>
          </section>

          <section className="panel">
            <div className="section-heading"><div><h2>Project information</h2><p>Enter the details for this inspection.</p></div></div>
            <div className="form-grid">
              <label>Project name<input value={project} onChange={e => field('project', e.target.value)} placeholder="e.g. Residential Apartment Building" /></label>
              <label>Structural element<select value={element} onChange={e => chooseTemplate(keyOf(e.target.value, 'Standard'))}>{ELEMENTS.map(x => <option key={x}>{x}</option>)}</select></label>
              <label>Location / Grid<input value={location} onChange={e => field('location', e.target.value)} placeholder="e.g. Third Floor – Grid A1 to A4" /></label>
              <label>Inspection date<input type="date" value={date} onChange={e => field('date', e.target.value)} /></label>
              <label>Drawing number<input value={drawing} onChange={e => field('drawing', e.target.value)} placeholder="e.g. STR-SLAB-003" /></label>
              <label>Drawing revision<input value={revision} onChange={e => field('revision', e.target.value)} placeholder="e.g. Rev. 02" /></label>
              <label>Inspector<input value={inspector} onChange={e => field('inspector', e.target.value)} placeholder="Inspector name" /></label>
              <label>Contractor representative<input value={contractor} onChange={e => field('contractor', e.target.value)} placeholder="Name" /></label>
              <label>Engineer<input value={engineer} onChange={e => field('engineer', e.target.value)} placeholder="Name" /></label>
            </div>
          </section>

          <section className="panel">
            <div className="section-heading"><div><h2>Checklist template</h2><p>Choose a template, then tailor its items for this inspection.</p></div></div>
            <div className="template-controls">
              <label>Template library<select value={selectedTemplateId} onChange={e => chooseTemplate(e.target.value)}>{templateOptions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</select></label>
              <label>PDF report design<select value={reportDesign} onChange={e => field('reportDesign', e.target.value)}>{DESIGNS.map(x => <option key={x}>{x}</option>)}</select></label>
            </div>
            <div className="custom-template-controls">
              <label>Custom template name<input value={newTemplateName} onChange={e => setNewTemplateName(e.target.value)} placeholder="e.g. Typical residential slab" /></label>
              <div className="custom-template-actions">
                <button className="secondary-button" onClick={createFromStandard}>Create from standard</button>
                <button className="secondary-button" onClick={saveCurrentAsCustom}>Save current as custom</button>
                <button className="secondary-button" onClick={duplicateCurrentTemplate}>Duplicate current</button>
                {level === 'Custom' && <button className="secondary-button" onClick={updateCustomTemplate}>Update custom template</button>}
                {level === 'Custom' && <button className="danger-button" onClick={deleteTemplate}>Delete custom template</button>}
              </div>
            </div>
          </section>

          <section className="panel checklist-panel">
            <div className="section-heading checklist-heading"><div><h2>{element} inspection checklist</h2><p>{activeTemplateName} · Showing {filteredItems.length} of {items.length} items</p></div><div className="inline-actions"><button className="secondary-button" onClick={() => setShowHistory(v => !v)}>Inspection history ({data.inspectionHistory.length})</button><button className="secondary-button" onClick={archiveInspection}>Archive inspection</button><button className="secondary-button" onClick={startNewInspection}>Start new inspection</button><button className="primary-button" onClick={addItem}>+ Add item</button></div></div>
            <div className="checklist-toolbar"><input value={searchText} onChange={e => setSearchText(e.target.value)} placeholder="Search checklist items" /><select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}><option>All</option>{STATUSES.map(x => <option key={x}>{x}</option>)}</select><label className="checkbox-label"><input type="checkbox" checked={showCriteria} onChange={e => setShowCriteria(e.target.checked)} /> Show acceptance criteria</label></div>
            <div className="checklist-table">
              <div className="table-header"><span>Inspection item</span><span>Status</span><span>Remarks and action</span><span>Remove</span></div>
              {items.length === 0 && <div className="empty-checklist">No checklist items. Select Add item to begin.</div>}
              {items.length > 0 && filteredItems.length === 0 && <div className="empty-checklist">No checklist items match the current search or status filter.</div>}
              {showHistory && <div className="history-panel">{data.inspectionHistory.length === 0 ? <p>No archived inspections yet.</p> : data.inspectionHistory.map((record, historyIndex) => <div className="history-entry" key={`${record.id}-${historyIndex}`}><span><strong>{record.project || 'Untitled project'}</strong> · {record.element} · {record.templateName} · {record.date || 'No date'}</span><button className="secondary-button" onClick={() => restoreInspection(record, historyIndex)}>Restore</button><button className="danger-button" onClick={() => removeInspection(record, historyIndex)}>Remove</button></div>)}</div>}
              {filteredItems.map((item) => <div className="checklist-row checklist-row-expanded" key={item.id}>
                <div className="requirement-cell">
                  <div className="item-number">{String(item.originalIndex + 1).padStart(2, '0')} · Inspection item</div>
                  <input aria-label="Category" value={item.category} onChange={e => editItem(item.id, 'category', e.target.value)} placeholder="Category (e.g. FORMWORK)" />
                  <textarea aria-label="Inspection requirement" value={item.requirement} onChange={e => editItem(item.id, 'requirement', e.target.value)} placeholder="Inspection requirement" rows="2" />
                  {showCriteria && <textarea aria-label="Acceptance criteria" value={item.criteria} onChange={e => editItem(item.id, 'criteria', e.target.value)} placeholder="Acceptance criteria / inspection reference" rows="2" />}
                </div>
                <div className="status-cell"><select className={`status-select status-${item.status.toLowerCase().replace(' ', '-')}`} value={item.status} onChange={e => editItem(item.id, 'status', e.target.value)}>{STATUSES.map(s => <option key={s}>{s}</option>)}</select></div>
                <div className="checklist-detail-fields">
                  <textarea value={item.remarks} onChange={e => editItem(item.id, 'remarks', e.target.value)} placeholder="Inspection remarks" rows="2" />
                  <textarea value={item.correctiveAction} onChange={e => editItem(item.id, 'correctiveAction', e.target.value)} placeholder="Corrective action (if required)" rows="2" />
                </div>
                <div className="remove-cell"><button className="danger-button" onClick={() => removeItem(item.id)}>Remove</button></div>
              </div>)}
            </div>
          </section>

          <section className="panel notice-panel"><strong>Before concrete placement</strong><p>Resolve and re-inspect items marked Not OK. Confirm pending items and required approvals with the responsible engineer before pouring. Use the latest approved drawings and project specifications as the acceptance reference.</p></section>
          <div className="bottom-actions"><button className="primary-button" onClick={printReport}>Export / Print inspection report</button></div>
        </main>
        <footer className="app-footer">ConcreteCheck · A practical pre-pour inspection record</footer>
      </div>
    </div>

    <article className={`print-report print-${reportDesign.toLowerCase()}`}>
      <header className="print-header"><div className="print-brand">CONCRETECHECK</div><div className="print-document-label">INSPECTION RECORD</div><h1>CONCRETE PRE-POUR INSPECTION REPORT</h1><p>Pre-pour inspection and approval record</p></header>

      <section className="print-section"><h2>1. PROJECT INFORMATION</h2><table className="print-info-table"><tbody>
        <tr><th>Project name</th><td>{project || 'Not specified'}</td><th>Structural element</th><td>{element}</td></tr>
        <tr><th>Location / Grid</th><td>{location || 'Not specified'}</td><th>Inspection date</th><td>{dateText}</td></tr>
        <tr><th>Drawing number</th><td>{drawing || 'Not specified'}</td><th>Drawing revision</th><td>{revision || 'Not specified'}</td></tr>
        <tr><th>Checklist template</th><td>{activeTemplateName}</td><th>Report design</th><td>{reportDesign}</td></tr>
        <tr><th>Inspector</th><td colSpan="3">{inspector || 'Not specified'}</td></tr>
      </tbody></table></section>

      <section className="print-section"><h2>2. INSPECTION SUMMARY</h2><table className="print-summary-table"><thead><tr><th>Total items</th><th>OK</th><th>Not OK</th><th>Pending</th><th>N/A</th><th>Progress</th></tr></thead><tbody><tr><td>{items.length}</td><td>{counts.ok}</td><td>{counts.failed}</td><td>{counts.pending}</td><td>{counts.na}</td><td>{progress}%</td></tr></tbody></table></section>

      {failedItems.length > 0 && <section className="print-section"><h2>3. ITEMS REQUIRING ATTENTION</h2><table className="print-attention-table"><thead><tr><th>No.</th><th>Requirement</th><th>Remarks</th><th>Corrective action</th></tr></thead><tbody>
        {failedItems.map(x => <tr key={x.id}><td>{String(x.number).padStart(2, '0')}</td><td>{x.requirement || 'Not specified'}</td><td>{x.remarks || 'Not recorded'}</td><td>{x.correctiveAction || 'Not provided'}</td></tr>)}
      </tbody></table></section>}

      <section className="print-section"><h2>{checklistNumber}. {element.toUpperCase()} INSPECTION CHECKLIST</h2><table className="print-checklist-table"><thead><tr>
        <th className="print-no">No.</th><th className="print-category">Category</th><th>Inspection requirement{reportDesign === 'Compact' ? ' / criteria' : ''}</th><th className="print-status">Status</th><th>Remarks{reportDesign === 'Compact' ? ' / action' : ' / corrective action'}</th>
      </tr></thead><tbody>
        {items.map((x, i) => <tr key={x.id}><td>{String(i + 1).padStart(2, '0')}</td><td>{x.category || 'GENERAL'}</td><td><strong>{x.requirement || 'Not specified'}</strong>{x.criteria && <div className="print-criteria">{reportDesign === 'Compact' ? `Criteria: ${x.criteria}` : x.criteria}</div>}</td><td className={`print-status-${x.status.toLowerCase().replace(' ', '-')}`}>{x.status}</td><td><div>{x.remarks || '—'}</div>{x.correctiveAction && <div className="print-corrective-action"><strong>Action:</strong> {x.correctiveAction}</div>}</td></tr>)}
      </tbody></table></section>

      <section className="print-section print-signoff-section"><h2>{signoffNumber}. INSPECTION SIGN-OFF</h2><table className="print-sign-table"><thead><tr><th>Inspector</th><th>Contractor representative</th><th>Engineer</th></tr></thead><tbody>
        <tr><td>{inspector || ' '}</td><td>{contractor || ' '}</td><td>{engineer || ' '}</td></tr>
        <tr><td>Signature: __________________</td><td>Signature: __________________</td><td>Signature: __________________</td></tr>
        <tr><td>Date: _______________________</td><td>Date: _______________________</td><td>Date: _______________________</td></tr>
      </tbody></table></section>

      <section className="print-note"><strong>Inspection note</strong><p>Verify all requirements against the latest approved drawings, project specifications and applicable inspection criteria. This checklist is a recording tool and does not replace project-specific technical approval.</p></section>
      <footer className="print-footer">ConcreteCheck · Concrete Pre-Pour Inspection Report</footer>
    </article>
  </>
}
