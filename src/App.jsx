import { Fragment, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createId } from './utils/ids.js'
import { STORAGE_VERSION, normalizeItem, normalizeItems as normalizeSchemaItems, cleanTemplateItems as cleanSchemaTemplateItems, migrateInspectionData, collectMediaIds } from './storage/schema.js'
import { preparePhoto, putPhoto, getPhoto, getPhotos, deletePhoto, createPhotoUrl, revokePhotoUrl } from './storage/mediaDb.js'
import { archiveSnapshot, makeRestoredInspection } from './storage/history.js'
import ChecklistItemCard, { SubCheckList } from './components/ChecklistItemCard.jsx'
import { createBackup, parseBackup, importBackup } from './storage/backup.js'

const STORAGE_KEY = 'concretecheck-inspection-v1'
const STORAGE_RECOVERY_KEY = `${STORAGE_KEY}-recovery`
const ELEMENTS = ['Slab', 'Beam', 'Column', 'Footing']
const LEVELS = ['Standard', 'Detailed']
const STATUSES = ['Pending', 'OK', 'Not OK', 'N/A']
const DESIGNS = ['Professional', 'Detailed', 'Compact']
const FILTER_OPTIONS = ['All', 'Pending', 'OK', 'Not OK', 'N/A']
const MOBILE_LAYOUT_QUERY = '(max-width: 600px)'
let storageLoadWarning = ''
let storageLoadBlocked = false
let unreadableStorageBackup = null

function MobileChecklistItem({ item, number, showCriteria, onShowCriteria, onStatusChange, onSubCheckChange, onOpen }) {
  const notesCount = [item.notes?.observations || item.remarks, item.notes?.comments].filter(value => String(value || '').trim()).length
  const photos = (item.mediaIds || []).length
  const actions = item.actions || []
  const openActions = actions.filter(action => action.status !== 'Completed').length
  return <article className={`mobile-item-preview mobile-status-${item.status.toLowerCase().replace(' ', '-')}`}>
    <div className="mobile-item-preview-top"><span className="mobile-item-number">ITEM {String(number).padStart(2, '0')}</span></div>
    <h3>{item.requirement?.trim() || 'Untitled inspection item'}</h3>
    <div className="mobile-item-criteria"><strong>Acceptance criteria</strong>{showCriteria ? <p>{item.criteria?.trim() || 'No acceptance criteria entered.'}</p> : <p className="criteria-hidden">Hidden · <button type="button" onClick={onShowCriteria}>Show criteria</button></p>}</div>
    <SubCheckList subChecks={item.subChecks || []} onChange={onSubCheckChange} compact status={item.status} />
    <div className="mobile-item-counts"><span>{notesCount} notes</span><span>{photos} photos</span><span>{actions.length} actions · {openActions} open</span></div>
    <div className="mobile-status-control" role="group" aria-label={`Set status for item ${number}`}>{STATUSES.map(status => <button type="button" key={status} className={`status-choice status-choice-${status.toLowerCase().replace(' ', '-')} ${item.status === status ? 'is-selected' : ''}`} aria-pressed={item.status === status} onClick={() => onStatusChange(status)}>{status}</button>)}</div>
    <button type="button" className="mobile-open-item" onClick={onOpen}>Open full inspection <span aria-hidden="true">→</span></button>
  </article>
}
let pendingMigrationBackup = null

function subscribeToMobileLayout(onChange) {
  const query = window.matchMedia(MOBILE_LAYOUT_QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

function getMobileLayoutSnapshot() {
  return window.matchMedia(MOBILE_LAYOUT_QUERY).matches
}

function getMobileLayoutServerSnapshot() {
  return false
}

// [category, inspection requirement, suggested acceptance reference, quick sub-check reminders]
const T = {
  Slab: {
    Standard: [
      ['DRAWINGS & SET-OUT','Slab layout, dimensions and levels verified','Check the latest approved drawing revision, grid, openings and levels.', ['Approved drawing and revision checked','Grid, slab dimensions and openings checked','Levels checked against project references']],
      ['FORMWORK','Slab formwork stable and ready','Check soffit dimensions, level, supports, bracing, tight joints and cleanliness.', ['Soffit dimensions and level checked','Supports and bracing checked','Joints, cleanliness and leakage risk checked']],
      ['REINFORCEMENT','Slab reinforcement arrangement verified','Check bar size, quantity, spacing and position against approved drawings.', ['Bar size and reinforcement quantity checked','Spacing and bar direction checked','Position checked against approved drawings']],
      ['REINFORCEMENT','Cover, supports, laps and anchorage checked','Verify specified cover, chairs or spacers, lap locations and anchorage details.', ['Specified cover checked','Chairs and spacers are stable','Lap locations and anchorage checked']],
      ['PRE-POUR READINESS','Embedded items and pour area ready','Check specified inserts and services, remove debris or standing water, and record required approvals.', ['Specified sleeves, conduits and inserts checked','Pour area is clean and free of standing water','Required inspection approvals recorded']],
      ['PLACEMENT READINESS','Concrete placement and testing ready','Confirm approved mix, sampling arrangements, placing and vibration access, weather precautions and site safety.', ['Approved mix and delivery requirements confirmed','Sampling and testing arrangements ready','Placement access, weather and site safety checked']],
    ],
    Detailed: [
      ['DRAWINGS & SET-OUT','Slab layout, dimensions and levels verified','Check the latest approved drawing revision, grid, openings and levels.', ['Approved drawing and revision checked','Grid, slab dimensions and openings checked','Levels checked against project references']],
      ['FORMWORK','Slab formwork stable and ready','Check soffit dimensions, level, supports, bracing, tight joints and cleanliness.', ['Soffit dimensions and level checked','Supports and bracing checked','Joints, cleanliness and leakage risk checked']],
      ['REINFORCEMENT','Slab reinforcement arrangement verified','Check bar size, quantity, spacing and position against approved drawings.', ['Bar size and reinforcement quantity checked','Spacing and bar direction checked','Position checked against approved drawings']],
      ['REINFORCEMENT','Additional bars around openings and edges checked','Verify trimming bars, support bars and local reinforcement where detailed.', ['Opening trimming bars checked','Edge and support reinforcement checked','Local reinforcement matches the approved details']],
      ['REINFORCEMENT','Cover, supports, laps and anchorage checked','Verify specified cover, chairs or spacers, lap locations and anchorage details.', ['Specified cover checked','Chairs and spacers are stable','Lap locations and anchorage checked']],
      ['CONSTRUCTION JOINTS','Construction joints and waterstops checked','Confirm joint locations, preparation and waterstops where specified.', ['Joint location matches approved details','Joint face preparation checked','Specified waterstop continuity checked']],
      ['PRE-POUR READINESS','Embedded items and pour area ready','Check specified inserts and services, remove debris or standing water, and record required approvals.', ['Specified sleeves, conduits and inserts checked','Pour area is clean and free of standing water','Required inspection approvals recorded']],
      ['PLACEMENT READINESS','Concrete placement and testing ready','Confirm approved mix, sampling arrangements, placing and vibration access, weather precautions and site safety.', ['Approved mix and delivery requirements confirmed','Sampling and testing arrangements ready','Placement access, weather and site safety checked']],
    ],
  },
  Beam: {
    Standard: [
      ['DRAWINGS & SET-OUT','Beam layout, dimensions and levels verified','Check the latest approved drawing revision, grid, dimensions and levels.', ['Approved drawing and revision checked','Beam grid, dimensions and levels checked','Beam alignment checked at supports']],
      ['FORMWORK','Beam formwork aligned, supported and ready','Check beam dimensions, soffit level, supports, bracing, tight joints and cleanliness.', ['Beam width, depth and soffit level checked','Supports and bracing checked','Joints, cleanliness and leakage risk checked']],
      ['REINFORCEMENT','Beam bars and stirrups verified','Check bar size, quantity, arrangement and stirrup spacing against approved drawings.', ['Top and bottom bar size and quantity checked','Stirrups and spacing checked against drawings','Bar arrangement and restraint checked']],
      ['REINFORCEMENT','Cover, laps and anchorage checked','Verify specified cover, spacers, lap locations and anchorage details.', ['Specified cover and spacers checked','Lap locations checked against details','End anchorage and development details checked']],
      ['PRE-POUR READINESS','Embedded items and pour area ready','Check specified sleeves or inserts, remove debris or standing water, and record required approvals.', ['Specified sleeves and inserts checked','Beam and formwork are clean','Required inspection approvals recorded']],
    ],
    Detailed: [
      ['DRAWINGS & SET-OUT','Beam layout, dimensions and levels verified','Check the latest approved drawing revision, grid, dimensions and levels.', ['Approved drawing and revision checked','Beam grid, dimensions and levels checked','Beam alignment checked at supports']],
      ['FORMWORK','Beam formwork aligned, supported and ready','Check beam dimensions, soffit level, supports, bracing, tight joints and cleanliness.', ['Beam width, depth and soffit level checked','Supports and bracing checked','Joints, cleanliness and leakage risk checked']],
      ['REINFORCEMENT','Beam bars and stirrups verified','Check bar size, quantity, arrangement and stirrup spacing against approved drawings.', ['Top and bottom bar size and quantity checked','Stirrups and spacing checked against drawings','Bar arrangement and restraint checked']],
      ['REINFORCEMENT','Cover, laps and anchorage checked','Verify specified cover, spacers, lap locations and anchorage details.', ['Specified cover and spacers checked','Lap locations checked against details','End anchorage and development details checked']],
      ['PRE-POUR READINESS','Embedded items and pour area ready','Check specified sleeves or inserts, remove debris or standing water, and record required approvals.', ['Specified sleeves and inserts checked','Beam and formwork are clean','Required inspection approvals recorded']],
      ['CONNECTIONS','Beam-column joint reinforcement checked','Verify continuity, anchorage and bar placement at the joint against approved details.', ['Joint bars are continuous as detailed','Anchorage and hooks checked at the joint','Congestion and concrete access reviewed']],
      ['CONSTRUCTION JOINTS','Joint locations and service openings coordinated','Confirm specified joint preparation and that sleeves or openings do not conflict with reinforcement.', ['Joint location and preparation checked','Sleeves and openings match coordinated drawings','Services do not conflict with reinforcement']],
      ['PLACEMENT READINESS','Concrete placement and testing ready','Confirm approved mix, sampling arrangements, placing and vibration access, weather precautions and site safety.', ['Approved mix and delivery requirements confirmed','Sampling and testing arrangements ready','Placement access, weather and site safety checked']],
    ],
  },
  Column: {
    Standard: [
      ['DRAWINGS & SET-OUT','Column position, dimensions and orientation verified','Check the latest approved drawing revision, grid and column dimensions.', ['Approved drawing and revision checked','Grid, position and orientation checked','Column dimensions checked']],
      ['FORMWORK','Column formwork plumb, stable and ready','Check alignment, ties, bracing, tight joints and internal cleanliness before closing.', ['Plumb and alignment checked','Ties and bracing checked','Joints and internal cleanliness checked before closing']],
      ['REINFORCEMENT','Main bars and ties verified','Check bar size, quantity, tie arrangement and spacing against approved drawings.', ['Main bar size and quantity checked','Tie arrangement and spacing checked','Cage position matches approved details']],
      ['REINFORCEMENT','Cover, laps and anchorage checked','Verify specified cover, spacers, lap locations, anchorage and cage stability.', ['Specified cover and spacers checked','Lap and anchorage details checked','Cage stability checked']],
      ['PRE-POUR READINESS','Embedded items and column base ready','Check specified inserts, clean the base, and record required inspections and approvals.', ['Specified inserts checked','Column base is clean','Required inspection approvals recorded']],
    ],
    Detailed: [
      ['DRAWINGS & SET-OUT','Column position, dimensions and orientation verified','Check the latest approved drawing revision, grid and column dimensions.', ['Approved drawing and revision checked','Grid, position and orientation checked','Column dimensions checked']],
      ['FORMWORK','Column formwork plumb, stable and ready','Check alignment, ties, bracing, tight joints and internal cleanliness before closing.', ['Plumb and alignment checked','Ties and bracing checked','Joints and internal cleanliness checked before closing']],
      ['REINFORCEMENT','Main bars and ties verified','Check bar size, quantity, tie arrangement and spacing against approved drawings.', ['Main bar size and quantity checked','Tie arrangement and spacing checked','Cage position matches approved details']],
      ['REINFORCEMENT','Cover, laps and anchorage checked','Verify specified cover, spacers, lap locations, anchorage and cage stability.', ['Specified cover and spacers checked','Lap and anchorage details checked','Cage stability checked']],
      ['PRE-POUR READINESS','Embedded items and column base ready','Check specified inserts, clean the base, and record required inspections and approvals.', ['Specified inserts checked','Column base is clean','Required inspection approvals recorded']],
      ['CONNECTIONS','Column starter bars and beam-column joint checked','Verify starter locations, projections, joint reinforcement and anchorage against details.', ['Starter bar location and projection checked','Joint reinforcement checked against details','Anchorage at the connection checked']],
      ['FORMWORK','Cleanout access and concrete placement path checked','Confirm the base is clean and provide practical access for placing and compacting concrete.', ['Cleanout opening/access checked before closing','Base is free of debris and standing water','Placing and compaction access is practical']],
      ['PLACEMENT READINESS','Concrete placement and testing ready','Confirm approved mix, sampling arrangements, placing access, weather precautions and site safety.', ['Approved mix and delivery requirements confirmed','Sampling and testing arrangements ready','Placement access, weather and site safety checked']],
    ],
  },
  Footing: {
    Standard: [
      ['DRAWINGS & SET-OUT','Footing location, dimensions and levels verified','Check the latest approved drawing revision, grid, dimensions and founding level.', ['Approved drawing and revision checked','Grid and footing dimensions checked','Founding level checked']],
      ['FOUNDATION PREPARATION','Bearing surface and base preparation approved','Check founding material, remove loose soil or water, and verify specified blinding where applicable.', ['Founding material accepted by the responsible person','Loose material and standing water removed','Specified blinding checked where applicable']],
      ['REINFORCEMENT','Footing reinforcement arrangement verified','Check bar size, quantity, spacing and position against approved drawings.', ['Bar size and reinforcement quantity checked','Spacing and bar direction checked','Position checked against approved drawings']],
      ['REINFORCEMENT','Cover, supports, laps and starter bars checked','Verify specified cover, spacers, lap locations, anchorage and starter bars.', ['Specified cover and supports checked','Lap and anchorage details checked','Starter bars match approved details']],
      ['PRE-POUR READINESS','Formwork and embedded items ready','Check required forms and inserts, remove debris or standing water, and record required approvals.', ['Required formwork and inserts checked','Base is clean and free of standing water','Required inspection approvals recorded']],
    ],
    Detailed: [
      ['DRAWINGS & SET-OUT','Footing location, dimensions and levels verified','Check the latest approved drawing revision, grid, dimensions and founding level.', ['Approved drawing and revision checked','Grid and footing dimensions checked','Founding level checked']],
      ['FOUNDATION PREPARATION','Bearing surface and base preparation approved','Check founding material, remove loose soil or water, and verify specified blinding where applicable.', ['Founding material accepted by the responsible person','Loose material and standing water removed','Specified blinding checked where applicable']],
      ['REINFORCEMENT','Footing reinforcement arrangement verified','Check bar size, quantity, spacing and position against approved drawings.', ['Bar size and reinforcement quantity checked','Spacing and bar direction checked','Position checked against approved drawings']],
      ['REINFORCEMENT','Cover, supports, laps and starter bars checked','Verify specified cover, spacers, lap locations, anchorage and starter bars.', ['Specified cover and supports checked','Lap and anchorage details checked','Starter bars match approved details']],
      ['PRE-POUR READINESS','Formwork and embedded items ready','Check required forms and inserts, remove debris or standing water, and record required approvals.', ['Required formwork and inserts checked','Base is clean and free of standing water','Required inspection approvals recorded']],
      ['REINFORCEMENT','Pedestal, top bars and local reinforcement checked','Verify pedestal or column connection bars, top reinforcement and local details where specified.', ['Pedestal or column connection bars checked','Top reinforcement checked where specified','Local reinforcement matches approved details']],
      ['FOUNDATION DETAILS','Construction joints and water control checked','Confirm joint, waterstop, dewatering and waterproofing details where specified.', ['Joint locations checked where specified','Waterstop and waterproofing details checked','Dewatering plan is ready where required']],
      ['PLACEMENT READINESS','Concrete placement and testing ready','Confirm approved mix, sampling arrangements, placing and vibration access, weather precautions and site safety.', ['Approved mix and delivery requirements confirmed','Sampling and testing arrangements ready','Placement access, weather and site safety checked']],
    ],
  },
}

const keyOf = (el, level) => `${el}-${level}`
const inspectionDraftKey = (inspectionInstanceId, templateId) => `inspection:${inspectionInstanceId}:${templateId}`
const makeInspectionId = () => createId('active-inspection')
const localDate = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function makeItems(el, level = 'Standard') {
  return (T[el]?.[level] || T.Slab.Standard).map((r, i) => ({
    ...normalizeItem({
      id: `${el}-${level}-${i + 1}`, category: r[0], requirement: r[1], criteria: r[2], status: 'Pending',
      subChecks: (r[3] || []).map((label, index) => ({ id: `${el}-${level}-${i + 1}-check-${index + 1}`, label, checked: false })),
    }),
  }))
}
function normalizeItems(list, el = 'Slab') {
  if (!Array.isArray(list)) return makeItems(el)
  return normalizeSchemaItems(list, `${el}-item`)
}
function cleanTemplateItems(list, el = 'Slab', templateId = `${el}-template`) {
  return cleanSchemaTemplateItems(normalizeItems(list, el), `${templateId}-item`)
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
    id: createId('history'),
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
  pendingMigrationBackup = null
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
    const migrated = migrateInspectionData(saved, base, keyOf)
    if (savedVersion < STORAGE_VERSION && raw) pendingMigrationBackup = raw
    const activeDraft = migrated.inspectionDrafts?.[inspectionDraftKey(migrated.inspectionInstanceId, migrated.selectedTemplateId)]
    return Array.isArray(activeDraft) ? { ...migrated, items: activeDraft } : migrated
  } catch (error) {
    if (raw) unreadableStorageBackup = raw
    storageLoadWarning = error?.message || 'Saved inspection data could not be read.'
    return base
  }
}

export default function App() {
  const [data, setData] = useState(initialData)
  const isMobileLayout = useSyncExternalStore(subscribeToMobileLayout, getMobileLayoutSnapshot, getMobileLayoutServerSnapshot)
  const [showProjectDetails, setShowProjectDetails] = useState(false)
  const [showTemplateSettings, setShowTemplateSettings] = useState(false)
  const [saveMessage, setSaveMessage] = useState(() => storageLoadWarning ? `Save Failed — ${storageLoadWarning}` : 'Saved')
  const [newTemplateName, setNewTemplateName] = useState('')
  const [showCriteria, setShowCriteria] = useState(true)
  const [searchText, setSearchText] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const [showHistory, setShowHistory] = useState(false)
  const [selectedItemId, setSelectedItemId] = useState(null)
  const [backupMessage, setBackupMessage] = useState('')
  const [reportPhotos, setReportPhotos] = useState({})
  const [printSnapshot, setPrintSnapshot] = useState(null)
  const [printReady, setPrintReady] = useState(false)
  const reportPhotoUrls = useRef([])
  const initialDataRef = useRef(data)
  const { project, element, level, location, drawing, revision, inspector, date, contractor,
    engineer, reportDesign, selectedTemplateId, customTemplates, items } = data

  useEffect(() => () => reportPhotoUrls.current.forEach(revokePhotoUrl), [])

  useEffect(() => {
    if (!printReady) return undefined
    let active = true
    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(async () => {
        const images = [...document.querySelectorAll('.print-report img')]
        await Promise.all(images.map(image => {
          if (image.complete) return Promise.resolve()
          return new Promise(resolve => {
            image.addEventListener('load', resolve, { once: true })
            image.addEventListener('error', resolve, { once: true })
          })
        }))
        if (active) window.print()
      })
    })
    const finishPrint = () => {
      setPrintReady(false)
      setPrintSnapshot(null)
      reportPhotoUrls.current.forEach(revokePhotoUrl)
      reportPhotoUrls.current = []
      setReportPhotos({})
    }
    window.addEventListener('afterprint', finishPrint)
    return () => {
      active = false
      cancelAnimationFrame(frame)
      window.removeEventListener('afterprint', finishPrint)
    }
  }, [printReady])

  async function exportBackup() {
    try {
      setBackupMessage('Preparing local backup…')
      const bundle = await createBackup(data)
      const url = URL.createObjectURL(new Blob([JSON.stringify(bundle)], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url
      link.download = `concretecheck-backup-${localDate()}.ccbackup`
      link.click()
      URL.revokeObjectURL(url)
      setBackupMessage(`Backup ready · ${bundle.manifest.photoCount} photos included`)
    } catch (error) { setBackupMessage(`Backup failed: ${error.message}`) }
  }
  async function restoreBackup(file) {
    if (!file) return
    let currentRaw = null
    try {
      const bundle = await parseBackup(file)
      const summary = `${bundle.data.items.length} active items, ${bundle.data.inspectionHistory?.length || 0} history records and ${bundle.photos.length} photos`
      if (!window.confirm(`Restore this ConcreteCheck backup?\n\n${summary}\n\nCurrent data will be replaced. A recovery copy will be preserved first.`)) return
      currentRaw = localStorage.getItem(STORAGE_KEY)
      if (currentRaw) saveRecoveryCopy(currentRaw)
      const restored = await importBackup(bundle)
      const serialized = JSON.stringify(restored)
      try {
        localStorage.setItem(STORAGE_KEY, serialized)
        if (JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')?.storageVersion !== STORAGE_VERSION) throw new Error('Restored data verification failed.')
      } catch (error) {
        if (currentRaw !== null) localStorage.setItem(STORAGE_KEY, currentRaw)
        throw error
      }
      setData(restored)
      setBackupMessage('Backup restored successfully. A recovery copy of the previous data was saved.')
    } catch (error) { setBackupMessage(`Restore failed: ${error.message}`) }
  }

  useEffect(() => {
    if (storageLoadWarning && data === initialDataRef.current) {
      return
    }
    if (storageLoadBlocked) {
      return
    }
    setSaveMessage('Saving…')
    let snapshotSaved = false
    const saveNow = () => {
      if (snapshotSaved) return true
      try {
        const backupRaw = unreadableStorageBackup || pendingMigrationBackup
        if (backupRaw) saveRecoveryCopy(backupRaw)
        const serialized = JSON.stringify({ ...data, storageVersion: STORAGE_VERSION })
        localStorage.setItem(STORAGE_KEY, serialized)
        const verified = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
        if (!verified || verified.storageVersion !== STORAGE_VERSION || !Array.isArray(verified.items)) throw new Error('Saved data verification failed.')
        unreadableStorageBackup = null
        pendingMigrationBackup = null
        snapshotSaved = true
        setSaveMessage(backupRaw ? 'Saved — recovery copy preserved' : 'Saved')
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
    openActions: items.reduce((total, item) => total + (item.actions || []).filter(action => action.status !== 'Completed').length, 0),
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
      && `${item.category} ${item.requirement} ${item.criteria} ${item.remarks} ${item.notes?.comments || ''} ${(item.actions || []).map(a => `${a.description} ${a.responsiblePerson}`).join(' ')} ${item.correctiveAction}`.toLowerCase().includes(searchText.toLowerCase()))
  const categoryGroups = useMemo(() => {
    const grouped = new Map()
    for (const item of filteredItems) {
      const label = item.category?.trim() || 'Uncategorized'
      const key = label.toLocaleLowerCase()
      if (!grouped.has(key)) grouped.set(key, { key, label, visibleItems: [] })
      grouped.get(key).visibleItems.push(item)
    }
    return [...grouped.values()].map(group => {
      const categoryItems = items.filter(item => (item.category?.trim() || 'Uncategorized').toLocaleLowerCase() === group.key)
      const reviewedCount = categoryItems.filter(item => ['OK', 'Not OK', 'N/A'].includes(item.status)).length
      return { ...group, total: categoryItems.length, reviewed: reviewedCount, progress: categoryItems.length ? Math.round(reviewedCount / categoryItems.length * 100) : 0 }
    })
  }, [filteredItems, items])
  const focusedIndex = items.findIndex(item => item.id === selectedItemId)
  const focusedItem = focusedIndex >= 0 ? { ...items[focusedIndex], originalIndex: focusedIndex } : null
  const templateOptions = [
    ...ELEMENTS.flatMap(el => LEVELS.map(l => ({ id: keyOf(el, l), label: `${el} — ${l}` }))),
    ...customTemplates.map(t => ({ id: t.id, label: `${t.name} — Custom` })),
  ]

  function persistCurrent(s) {
    const draftKey = inspectionDraftKey(s.inspectionInstanceId, s.selectedTemplateId)
    return { ...s, inspectionDrafts: { ...(s.inspectionDrafts || {}), [draftKey]: s.items } }
  }
  function field(name, value) { setData(s => ({ ...s, [name]: value })) }
  function chooseTemplate(id) {
    setData(s => {
      const saved = persistCurrent(s)
      const custom = saved.customTemplates.find(t => t.id === id)
      const draftKey = inspectionDraftKey(saved.inspectionInstanceId, id)
      const existingDraft = saved.inspectionDrafts?.[draftKey]
      if (custom) return {
        ...saved, element: custom.element, level: 'Custom', selectedTemplateId: id,
        items: existingDraft || saved.inspectionDrafts?.[id] || custom.items,
        inspectionDrafts: { ...(saved.inspectionDrafts || {}), [draftKey]: existingDraft || saved.inspectionDrafts?.[id] || custom.items },
      }
      const [el, lev] = id.split('-')
      const items = existingDraft || makeItems(el, lev)
      return { ...saved, element: el, level: lev, selectedTemplateId: id,
        inspectionDrafts: { ...(saved.inspectionDrafts || {}), [draftKey]: items }, items }
    })
  }
  function editItem(id, prop, value) {
    setData(s => persistCurrent({ ...s, items: s.items.map(x => {
      if (x.id !== id) return x
      if (prop === 'remarks') return { ...x, remarks: value, notes: { ...(x.notes || {}), observations: value } }
      if (prop === 'correctiveAction') {
        const actions = [...(x.actions || [])]
        if (actions.length) actions[0] = { ...actions[0], description: value }
        else if (value.trim()) actions.push({ id: createId('action'), description: value, responsiblePerson: '', dueDate: '', status: 'Open' })
        return { ...x, correctiveAction: value, actions }
      }
      return { ...x, [prop]: value }
    }) }))
  }
  function editSubCheck(itemId, subCheckId, checked) {
    setData(s => persistCurrent({ ...s, items: s.items.map(item => item.id === itemId
      ? { ...item, subChecks: (item.subChecks || []).map(check => check.id === subCheckId ? { ...check, checked } : check) }
      : item) }))
  }
  function editNotes(id, key, value) {
    setData(s => persistCurrent({ ...s, items: s.items.map(x => x.id === id ? { ...x, notes: { ...(x.notes || {}), [key]: value }, ...(key === 'observations' ? { remarks: value } : {}) } : x) }))
  }
  function addAction(id) {
    setData(s => persistCurrent({ ...s, items: s.items.map(x => x.id === id ? { ...x, actions: [...(x.actions || []), { id: createId('action'), description: '', responsiblePerson: '', dueDate: '', status: 'Open' }] } : x) }))
  }
  function editAction(itemId, actionId, key, value) {
    setData(s => persistCurrent({ ...s, items: s.items.map(x => x.id === itemId ? { ...x, actions: (x.actions || []).map(a => a.id === actionId ? { ...a, [key]: value } : a), ...(actionId === x.actions?.[0]?.id && key === 'description' ? { correctiveAction: value } : {}) } : x) }))
  }
  function removeAction(itemId, actionId) {
    setData(s => persistCurrent({ ...s, items: s.items.map(x => x.id === itemId ? { ...x, actions: (x.actions || []).filter(a => a.id !== actionId), correctiveAction: x.actions?.[0]?.id === actionId ? (x.actions?.[1]?.description || '') : x.correctiveAction } : x) }))
  }
  async function addEvidence(itemId, file, evidenceType = 'General Inspection') {
    try {
      setSaveMessage('Saving evidence…')
      const photo = await preparePhoto(file, { inspectionInstanceId: data.inspectionInstanceId, itemId, evidenceType })
      await putPhoto(photo)
      setData(s => persistCurrent({ ...s, items: s.items.map(item => item.id === itemId
        ? { ...item, mediaIds: [...new Set([...(item.mediaIds || []), photo.id])] }
        : item) }))
    } catch (error) { setSaveMessage(`Save Failed — photo was not attached: ${error.message}`); window.alert(`Could not add photo: ${error.message}`) }
  }
  async function removeEvidence(itemId, photoId) {
    if (!window.confirm('Remove this photo from the checklist item?')) return
    const item = data.items.find(x => x.id === itemId)
    const nextIds = (item?.mediaIds || []).filter(id => id !== photoId)
    editItem(itemId, 'mediaIds', nextIds)
    const references = collectMediaIds({ ...data, items: data.items.map(x => x.id === itemId ? { ...x, mediaIds: nextIds } : x) })
    if (!references.has(photoId)) { try { await deletePhoto(photoId) } catch (error) { setSaveMessage(`Save Failed — ${error.message}`) } }
  }
  function editEvidence(photoId, key, value) {
    getPhoto(photoId).then(photo => photo && putPhoto({ ...photo, [key]: value })).catch(error => setSaveMessage(`Save Failed — ${error.message}`))
  }
  function addItem() {
    setData(s => persistCurrent({ ...s, items: [...s.items, {
      ...normalizeItem({ id: createId('custom-item'), category: 'GENERAL', requirement: '', criteria: '', status: 'Pending' }),
    }] }))
  }
  function removeItem(id) {
    if (!window.confirm('Remove this checklist item?')) return
    setData(s => persistCurrent({ ...s, items: s.items.filter(x => x.id !== id) }))
  }
  function createTemplateFromSource(sourceItems, state, name) {
    const id = createId('custom')
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
    return archiveSnapshot({ ...s, inspectionInstanceId }, record)
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
        : makeItems(s.element, s.level)
      const reset = cleanTemplateItems(fresh, s.element, `${s.selectedTemplateId}-inspection-${Date.now()}`)
      const nextDraftKey = inspectionDraftKey(nextInspectionInstanceId, s.selectedTemplateId)
      return { ...archived, inspectionInstanceId: nextInspectionInstanceId, date: localDate(), items: reset,
        inspectionDrafts: { ...(archived.inspectionDrafts || {}), [nextDraftKey]: reset } }
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
      const restored = makeRestoredInspection(record, normalizeItems)
      const drafts = { ...(s.inspectionDrafts || {}),
        [inspectionDraftKey(restored.inspectionInstanceId, selectedTemplateId)]: restored.items }
      if (safeLevel === 'Custom') drafts[selectedTemplateId] = restored.items
      return { ...s, project: record.project || '', element: safeElement, level: safeLevel,
        location: record.location || '', drawing: record.drawing || '', revision: record.revision || '',
        inspector: record.inspector || '', date: record.date || localDate(), contractor: record.contractor || '',
        engineer: record.engineer || '', reportDesign: DESIGNS.includes(record.reportDesign) ? record.reportDesign : 'Professional',
        inspectionInstanceId: restored.inspectionInstanceId,
        selectedTemplateId, customTemplates: customTemplatesNext, inspectionDrafts: drafts,
        items: restored.items }
    })
    setShowHistory(false)
  }
  function updateCustomTemplate() {
    if (level !== 'Custom') return
    if (!window.confirm('Update this custom template with the current checklist wording? Statuses, remarks and corrective actions will not be saved.')) return
    setData(s => {
      const templateItems = cleanTemplateItems(s.items, s.element, s.selectedTemplateId)
      return { ...s,
        customTemplates: s.customTemplates.map(t => t.id === s.selectedTemplateId ? { ...t, element: s.element, items: templateItems } : t),
        inspectionDrafts: { ...(s.inspectionDrafts || {}), [s.selectedTemplateId]: s.items },
      }
    })
  }
  async function printReport() {
    const snapshot = data
    try {
      const itemPhotoIds = [...new Set(snapshot.items.flatMap(item => item.mediaIds || []))]
      const photos = await getPhotos(itemPhotoIds)
      reportPhotoUrls.current.forEach(revokePhotoUrl)
      const mapped = Object.fromEntries(photos.map(photo => [photo.id, {
        ...photo,
        printUrl: createPhotoUrl(photo.printBlob || photo.originalBlob),
      }]))
      reportPhotoUrls.current = Object.values(mapped).map(photo => photo.printUrl)
      setPrintSnapshot(snapshot)
      setReportPhotos(mapped)
      setPrintReady(true)
    } catch (error) {
      setBackupMessage(`Some evidence could not be prepared for printing: ${error.message}`)
      setPrintSnapshot(snapshot)
      setReportPhotos({})
      setPrintReady(true)
    }
  }

  const reportData = printSnapshot || data
  const reportItems = reportData.items
  const reportCounts = {
    ok: reportItems.filter(item => item.status === 'OK').length,
    failed: reportItems.filter(item => item.status === 'Not OK').length,
    pending: reportItems.filter(item => item.status === 'Pending').length,
    na: reportItems.filter(item => item.status === 'N/A').length,
  }
  const reportProgress = reportItems.length
    ? Math.round((reportCounts.ok + reportCounts.failed + reportCounts.na) / reportItems.length * 100)
    : 0
  const reportChecklistGroups = reportItems.reduce((groups, item, index) => {
    const category = String(item.category || 'GENERAL').toUpperCase()
    let group = groups[groups.length - 1]
    if (!group || group.category !== category) {
      group = { category, items: [] }
      groups.push(group)
    }
    group.items.push({ item, index })
    return groups
  }, [])
  const reportEvidenceItems = reportItems.map((item, index) => {
    const observation = String(item.notes?.observations || item.remarks || '').trim()
    const comments = String(item.notes?.comments || '').trim()
    const actions = (item.actions || []).filter(action => [action.description, action.responsiblePerson, action.dueDate].some(value => String(value || '').trim()))
    const legacyAction = !actions.length ? String(item.correctiveAction || '').trim() : ''
    const photoIds = item.mediaIds || []
    return { item, index, observation, comments, actions, legacyAction, photoIds }
  }).filter(entry => entry.observation || entry.comments || entry.actions.length || entry.legacyAction || entry.photoIds.length)
  const reportChecklistNumber = 3
  const reportEvidenceNumber = reportChecklistNumber + 1
  const reportSignoffNumber = reportEvidenceNumber + 1
  const reportElement = reportData.element
  const reportLayout = reportData.reportDesign
  const reportTemplateName = reportData.level === 'Custom'
    ? reportData.customTemplates.find(template => template.id === reportData.selectedTemplateId)?.name || 'Custom template'
    : `${reportElement} ${reportData.level}`
  const reportDateText = reportData.date ? new Date(`${reportData.date}T00:00:00`).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  }) : 'Not specified'

  return <>
    <div className="screen-only">
      <div className="app-shell">
        <header className="topbar">
          <div className="brand"><div className="brand-icon" role="img" aria-label="ConcreteCheck structural concrete block with verification checkmark"><svg viewBox="0 0 48 48" focusable="false" aria-hidden="true"><path className="logo-structure" d="M6 12 24 5l18 7v23l-18 8-18-8V12Z" /><path className="logo-face" d="m6 12 18 8 18-8M24 20v23" /><path className="logo-check" d="m15 26 6 6 13-14" /></svg></div><div className="brand-copy"><strong>ConcreteCheck</strong><span>Concrete Pre-Pour Inspection</span></div></div>
          <div className="topbar-actions"><span className="draft-label">{saveMessage}</span><button className="primary-button" onClick={printReport}>Export report</button></div>
        </header>
        <main className="main-content">
          <section className="current-project-summary" aria-labelledby="current-project-heading">
            <div className="project-summary-copy"><span className="summary-kicker">CURRENT PROJECT</span><h1 id="current-project-heading">{project.trim() || 'Project details not entered'}</h1><p>{project.trim() ? `${element} inspection · ${dateText}` : 'Add project details before recording this inspection.'}</p></div>
            <button type="button" className="setup-shortcut" onClick={() => { setShowProjectDetails(true); document.getElementById('project-setup-area')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }}>{project.trim() ? 'Edit project details' : 'Enter project details'}</button>
            <dl className="project-summary-facts"><div><dt>Structural element</dt><dd>{element}</dd></div><div><dt>Location / Grid</dt><dd>{location.trim() || 'Not specified'}</dd></div><div><dt>Inspection date</dt><dd>{dateText}</dd></div>{drawing.trim() && <div><dt>Drawing</dt><dd>{drawing}{revision.trim() ? ` · ${revision}` : ''}</dd></div>}{inspector.trim() && <div><dt>Inspector</dt><dd>{inspector}</dd></div>}</dl>
          </section>

          <section className="inspection-overview" aria-label="Inspection overview">
            <div className="inspection-overview-main"><div className="inspection-progress-block"><div className="inspection-progress-heading"><div><span className="summary-kicker">INSPECTION OVERVIEW</span><h2>Inspection progress</h2></div><strong>{progress}%</strong></div><div className="overview-progress-track" role="progressbar" aria-label="Inspection progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow={progress}><span style={{ width: `${progress}%` }} /></div><p>{reviewed} of {items.length} items reviewed <span>·</span> {counts.openActions} open corrective actions</p></div>
              <div className="overview-counts" aria-label="Inspection status counts"><div><strong>{items.length}</strong><span>Total</span></div><div className="overview-count-ok"><strong>{counts.ok}</strong><span>OK</span></div><div className="overview-count-failed"><strong>{counts.failed}</strong><span>Not OK</span></div><div className="overview-count-pending"><strong>{counts.pending}</strong><span>Pending</span></div><div><strong>{counts.na}</strong><span>N/A</span></div><div className="overview-count-actions"><strong>{counts.openActions}</strong><span>Open actions</span></div></div>
            </div>
            <div className={`needs-attention${counts.failed ? '' : ' needs-attention-clear'}`}><div className="attention-heading"><h3>Needs attention</h3><span>{counts.failed ? `${counts.failed} item${counts.failed === 1 ? '' : 's'}` : 'Clear'}</span></div>{counts.failed ? <div className="attention-items">{items.map((item, index) => item.status === 'Not OK' ? <button type="button" key={item.id} onClick={() => { if (isMobileLayout) setSelectedItemId(item.id); else document.getElementById(`checklist-item-${item.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }}><span>{String(index + 1).padStart(2, '0')}</span><span className="attention-item-copy"><strong>{item.requirement || 'Untitled inspection item'}</strong><small>{(item.actions || []).filter(action => action.status !== 'Completed').length} corrective actions open · review status and evidence</small></span><b>Review →</b></button> : null)}</div> : <p>No items are currently marked Not OK.</p>}</div>
          </section>

          <section className="project-setup-area" id="project-setup-area"><h2 className="mobile-area-title">Project &amp; Setup</h2>
          <section className="panel">
            <div className="section-heading"><div><h2>Project information</h2><p>{project.trim() ? `${element} · ${location.trim() || 'Location not specified'} · ${dateText}` : 'Project details are missing. Enter them before recording the inspection.'}</p></div><button className="section-toggle" type="button" aria-expanded={showProjectDetails} aria-controls="project-information-fields" onClick={() => setShowProjectDetails(value => !value)}>{showProjectDetails ? 'Hide details' : project.trim() ? 'Edit details' : 'Enter project details'}</button></div>
            <div className="form-grid" id="project-information-fields" hidden={!showProjectDetails}>
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
            <div className="section-heading"><div><h2>Checklist template</h2><p>Choose a template, then tailor its items for this inspection.</p></div><button className="section-toggle" type="button" aria-expanded={showTemplateSettings} aria-controls="template-settings" onClick={() => setShowTemplateSettings(value => !value)}>{showTemplateSettings ? 'Hide settings' : 'Show settings'}</button></div>
            <div id="template-settings" hidden={!showTemplateSettings}>
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
            </div>
          </section>
          </section>

          <section className="panel checklist-panel" id="checklist-workspace">
            <div className="section-heading checklist-heading"><div><span className="summary-kicker">MAIN INSPECTION CHECKLIST</span><h2>{element} inspection checklist</h2><p>{activeTemplateName} · Showing {filteredItems.length} of {items.length} items</p></div><div className="inline-actions"><button className="primary-button add-item-action" onClick={addItem}>+ Add item</button><button className="secondary-button archive-action" onClick={archiveInspection}>Archive inspection</button><button className="secondary-button new-inspection-action" onClick={startNewInspection}>Start new inspection</button></div></div>
            <div className="checklist-toolbar"><input value={searchText} onChange={e => setSearchText(e.target.value)} placeholder="Search checklist items" /><select aria-label="Filter checklist by status" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>{FILTER_OPTIONS.map(filter => <option key={filter} value={filter}>{filter}</option>)}</select><label className="checkbox-label"><input type="checkbox" checked={showCriteria} onChange={e => setShowCriteria(e.target.checked)} /> Show acceptance criteria</label></div>
            <div className="checklist-table">
              <div className="table-header"><span>Inspection item</span><span>Status</span><span>Remarks and action</span><span>Remove</span></div>
              {items.length === 0 && <div className="empty-checklist">No checklist items. Select Add item to begin.</div>}
              {items.length > 0 && filteredItems.length === 0 && <div className="empty-checklist">No checklist items match the current search or status filter.</div>}
              {categoryGroups.map(group => <section className="category-group" key={group.key}>
                <header className="category-group-heading"><div><h3>{group.label}</h3><p>{group.reviewed} of {group.total} reviewed · {group.visibleItems.length} shown</p></div><strong>{group.progress}%</strong><div className="category-progress"><span style={{ width: group.progress + '%' }} /></div></header>
                <div className="category-group-items">{group.visibleItems.map(item => <div className="category-item-pair" id={`checklist-item-${item.id}`} key={item.id}>
                  <div className="desktop-checklist-item"><ChecklistItemCard
                    key={item.id} item={item} number={item.originalIndex + 1} showCriteria={showCriteria}
                    onItemChange={(prop, value) => editItem(item.id, prop, value)}
                    onSubCheckChange={(subCheckId, checked) => editSubCheck(item.id, subCheckId, checked)}
                    onNotesChange={(key, value) => editNotes(item.id, key, value)}
                    onAddAction={() => addAction(item.id)}
                    onEditAction={(actionId, key, value) => editAction(item.id, actionId, key, value)}
                    onRemoveAction={actionId => removeAction(item.id, actionId)}
                    onAddEvidence={file => addEvidence(item.id, file)}
                    onRemoveEvidence={photoId => removeEvidence(item.id, photoId)}
                    onEditEvidence={editEvidence} onRemove={() => removeItem(item.id)}
                  /></div>
                  <MobileChecklistItem item={item} number={item.originalIndex + 1} showCriteria={showCriteria} onShowCriteria={() => setShowCriteria(true)} onStatusChange={status => editItem(item.id, 'status', status)} onSubCheckChange={(subCheckId, checked) => editSubCheck(item.id, subCheckId, checked)} onOpen={() => setSelectedItemId(item.id)} />
                </div>)}</div>
              </section>)}

            </div>
          </section>

          <section className="panel notice-panel"><strong>Before concrete placement</strong><p>Resolve and re-inspect items marked Not OK. Confirm pending items and required approvals with the responsible engineer before pouring. Use the latest approved drawings and project specifications as the acceptance reference.</p></section>
          <section className="tools-area"><h2 className="mobile-area-title">History &amp; Tools</h2>
            <div className="mobile-history-tools"><button className="secondary-button" type="button" aria-expanded={showHistory} onClick={() => setShowHistory(value => !value)}>Inspection History ({data.inspectionHistory.length})</button>{showHistory && <div className="history-panel">{data.inspectionHistory.length === 0 ? <p>No archived inspections yet.</p> : data.inspectionHistory.map((record, historyIndex) => <div className="history-entry" key={record.id + '-' + historyIndex}><span><strong>{record.project || 'Untitled project'}</strong> · {record.element} · {record.templateName} · {record.date || 'No date'}</span><button className="secondary-button" onClick={() => restoreInspection(record, historyIndex)}>Restore</button><button className="danger-button" onClick={() => removeInspection(record, historyIndex)}>Remove</button></div>)}</div>}</div>
            <section className="panel backup-panel"><div className="section-heading"><div><h2>Reports and backup</h2><p>Backups stay on this device until you download and store them elsewhere.</p></div></div><div className="backup-controls"><button className="secondary-button" type="button" onClick={exportBackup}>Download full backup</button><label className="secondary-button file-button">Restore backup<input type="file" accept=".ccbackup,application/json" onChange={e => restoreBackup(e.target.files?.[0])} /></label><span className="backup-message" role="status">{backupMessage}</span></div></section>
            <div className="bottom-actions"><button className="primary-button" onClick={printReport}>Export / Print inspection report</button></div>
          </section>
          {isMobileLayout && focusedItem ? (<section className="mobile-inspection-focus" role="dialog" aria-modal="true" aria-labelledby="focused-item-title"><div className="focus-topbar"><button type="button" className="focus-back" onClick={() => setSelectedItemId(null)}>← Checklist</button><span>Item {focusedIndex + 1} of {items.length}</span></div><div className="focus-navigation"><button type="button" disabled={focusedIndex <= 0} onClick={() => setSelectedItemId(items[focusedIndex - 1]?.id)}>← Previous item</button><button type="button" disabled={focusedIndex >= items.length - 1} onClick={() => setSelectedItemId(items[focusedIndex + 1]?.id)}>Next item →</button></div><h2 id="focused-item-title">Full inspection</h2>{!showCriteria && <button type="button" className="focus-show-criteria" onClick={() => setShowCriteria(true)}>Show acceptance criteria</button>}<ChecklistItemCard key={focusedItem.id} item={focusedItem} number={focusedIndex + 1} showCriteria={showCriteria} onItemChange={(prop, value) => editItem(focusedItem.id, prop, value)} onSubCheckChange={(subCheckId, checked) => editSubCheck(focusedItem.id, subCheckId, checked)} onNotesChange={(key, value) => editNotes(focusedItem.id, key, value)} onAddAction={() => addAction(focusedItem.id)} onEditAction={(actionId, key, value) => editAction(focusedItem.id, actionId, key, value)} onRemoveAction={actionId => removeAction(focusedItem.id, actionId)} onAddEvidence={file => addEvidence(focusedItem.id, file)} onRemoveEvidence={photoId => removeEvidence(focusedItem.id, photoId)} onEditEvidence={editEvidence} onRemove={() => removeItem(focusedItem.id)} /></section>) : null}
        </main>
        <footer className="app-footer">ConcreteCheck · A practical pre-pour inspection record</footer>
      </div>
    </div>

    <article className={`print-report print-${reportLayout.toLowerCase()}`}>
      <header className="print-header"><div className="print-brand">CONCRETECHECK</div><div className="print-document-label">INSPECTION RECORD</div><h1>CONCRETE PRE-POUR INSPECTION REPORT</h1><p>Pre-pour inspection and approval record</p></header>

      <section className="print-section"><h2>1. PROJECT INFORMATION</h2><table className="print-info-table"><tbody>
        <tr><th>Project name</th><td>{reportData.project || 'Not specified'}</td><th>Structural element</th><td>{reportElement}</td></tr>
        <tr><th>Location / Grid</th><td>{reportData.location || 'Not specified'}</td><th>Inspection date</th><td>{reportDateText}</td></tr>
        <tr><th>Drawing number</th><td>{reportData.drawing || 'Not specified'}</td><th>Drawing revision</th><td>{reportData.revision || 'Not specified'}</td></tr>
        <tr><th>Checklist template</th><td>{reportTemplateName}</td><th>Report design</th><td>{reportLayout}</td></tr>
        <tr><th>Inspector</th><td colSpan="3">{reportData.inspector || 'Not specified'}</td></tr>
      </tbody></table></section>

      <section className="print-section"><h2>2. INSPECTION SUMMARY</h2><table className="print-summary-table"><thead><tr><th>Total items</th><th>OK</th><th>Not OK</th><th>Pending</th><th>N/A</th><th>Progress</th></tr></thead><tbody><tr><td>{reportItems.length}</td><td>{reportCounts.ok}</td><td>{reportCounts.failed}</td><td>{reportCounts.pending}</td><td>{reportCounts.na}</td><td>{reportProgress}%</td></tr></tbody></table></section>

      <section className="print-section print-checklist-section"><h2>{reportChecklistNumber}. {reportElement.toUpperCase()} INSPECTION CHECKLIST</h2><table className="print-checklist-table"><thead><tr>
        <th className="print-no">No.</th><th>Inspection requirement</th><th className="print-status">Status</th>
      </tr></thead><tbody>
        {reportChecklistGroups.map(group => <Fragment key={`group-${group.category}-${group.items[0]?.index}`}>
          <tr className="print-category-heading" key={`category-${group.category}-${group.items[0]?.index}`}><th colSpan="3" scope="rowgroup">{group.category}</th></tr>
          {group.items.map(({ item, index }) => <tr className={`print-checklist-item print-checklist-item-${String(item.status || 'Pending').toLowerCase().replace(' ', '-')}`} key={item.id}>
            <td className="print-no">{String(index + 1).padStart(2, '0')}</td>
            <td className="print-requirement-cell">
              <strong>{item.requirement || 'Not specified'}</strong>
              {item.criteria && <div className="print-criteria">{item.criteria}</div>}
              {item.subChecks?.length > 0 && <ul className="print-subchecks">{item.subChecks.map(check => <li key={check.id}><span className={`print-subcheck-mark${check.checked ? ' is-checked' : ''}`}>{check.checked ? '✓' : ''}</span>{check.label}</li>)}</ul>}
            </td>
            <td className={`print-status print-status-${String(item.status || 'Pending').toLowerCase().replace(' ', '-')}`}>{item.status || 'Pending'}</td>
          </tr>)}
        </Fragment>)}
      </tbody></table></section>

      <section className="print-section print-evidence-section"><h2>{reportEvidenceNumber}. PHOTO EVIDENCE REGISTER</h2>{reportEvidenceItems.length > 0 ? <div className="print-evidence-register">
        {reportEvidenceItems.map(({ item, index, observation, comments, actions, legacyAction, photoIds }) => <article className="print-evidence-entry" key={`evidence-${item.id}`}>
          <header className="print-evidence-reference"><div><strong>ITEM {String(index + 1).padStart(2, '0')}</strong><span>{item.category || 'GENERAL'}</span></div><p>{item.requirement || 'Not specified'}</p></header>
          {photoIds.length > 0 && <div className="print-photo-grid">
            {photoIds.map(id => {
              const photo = reportPhotos[id]
              const evidenceType = photo?.evidenceType
              return <figure className="print-photo" key={id}>
                {photo ? <img src={photo.printUrl} alt={photo.caption || 'Inspection evidence'} onError={event => {
                  event.currentTarget.hidden = true
                  event.currentTarget.parentElement.querySelector('.print-photo-unavailable')?.removeAttribute('hidden')
                }} /> : <span className="print-photo-unavailable">Photo unavailable</span>}
                {photo && <figcaption>{photo.caption || 'Inspection evidence'}{(evidenceType === 'Before' || evidenceType === 'After') && <span className="print-photo-type">{evidenceType}</span>}</figcaption>}
                {photo && <small className="print-photo-unavailable" hidden>Photo unavailable</small>}
              </figure>
            })}
          </div>}
          {(observation || comments || actions.length > 0 || legacyAction) && <div className="print-evidence-copy">
            {observation && <p className="print-observation"><strong>Observation:</strong> {observation}</p>}
            {comments && <p className="print-observation print-observation-comment"><strong>Comment:</strong> {comments}</p>}
            {actions.map((action, actionIndex) => <p className="print-corrective-action" key={action.id || `${item.id}-action-${actionIndex}`}><strong>Corrective Action{action.status ? ` (${action.status})` : ''}:</strong> {action.description || '—'}{action.responsiblePerson ? ` · Responsible: ${action.responsiblePerson}` : ''}{action.dueDate ? ` · Due: ${action.dueDate}` : ''}</p>)}
            {legacyAction && <p className="print-corrective-action"><strong>Corrective Action:</strong> {legacyAction}</p>}
          </div>}
        </article>)}
      </div> : <p className="print-evidence-empty">No photo evidence, observations, comments or corrective actions recorded.</p>}</section>

      <section className="print-section print-signoff-section">
        <section className="print-note"><strong>Inspection note</strong><p>Verify all requirements against the latest approved drawings, project specifications and applicable inspection criteria. This checklist is a recording tool and does not replace project-specific technical approval.</p></section>
        <h2>{reportSignoffNumber}. INSPECTION SIGN-OFF</h2><table className="print-sign-table"><thead><tr><th>Inspector</th><th>Contractor representative</th><th>Engineer</th></tr></thead><tbody>
        <tr><td>{reportData.inspector || ' '}</td><td>{reportData.contractor || ' '}</td><td>{reportData.engineer || ' '}</td></tr>
        <tr><td>Signature: __________________</td><td>Signature: __________________</td><td>Signature: __________________</td></tr>
        <tr><td>Date: _______________________</td><td>Date: _______________________</td><td>Date: _______________________</td></tr>
      </tbody></table></section>

      <footer className="print-footer">ConcreteCheck · Concrete Pre-Pour Inspection Report</footer>
    </article>
  </>
}
