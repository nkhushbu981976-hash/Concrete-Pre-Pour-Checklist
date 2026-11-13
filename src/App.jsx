import { Fragment, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createId } from './utils/ids.js'
import { STORAGE_VERSION, normalizeItem, normalizeItems as normalizeSchemaItems, cleanTemplateItems as cleanSchemaTemplateItems, migrateInspectionData, collectMediaIds } from './storage/schema.js'
import { preparePhoto, putPhoto, getPhoto, getPhotos, deletePhoto, createPhotoUrl, revokePhotoUrl } from './storage/mediaDb.js'
import { archiveSnapshot, makeRestoredInspection } from './storage/history.js'
import ChecklistItemCard, { SubCheckList } from './components/ChecklistItemCard.jsx'
import { createBackup, parseBackup, importBackup } from './storage/backup.js'
import { getReferencePdf, removeReferencePdf, saveReferencePdf } from './storage/referencePdfDb.js'
import { LANGUAGE_KEY, localizeItem, translate, translateMessage, translateConfirm } from './i18n.js'
import JapaneseReadingText from './components/JapaneseReadingText.jsx'
import slabSamplePhotoUrl from './assets/sample-inspections/slab-pre-pour.jpg'
import slabRebarMeshPhotoUrl from './assets/sample-inspections/slab-rebar-mesh.jpg'
import slabPourSupportPhotoUrl from './assets/sample-inspections/slab-pour-support.jpg'
import beamSamplePhotoUrl from './assets/sample-inspections/beam-joint-reinforcement.jpg'
import beamJointTieTeamPhotoUrl from './assets/sample-inspections/beam-joint-tie-team.jpg'
import beamStirrupTyingPhotoUrl from './assets/sample-inspections/beam-stirrup-tying.jpg'
import beamCageTiePhotoUrl from './assets/sample-inspections/beam-cage-tie-detail.jpg'
import beamRebarSpecificPhotoUrl from './assets/sample-inspections/beam-rebar-specific.jpg'
import columnSamplePhotoUrl from './assets/sample-inspections/column-reinforcement.jpg'
import columnRebarWorkerPhotoUrl from './assets/sample-inspections/column-rebar-worker.jpg'
import columnStarterBarsPhotoUrl from './assets/sample-inspections/column-starter-bars.jpg'
import columnCageContextPhotoUrl from './assets/sample-inspections/column-cage-context.jpg'
import footingSamplePhotoUrl from './assets/sample-inspections/footing-reinforcement.jpg'
import footingBaseMeshPhotoUrl from './assets/sample-inspections/footing-base-mesh.jpg'
import footingStarterCagePhotoUrl from './assets/sample-inspections/footing-starter-cage.jpg'
import footingFoundationOverviewPhotoUrl from './assets/sample-inspections/footing-foundation-overview.jpg'
import footingExcavationContextPhotoUrl from './assets/sample-inspections/footing-excavation-context.jpg'
import footingFormworkDetailPhotoUrl from './assets/sample-inspections/footing-formwork-detail.jpg'

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

function MobileChecklistItem({ item, number, showCriteria, language = 'en', showAllReadings = false, canReorder = false, canMoveUp = false, canMoveDown = false, onMoveUp, onMoveDown, onShowCriteria, onStatusChange, onSubCheckChange, onOpen }) {
  const tr = value => translate(value, language)
  const text = value => <JapaneseReadingText language={language} showAll={showAllReadings}>{value}</JapaneseReadingText>
  const notesCount = [item.notes?.observations || item.remarks, item.notes?.comments].filter(value => String(value || '').trim()).length
  const photos = (item.mediaIds || []).length
  const actions = item.actions || []
  const openActions = actions.filter(action => action.status !== 'Completed').length
  return <article className={`mobile-item-preview mobile-status-${item.status.toLowerCase().replace(' ', '-')}`}>
    <div className="mobile-item-preview-top"><span className="mobile-item-number">{tr('ITEM')} {String(number).padStart(2, '0')}</span>{canReorder && <div className="mobile-item-order-controls"><button type="button" disabled={!canMoveUp} aria-label={tr('Move item up')} onClick={onMoveUp}>↑</button><button type="button" disabled={!canMoveDown} aria-label={tr('Move item down')} onClick={onMoveDown}>↓</button></div>}</div>
    <h3>{text(item.requirement?.trim() || tr('Untitled inspection item'))}</h3>
    <div className="mobile-item-criteria"><strong>{text(tr('Acceptance criteria'))}</strong>{showCriteria ? <p>{text(item.criteria?.trim() || tr('No acceptance criteria entered.'))}</p> : <p className="criteria-hidden">{text(tr('Hidden ·'))} <button type="button" onClick={onShowCriteria}>{text(tr('Show criteria'))}</button></p>}</div>
    <SubCheckList subChecks={item.subChecks || []} onChange={onSubCheckChange} compact status={item.status} language={language} showAllReadings={showAllReadings} />
    <div className="mobile-item-counts"><span>{notesCount} {text(tr('notes'))}</span><span>{photos} {text(tr('photos'))}</span><span>{actions.length} {text(tr('actions'))} · {openActions} {text(tr('Open'))}</span></div>
    <div className="mobile-status-control" role="group" aria-label={`${tr('Set status for item')} ${number}`}>{STATUSES.map(status => <button type="button" key={status} className={`status-choice status-choice-${status.toLowerCase().replace(' ', '-')} ${item.status === status ? 'is-selected' : ''}`} aria-pressed={item.status === status} onClick={() => onStatusChange(status)}>{tr(status)}</button>)}</div>
    <button type="button" className="mobile-open-item" onClick={onOpen}>{tr('Open full inspection')} <span aria-hidden="true">→</span></button>
  </article>
}
let pendingMigrationBackup = null

function withTimeout(promise, timeoutMs, message) {
  let timeoutId
  return Promise.race([
    promise,
    new Promise((_, reject) => { timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs) }),
  ]).finally(() => window.clearTimeout(timeoutId))
}

function preloadPrintImage(source, timeoutMs = 10000) {
  return new Promise(resolve => {
    const image = new Image()
    let finished = false
    const finish = loaded => {
      if (finished) return
      finished = true
      window.clearTimeout(timeoutId)
      image.onload = null
      image.onerror = null
      resolve(loaded)
    }
    const timeoutId = window.setTimeout(() => finish(false), timeoutMs)
    image.onload = () => finish(true)
    image.onerror = () => finish(false)
    image.src = source
    if (image.complete) finish(image.naturalWidth > 0)
  })
}

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

function StructuralIcon({ element }) {
  return <svg className="structure-icon" viewBox="0 0 72 56" aria-hidden="true" focusable="false">
    {element === 'Slab' && <><path d="m8 19 28-11 28 11-28 11L8 19Z" /><path d="m8 19 28 11 28-11v8L36 39 8 27v-8Zm12 12v8m16-2v8m16-14v8" /></>}
    {element === 'Beam' && <><path d="M7 14h58v12H7zM15 26v19m42-19v19M9 45h54M17 14v12m13-12v12m13-12v12m13-12v12" /></>}
    {element === 'Column' && <><path d="M25 7h22v38H25zM20 7h32v7H20zM20 45h32v6H20zM13 51h46" /><path d="M30 19h12m-12 8h12m-12 8h12" /></>}
    {element === 'Footing' && <><path d="M12 35h48v12H12zM25 11h22v24H25zM7 47h58" /><path d="M18 39v8m12-8v8m12-8v8m12-8v8" /></>}
  </svg>
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
      ['PLACEMENT READINESS','Concrete placement and testing ready','Confirm approved mix, sampling arrangements, placing and vibration access, weather precautions and site safety.', ['Approved mix and delivery requirements confirmed','Sampling and testing arrangements ready','Placement access, weather and site safety checked']],
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
      ['PLACEMENT READINESS','Concrete placement and testing ready','Confirm approved mix, sampling arrangements, placing access, weather precautions and site safety.', ['Approved mix and delivery requirements confirmed','Sampling and testing arrangements ready','Placement access, weather and site safety checked']],
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
      ['PLACEMENT READINESS','Concrete placement and testing ready','Confirm approved mix, sampling arrangements, placing access, weather precautions and site safety.', ['Approved mix and delivery requirements confirmed','Sampling and testing arrangements ready','Placement access, weather and site safety checked']],
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
const SAMPLE_PHOTOS = {
  'sample-slab-formwork': { id: 'sample-slab-formwork', caption: 'Slab formwork and reinforcement at the pour edge', dataUrl: slabSamplePhotoUrl },
  'sample-slab-mesh-overview': { id: 'sample-slab-mesh-overview', caption: 'Slab reinforcement mesh and spacer arrangement', dataUrl: slabRebarMeshPhotoUrl },
  'sample-slab-support-detail': { id: 'sample-slab-support-detail', caption: 'Reinforcement support and placing access detail', dataUrl: slabPourSupportPhotoUrl },
  'sample-beam-cage-overview': { id: 'sample-beam-cage-overview', caption: 'Beam cage and beam-column joint reinforcement overview', dataUrl: beamSamplePhotoUrl },
  'sample-beam-stirrup-spacing': { id: 'sample-beam-stirrup-spacing', caption: 'Stirrup placement and spacing at the beam end zone', dataUrl: beamStirrupTyingPhotoUrl },
  'sample-beam-tie-detail': { id: 'sample-beam-tie-detail', caption: 'Rebar tie and cage restraint close-up', dataUrl: beamCageTiePhotoUrl },
  'sample-beam-joint-bars': { id: 'sample-beam-joint-bars', caption: 'Joint bar continuity and reinforcement congestion review', dataUrl: beamSamplePhotoUrl },
  'sample-beam-precast-cage': { id: 'sample-beam-precast-cage', caption: 'Precast beam reinforcement cage and stirrup arrangement', dataUrl: beamRebarSpecificPhotoUrl },
  'sample-beam-tying-workmanship': { id: 'sample-beam-tying-workmanship', caption: 'Reinforcement tie workmanship at mesh intersections', dataUrl: beamJointTieTeamPhotoUrl },
  'sample-column-grid-view': { id: 'sample-column-grid-view', caption: 'Column starter bars and foundation grid context', dataUrl: columnSamplePhotoUrl },
  'sample-column-cage-view': { id: 'sample-column-cage-view', caption: 'Column reinforcement cage before form closure', dataUrl: columnRebarWorkerPhotoUrl },
  'sample-column-starter-detail': { id: 'sample-column-starter-detail', caption: 'Starter-bar location and footing connection detail', dataUrl: columnStarterBarsPhotoUrl },
  'sample-column-structure-context': { id: 'sample-column-structure-context', caption: 'Column reinforcement and surrounding structural frame', dataUrl: columnCageContextPhotoUrl },
  'sample-footing-setting-out': { id: 'sample-footing-setting-out', caption: 'Footing excavation, form line and reinforcement reference', dataUrl: footingSamplePhotoUrl },
  'sample-footing-mesh': { id: 'sample-footing-mesh', caption: 'Footing base reinforcement mesh and bearing surface', dataUrl: footingBaseMeshPhotoUrl },
  'sample-footing-starter-cage': { id: 'sample-footing-starter-cage', caption: 'Footing starter cage and edge clearance detail', dataUrl: footingStarterCagePhotoUrl },
  'sample-footing-overview': { id: 'sample-footing-overview', caption: 'Foundation reinforcement and connection bars overview', dataUrl: footingFoundationOverviewPhotoUrl },
  'sample-footing-excavation': { id: 'sample-footing-excavation', caption: 'Excavation and founding surface before footing preparation', dataUrl: footingExcavationContextPhotoUrl },
  'sample-footing-formwork': { id: 'sample-footing-formwork', caption: 'Footing edge form and reinforcement layout before placement', dataUrl: footingFormworkDetailPhotoUrl },
}
function makeDemoSample({ id, element, level, itemIndices, name, description, project, location, drawing, revision, date, inspector, contractor, engineer, inspectionNote, sampleReportProfile, sampleReportTitle, sampleReportFocus, sampleEvidenceIntro, statuses, photosByItem, observations, actions }) {
  const templateItems = makeItems(element, level)
  const sampleItems = itemIndices ? itemIndices.map(index => templateItems[index]).filter(Boolean) : templateItems
  const items = sampleItems.map((item, index) => {
    const status = statuses[index] || 'Pending'
    const observation = observations[index] || ''
    const actionDescription = actions[index] || ''
    return {
      ...item,
      status,
      subChecks: item.subChecks.map((check, checkIndex) => ({ ...check, checked: status === 'OK' || (status === 'Not OK' && checkIndex !== 1) })),
      notes: { observations: observation, comments: '' },
      remarks: observation,
      actions: actionDescription ? [{ id: `demo-action-${id}-${index + 1}`, description: actionDescription, responsiblePerson: contractor, dueDate: localDate(), status: 'Open' }] : [],
      correctiveAction: actionDescription,
      mediaIds: photosByItem[index] || [],
    }
  })
  return {
    id, element, level, name, description,
    project, location, drawing, revision, inspector, contractor, engineer,
    date: date || localDate(), reportDesign: 'Professional', inspectionNote,
    sampleReportProfile, sampleReportTitle, sampleReportFocus, sampleEvidenceIntro,
    items,
    photos: Object.fromEntries(Object.entries(SAMPLE_PHOTOS).filter(([photoId]) => items.some(item => item.mediaIds.includes(photoId)))),
  }
}
const SAMPLE_INSPECTIONS = [
  makeDemoSample({
    id: 'sample-slab', element: 'Slab', level: 'Standard', name: 'Slab Pre-Pour Inspection', description: 'Six checks for a suspended slab, with an edge-bracing hold point and paired reinforcement evidence.',
    sampleReportProfile: 'slab', sampleReportTitle: 'SUSPENDED SLAB RELEASE CHECK', sampleReportFocus: 'Formwork · Reinforcement · Placement readiness', sampleEvidenceIntro: 'Paired reinforcement views are grouped beside the related checklist item for comparison.',
    project: 'DEMO ONLY — Riverside Apartments, Block B', location: 'DEMO ONLY — Grid C2–F5, Level 4', drawing: 'DEMO-STR-SLB-204', revision: '03', date: '2026-11-12',
    inspector: 'DEMO — Asha Gurung', contractor: 'DEMO — Pemba Rai', engineer: 'DEMO — S. Shrestha',
    inspectionNote: 'DEMO ONLY: Hold concrete placement until the edge-bracing correction is verified. Confirm the pending approval before release.',
    statuses: ['OK', 'Not OK', 'OK', 'OK', 'Pending', 'OK'],
    photosByItem: { 1: ['sample-slab-formwork'], 2: ['sample-slab-mesh-overview', 'sample-slab-support-detail'] },
    observations: { 1: 'DEMO ONLY: Edge bracing is incomplete at the east perimeter in this example.' },
    actions: { 1: 'DEMO ONLY: Install bracing to the approved detail and request re-inspection before placement.' },
  }),
  makeDemoSample({
    id: 'sample-beam', element: 'Beam', level: 'Detailed', name: 'Beam Pre-Pour Inspection', description: 'Eight detailed checks for beam end-zone reinforcement, joint coordination and pour release.',
    sampleReportProfile: 'beam', sampleReportTitle: 'BEAM & JOINT REINFORCEMENT REVIEW', sampleReportFocus: 'End-zone bars · Stirrups · Beam-column joint', sampleEvidenceIntro: 'Three close-up views document the beam end-zone; a separate joint image follows its own checklist reference.',
    project: 'DEMO ONLY — Riverside Apartments, Block B', location: 'DEMO ONLY — Grid B4–B6, Level 2', drawing: 'DEMO-STR-BM-118', revision: '02', date: '2026-11-11',
    inspector: 'DEMO — Milan Thapa', contractor: 'DEMO — Ramesh Karki', engineer: 'DEMO — N. Adhikari',
    inspectionNote: 'DEMO ONLY: Beam placement is on hold until stirrup spacing is corrected and the opening coordination is approved.',
    statuses: ['OK', 'OK', 'Not OK', 'OK', 'OK', 'Not OK', 'Pending', 'OK'],
    photosByItem: { 2: ['sample-beam-stirrup-spacing', 'sample-beam-tie-detail', 'sample-beam-tying-workmanship'], 5: ['sample-beam-joint-bars', 'sample-beam-precast-cage'] },
    observations: { 2: 'DEMO ONLY: Stirrups at the beam-column end zone do not match the approved detail.', 5: 'DEMO ONLY: The proposed service opening is not coordinated with the joint reinforcement.' },
    actions: { 2: 'DEMO ONLY: Reposition the stirrups to the approved detail and request re-inspection.', 5: 'DEMO ONLY: Obtain coordinated approval for the opening before making any reinforcement change.' },
  }),
  makeDemoSample({
    id: 'sample-column', element: 'Column', level: 'Standard', name: 'Column Pre-Pour Inspection', description: 'Five checks for a column cage offset at the base, documented from four site angles.',
    sampleReportProfile: 'column', sampleReportTitle: 'COLUMN CAGE & STARTER-BAR INSPECTION', sampleReportFocus: 'Grid position · Cage stability · Base connection', sampleEvidenceIntro: 'The four-photo sequence keeps the grid context, cage overview and starter-bar details together.',
    project: 'DEMO ONLY — Riverside Apartments, Block C', location: 'DEMO ONLY — Grid D3, Level 1', drawing: 'DEMO-STR-COL-031', revision: '01', date: '2026-11-10',
    inspector: 'DEMO — Nisha Rai', contractor: 'DEMO — Kiran Tamang', engineer: 'DEMO — P. Joshi',
    inspectionNote: 'DEMO ONLY: Verify the starter-bar correction against the approved detail before closing the column formwork.',
    statuses: ['OK', 'OK', 'Not OK', 'OK', 'N/A'],
    photosByItem: { 2: ['sample-column-grid-view', 'sample-column-cage-view', 'sample-column-starter-detail', 'sample-column-structure-context'] },
    observations: { 2: 'DEMO ONLY: The column cage is offset from the marked grid line at the base.' },
    actions: { 2: 'DEMO ONLY: Reposition and secure the cage to the approved setting-out marks, then re-inspect.' },
  }),
  makeDemoSample({
    id: 'sample-footing', element: 'Footing', level: 'Detailed', itemIndices: [0, 1, 2, 3, 4, 6, 7], name: 'Footing Pre-Pour Inspection', description: 'Seven selected detailed checks for an isolated footing, from setting-out through foundation release.',
    sampleReportProfile: 'footing', sampleReportTitle: 'ISOLATED FOOTING FOUNDATION RELEASE', sampleReportFocus: 'Setting-out · Founding surface · Reinforcement · Approval', sampleEvidenceIntro: 'Foundation context and reinforcement close-ups are grouped by the footing check they support.',
    project: 'DEMO ONLY — Hillside Health Centre', location: 'DEMO ONLY — Grid F2, Foundation F-07', drawing: 'DEMO-STR-FT-007', revision: '04', date: '2026-11-09',
    inspector: 'DEMO — Rupa Shrestha', contractor: 'DEMO — Deepak Lama', engineer: 'DEMO — B. Koirala',
    inspectionNote: 'DEMO ONLY: The reinforcement correction is outstanding and the founding-level approval is pending. Do not release for placement.',
    statuses: ['OK', 'Pending', 'OK', 'Not OK', 'OK', 'Not OK', 'Pending'],
    photosByItem: { 0: ['sample-footing-setting-out', 'sample-footing-excavation'], 3: ['sample-footing-mesh', 'sample-footing-starter-cage', 'sample-footing-overview', 'sample-footing-formwork'] },
    observations: { 1: 'DEMO ONLY: Founding-level acceptance is awaiting the responsible engineer’s confirmation.', 3: 'DEMO ONLY: The starter-bar cage requires repositioning to match the approved footing detail.', 5: 'DEMO ONLY: Waterstop continuity is not confirmed at the specified construction joint.' },
    actions: { 3: 'DEMO ONLY: Reset and secure the starter bars; obtain a re-inspection before the concrete pour.', 5: 'DEMO ONLY: Complete the specified joint and waterstop check, then request approval before release.' },
  }),
]
function localizeSample(sample, language) {
  if (!sample) return null
  return {
    ...sample,
    name: translate(sample.name, language), description: translate(sample.description, language),
    sampleReportTitle: translate(sample.sampleReportTitle || '', language),
    sampleReportFocus: translate(sample.sampleReportFocus || '', language),
    sampleEvidenceIntro: translate(sample.sampleEvidenceIntro || '', language),
    project: translate(sample.project, language), location: translate(sample.location, language),
    drawing: sample.drawing, revision: sample.revision,
    inspector: translate(sample.inspector, language), contractor: translate(sample.contractor, language), engineer: translate(sample.engineer, language),
    inspectionNote: translate(sample.inspectionNote, language),
    items: sample.items.map(item => ({
      ...localizeItem(item, language),
      notes: { ...item.notes, observations: translate(item.notes?.observations || '', language), comments: translate(item.notes?.comments || '', language) },
      remarks: translate(item.remarks || '', language),
      actions: (item.actions || []).map(action => ({ ...action, description: translate(action.description, language), responsiblePerson: translate(action.responsiblePerson, language) })),
    })),
    photos: Object.fromEntries(Object.entries(sample.photos).map(([id, photo]) => [id, { ...photo, caption: translate(photo.caption, language) }])),
  }
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
  const [activePage, setActivePage] = useState('dashboard')
  const [language, setLanguage] = useState(() => {
    try { return localStorage.getItem(LANGUAGE_KEY) === 'ja' ? 'ja' : 'en' } catch { return 'en' }
  })
  const tr = value => translate(value, language)
  const [showAllKanjiReadings, setShowAllKanjiReadings] = useState(false)
  const readingText = value => <JapaneseReadingText language={language} showAll={showAllKanjiReadings}>{value}</JapaneseReadingText>
  const [sampleViewingId, setSampleViewingId] = useState(null)
  const [draggedItemId, setDraggedItemId] = useState(null)
  const isMobileLayout = useSyncExternalStore(subscribeToMobileLayout, getMobileLayoutSnapshot, getMobileLayoutServerSnapshot)
  const [showProjectDetails, setShowProjectDetails] = useState(false)
  const [saveMessage, setSaveMessage] = useState(() => storageLoadWarning ? `Save Failed — ${storageLoadWarning}` : 'Saved')
  const [newTemplateName, setNewTemplateName] = useState('')
  const [templateSourceElement, setTemplateSourceElement] = useState(() => data.element)
  const [showCriteria, setShowCriteria] = useState(true)
  const [searchText, setSearchText] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const [selectedItemId, setSelectedItemId] = useState(null)
  const [backupMessage, setBackupMessage] = useState('')
  const [reportPhotos, setReportPhotos] = useState({})
  const [printSnapshot, setPrintSnapshot] = useState(null)
  const [printReady, setPrintReady] = useState(false)
  const [printBusy, setPrintBusy] = useState(false)
  const [printStatus, setPrintStatus] = useState('')
  const printRequestRef = useRef(false)
  const printWarningRef = useRef('')
  const reportPhotoUrls = useRef([])
  const referencePdfUrlRef = useRef(null)
  const [referencePdf, setReferencePdf] = useState(null)
  const [referencePdfBusy, setReferencePdfBusy] = useState(false)
  const [referencePdfMessage, setReferencePdfMessage] = useState('')
  const [showReferenceGuide, setShowReferenceGuide] = useState(false)
  const initialDataRef = useRef(data)
  const { project, element, level, location, drawing, revision, inspector, date, contractor,
    engineer, reportDesign, selectedTemplateId, customTemplates, items } = data

  useEffect(() => {
    try { localStorage.setItem(LANGUAGE_KEY, language) } catch { /* Language preference is optional; inspection storage remains independent. */ }
    document.documentElement.lang = language
    document.title = language === 'ja' ? 'ConcreteCheck — コンクリート打設前検査' : 'ConcreteCheck — Concrete Pre-Pour Inspection'
  }, [language])

  useEffect(() => () => reportPhotoUrls.current.forEach(revokePhotoUrl), [])

  useEffect(() => {
    let active = true
    getReferencePdf().then(record => {
      if (!active || !record?.blob) return
      const url = URL.createObjectURL(record.blob)
      referencePdfUrlRef.current = url
      setReferencePdf({ ...record, url })
    }).catch(error => {
      if (active) setReferencePdfMessage(`Reference PDF unavailable: ${error.message}`)
    })
    return () => {
      active = false
      if (referencePdfUrlRef.current) URL.revokeObjectURL(referencePdfUrlRef.current)
      referencePdfUrlRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!printReady) return undefined
    let active = true
    let printStarted = false
    let openWatchdog
    let cleanupTimer
    const finishPrint = (message = '') => {
      if (!printRequestRef.current) return
      printRequestRef.current = false
      setPrintBusy(false)
      setPrintReady(false)
      setPrintSnapshot(null)
      setReportPhotos({})
      setPrintStatus(message)
      printWarningRef.current = ''
      reportPhotoUrls.current.forEach(revokePhotoUrl)
      reportPhotoUrls.current = []
    }
    const onBeforePrint = () => {
      printStarted = true
      window.clearTimeout(openWatchdog)
      setPrintStatus(printWarningRef.current || 'Print Preview is open.')
    }
    const onAfterPrint = () => finishPrint()
    const printMedia = window.matchMedia?.('print')
    const onPrintMediaChange = event => { if (printStarted && !event.matches) finishPrint() }
    window.addEventListener('beforeprint', onBeforePrint)
    window.addEventListener('afterprint', onAfterPrint)
    printMedia?.addEventListener?.('change', onPrintMediaChange)
    const frame = requestAnimationFrame(() => {
      requestAnimationFrame(async () => {
        try {
          const images = [...document.querySelectorAll('.print-report img')]
          await withTimeout(Promise.all(images.map(image => image.complete
            ? Promise.resolve()
            : new Promise(resolve => {
              image.addEventListener('load', resolve, { once: true })
              image.addEventListener('error', resolve, { once: true })
            }))), 2500, 'The report image elements are still initializing.').catch(() => undefined)
          if (!active) return
          openWatchdog = window.setTimeout(() => finishPrint('Print Preview did not open. Try the browser menu to print or save as PDF.'), 15000)
          cleanupTimer = window.setTimeout(() => finishPrint(), 300000)
          window.print()
        } catch (error) {
          if (active) {
            finishPrint(`Print Preview failed: ${error.message}`)
          }
        }
      })
    })
    return () => {
      active = false
      cancelAnimationFrame(frame)
      window.clearTimeout(openWatchdog)
      window.clearTimeout(cleanupTimer)
      window.removeEventListener('beforeprint', onBeforePrint)
      window.removeEventListener('afterprint', finishPrint)
      printMedia?.removeEventListener?.('change', onPrintMediaChange)
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
      if (!window.confirm(translateConfirm(`Restore this ConcreteCheck backup?\n\n${summary}\n\nCurrent data will be replaced. A recovery copy will be preserved first.`, language))) return
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
  const dateText = date ? new Date(`${date}T00:00:00`).toLocaleDateString(language === 'ja' ? 'ja-JP-u-ca-gregory' : 'en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  }) : tr('Not specified')
  const activeTemplateName = level === 'Custom'
    ? customTemplates.find(t => t.id === selectedTemplateId)?.name || tr('Custom template')
    : `${tr(element)} ${tr(level)}`
  const displayItems = items.map(item => localizeItem(item, language))
  const filteredItems = items
    .map((item, originalIndex) => ({ ...item, originalIndex }))
    .filter(item => (statusFilter === 'All' || item.status === statusFilter)
      && `${item.category} ${item.requirement} ${item.criteria} ${item.remarks} ${item.notes?.comments || ''} ${(item.actions || []).map(a => `${a.description} ${a.responsiblePerson}`).join(' ')} ${item.correctiveAction} ${localizeItem(item, language).category} ${localizeItem(item, language).requirement} ${localizeItem(item, language).criteria} ${(localizeItem(item, language).subChecks || []).map(check => check.label).join(' ')}`.toLowerCase().includes(searchText.toLowerCase()))
  const categoryGroups = useMemo(() => {
    const grouped = []
    for (const item of filteredItems) {
      const label = item.category?.trim() || 'Uncategorized'
      const key = label.toLocaleLowerCase()
      let group = grouped[grouped.length - 1]
      if (!group || group.key !== key) {
        group = { key: `${key}-${item.originalIndex}`, categoryKey: key, label, visibleItems: [] }
        grouped.push(group)
      }
      group.visibleItems.push(item)
    }
    return grouped.map(group => {
      const categoryItems = items.filter(item => (item.category?.trim() || 'Uncategorized').toLocaleLowerCase() === group.categoryKey)
      const reviewedCount = categoryItems.filter(item => ['OK', 'Not OK', 'N/A'].includes(item.status)).length
      return { ...group, total: categoryItems.length, reviewed: reviewedCount, progress: categoryItems.length ? Math.round(reviewedCount / categoryItems.length * 100) : 0 }
    })
  }, [filteredItems, items])
  const focusedIndex = items.findIndex(item => item.id === selectedItemId)
  const focusedItem = focusedIndex >= 0 ? { ...items[focusedIndex], originalIndex: focusedIndex } : null
  const viewedSample = localizeSample(SAMPLE_INSPECTIONS.find(sample => sample.id === sampleViewingId), language)
  const viewedSampleCounts = viewedSample?.items.reduce((result, item) => {
    result.total += 1
    if (item.status === 'OK') result.ok += 1
    else if (item.status === 'Not OK') result.notOk += 1
    else if (item.status === 'N/A') result.na += 1
    else result.pending += 1
    result.openActions += (item.actions || []).filter(action => action.status !== 'Completed').length
    return result
  }, { total: 0, ok: 0, notOk: 0, pending: 0, na: 0, openActions: 0 })
  const viewedSampleGroups = viewedSample?.items.reduce((groups, item, index) => {
    const category = item.category || 'GENERAL'
    let group = groups[groups.length - 1]
    if (!group || group.category !== category) {
      group = { category, items: [] }
      groups.push(group)
    }
    group.items.push({ item, index })
    return groups
  }, []) || []
  const canReorderItems = level === 'Custom'

  function persistCurrent(s) {
    const draftKey = inspectionDraftKey(s.inspectionInstanceId, s.selectedTemplateId)
    return { ...s, inspectionDrafts: { ...(s.inspectionDrafts || {}), [draftKey]: s.items } }
  }
  function field(name, value) { setData(s => ({ ...s, [name]: value })) }
  function reorderItems(sourceId, targetId) {
    if (!sourceId || !targetId || sourceId === targetId) return
    setData(s => {
      const from = s.items.findIndex(item => item.id === sourceId)
      const to = s.items.findIndex(item => item.id === targetId)
      if (from < 0 || to < 0) return s
      const next = [...s.items]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return persistCurrent({ ...s, items: next })
    })
  }
  function handleDropItem(targetId, event) {
    if (!canReorderItems) return
    event.preventDefault()
    const sourceId = event.dataTransfer?.getData('text/plain') || draggedItemId
    reorderItems(sourceId, targetId)
    setDraggedItemId(null)
  }
  function moveItem(id, offset) {
    const index = items.findIndex(item => item.id === id)
    const target = items[index + offset]
    if (index < 0 || !target) return
    reorderItems(id, target.id)
  }
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
  function editSubCheckLabel(itemId, subCheckId, label) {
    setData(s => persistCurrent({ ...s, items: s.items.map(item => item.id === itemId
      ? { ...item, subChecks: (item.subChecks || []).map(check => check.id === subCheckId ? { ...check, label } : check) }
      : item) }))
  }
  function addSubCheck(itemId) {
    setData(s => persistCurrent({ ...s, items: s.items.map(item => item.id === itemId
      ? { ...item, subChecks: [...(item.subChecks || []), { id: createId('quick-check'), label: '', checked: false }] }
      : item) }))
  }
  function removeSubCheck(itemId, subCheckId) {
    setData(s => persistCurrent({ ...s, items: s.items.map(item => item.id === itemId
      ? { ...item, subChecks: (item.subChecks || []).filter(check => check.id !== subCheckId) }
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
    } catch (error) { setSaveMessage(`Save Failed — photo was not attached: ${error.message}`); window.alert(translateMessage(`Could not add photo: ${error.message}`, language)) }
  }
  async function removeEvidence(itemId, photoId) {
    if (!window.confirm(tr('Remove this photo from the checklist item?'))) return
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
    if (!window.confirm(tr('Remove this checklist item?'))) return
    setData(s => persistCurrent({ ...s, items: s.items.filter(x => x.id !== id) }))
  }
  function createTemplateFromSource(sourceItems, state, name, templateElement = state.element) {
    const id = createId('custom')
    const items = cleanTemplateItems(sourceItems, templateElement, id)
    const custom = { id, name, element: templateElement, items }
    return {
      ...state,
      customTemplates: [...state.customTemplates, custom],
      inspectionDrafts: { ...(state.inspectionDrafts || {}), [id]: items },
    }
  }
  function requestedTemplateName() {
    const name = newTemplateName.trim()
    if (!name) window.alert(tr('Please enter a name for the custom template.'))
    return name
  }
  function createFromStandard() {
    const name = requestedTemplateName()
    if (!name) return
    setData(s => createTemplateFromSource(makeItems(templateSourceElement, 'Standard'), s, name, templateSourceElement))
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
      return createTemplateFromSource(source, s, name, selectedCustom?.element || s.element)
    })
    setNewTemplateName('')
  }
  function deleteTemplate() {
    if (level !== 'Custom') return
    if (!window.confirm(tr('Delete this custom template from this browser?'))) return
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
  function inspectionHasData(s) {
    const sourceItems = s.level === 'Custom'
      ? s.customTemplates.find(template => template.id === s.selectedTemplateId)?.items
      : s.templates?.[s.selectedTemplateId]
    const signature = list => JSON.stringify((list || []).map(item => ({
      category: item.category, requirement: item.requirement, criteria: item.criteria,
      subChecks: (item.subChecks || []).map(check => check.label),
    })))
    const customized = Array.isArray(sourceItems) && signature(s.items) !== signature(sourceItems)
    return Boolean(s.project?.trim() || s.location?.trim() || s.drawing?.trim() || s.revision?.trim()
      || s.inspector?.trim() || s.contractor?.trim() || s.engineer?.trim() || customized
      || s.items.some(item => item.status !== 'Pending' || item.notes?.observations?.trim() || item.notes?.comments?.trim()
        || item.remarks?.trim() || item.correctiveAction?.trim() || item.mediaIds?.length || item.actions?.length
        || item.subChecks?.some(check => check.checked)))
  }
  function archiveInspection() {
    setData(s => archiveCurrent(persistCurrent(s)))
  }
  function handleUseSampleAsTemplate(sampleId) {
    const sample = SAMPLE_INSPECTIONS.find(entry => entry.id === sampleId)
    if (!sample) return
    const localizedSample = localizeSample(sample, language)
    const templateName = language === 'ja' ? `${localizedSample.name} — 編集用コピー` : `${sample.name} — Editable Copy`
    const sampleTemplateNames = new Set([`${localizedSample.name} — 編集用コピー`, `${sample.name} — Editable Copy`])
    setData(s => {
      if ((s.customTemplates || []).some(template => sampleTemplateNames.has(template.name) && template.element === sample.element)) return s
      const templateId = createId('sample-template')
      const templateItems = cleanTemplateItems(sample.items, sample.element, templateId)
      const customTemplate = { id: templateId, name: templateName, element: sample.element, items: templateItems }
      return {
        ...s,
        customTemplates: [...(s.customTemplates || []), customTemplate],
      }
    })
    setSampleViewingId(null)
    setActivePage('templates')
  }
  function removeInspection(record, recordIndex) {
    if (!record || data.inspectionHistory[recordIndex] !== record) return
    const label = `${record.project || 'Untitled project'} · ${record.date || 'No date'}`
    if (!window.confirm(translateConfirm(`Remove the archived inspection “${label}” from history? This will not change the active inspection.`, language))) return
    setData(s => ({
      ...s,
      inspectionHistory: (s.inspectionHistory || []).filter((item, index) => index !== recordIndex || item !== record),
    }))
  }
  function startInspectionFrom(templateId = data.selectedTemplateId) {
    const selectedCustom = data.customTemplates.find(template => template.id === templateId)
    const [templateElement, templateLevel] = selectedCustom ? [selectedCustom.element, 'Custom'] : (templateId || '').split('-')
    if (!ELEMENTS.includes(templateElement) || !['Standard', 'Detailed', 'Custom'].includes(templateLevel)) return
    if (inspectionHasData(data) && !window.confirm(tr('Start a new inspection? The current inspection will be preserved in History. Project details will be retained, the selected checklist will be fresh, the date will be set to today, and statuses, Quick Checks, notes, actions and photos will be reset.'))) return
    setSearchText('')
    setStatusFilter('All')
    setSelectedItemId(null)
    const nextInspectionInstanceId = makeInspectionId()
    setData(s => {
      const archived = inspectionHasData(s) ? archiveCurrent(persistCurrent(s)) : persistCurrent(s)
      const custom = archived.customTemplates.find(template => template.id === templateId)
      const selectedElement = custom?.element || templateElement
      const sourceItems = custom?.items || makeItems(selectedElement, templateLevel)
      const reset = cleanTemplateItems(sourceItems, selectedElement, `${templateId}-inspection-${Date.now()}`)
      const draftKey = inspectionDraftKey(nextInspectionInstanceId, templateId)
      return { ...archived, element: selectedElement, level: templateLevel, selectedTemplateId: templateId,
        inspectionInstanceId: nextInspectionInstanceId, date: localDate(), items: reset,
        inspectionDrafts: { ...(archived.inspectionDrafts || {}), [draftKey]: reset } }
    })
    setActivePage('workspace')
  }
  function startNewInspection() {
    startInspectionFrom(data.selectedTemplateId)
  }
  function restoreInspection(selectedRecord, recordIndex) {
    if (!selectedRecord || data.inspectionHistory[recordIndex] !== selectedRecord) return
    if (!window.confirm(tr('Restore this archived inspection? The current checklist will be replaced. Archive the current inspection first if you need to keep it.'))) return
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
    setActivePage('workspace')
  }
  function updateCustomTemplate() {
    if (level !== 'Custom') return
    if (!window.confirm(tr('Update this custom template with the current checklist wording? Statuses, remarks and corrective actions will not be saved.'))) return
    setData(s => {
      const templateItems = cleanTemplateItems(s.items, s.element, s.selectedTemplateId)
      return { ...s,
        customTemplates: s.customTemplates.map(t => t.id === s.selectedTemplateId ? { ...t, element: s.element, items: templateItems } : t),
        inspectionDrafts: { ...(s.inspectionDrafts || {}), [s.selectedTemplateId]: s.items },
      }
    })
  }
  async function handleReferencePdfUpload(file) {
    if (!file) return
    if (referencePdf && !window.confirm(tr('Replace the current Reference PDF?'))) return
    setReferencePdfBusy(true)
    setReferencePdfMessage('Saving Reference PDF…')
    try {
      const record = await saveReferencePdf(file)
      if (referencePdfUrlRef.current) URL.revokeObjectURL(referencePdfUrlRef.current)
      const url = URL.createObjectURL(record.blob)
      referencePdfUrlRef.current = url
      setReferencePdf({ ...record, url })
      setReferencePdfMessage('Reference PDF saved on this device.')
    } catch (error) {
      setReferencePdfMessage(`Reference PDF failed: ${error.message}`)
    } finally {
      setReferencePdfBusy(false)
    }
  }
  async function handleReferencePdfRemove() {
    if (!referencePdf || !window.confirm(tr('Remove this Reference PDF from this device?'))) return
    setReferencePdfBusy(true)
    try {
      await removeReferencePdf()
      if (referencePdfUrlRef.current) URL.revokeObjectURL(referencePdfUrlRef.current)
      referencePdfUrlRef.current = null
      setReferencePdf(null)
      setReferencePdfMessage('Reference PDF removed from this device.')
    } catch (error) {
      setReferencePdfMessage(`Reference PDF failed: ${error.message}`)
    } finally {
      setReferencePdfBusy(false)
    }
  }
  async function printReport(sourceData = data) {
    if (printRequestRef.current) return
    printRequestRef.current = true
    setPrintBusy(true)
    setPrintStatus('Preparing Print Preview…')
    printWarningRef.current = ''
    const snapshot = sourceData
    try {
      let mapped = {}
      if (snapshot.sampleReportProfile) {
        const samplePhotoIds = [...new Set(snapshot.items.flatMap(item => item.mediaIds || []))]
        const samplePhotos = snapshot.photos || {}
        mapped = Object.fromEntries(samplePhotoIds.map(id => {
          const photo = samplePhotos[id]
          return [id, photo ? { ...photo, id, printUrl: photo.dataUrl || photo.printUrl || '' } : { id, printUrl: '' }]
        }))
      } else {
        const itemPhotoIds = [...new Set(snapshot.items.flatMap(item => item.mediaIds || []))]
        const photos = await withTimeout(getPhotos(itemPhotoIds), 15000, 'Photo storage did not respond in time.')
        mapped = Object.fromEntries(photos.map(photo => [photo.id, {
          ...photo,
          printUrl: createPhotoUrl(photo.printBlob || photo.originalBlob),
        }]))
      }
      reportPhotoUrls.current.forEach(revokePhotoUrl)
      reportPhotoUrls.current = Object.values(mapped).map(photo => photo.printUrl)
      const photoLoadResults = await Promise.all(Object.values(mapped).map(photo => photo.printUrl ? preloadPrintImage(photo.printUrl) : Promise.resolve(false)))
      const failedPhotos = photoLoadResults.filter(loaded => !loaded).length
      if (failedPhotos) {
        printWarningRef.current = `${failedPhotos} ${failedPhotos === 1 ? 'photo could not' : 'photos could not'} be loaded; unavailable evidence will be labelled in the report.`
        setPrintStatus(printWarningRef.current)
      }
      setPrintSnapshot(snapshot)
      setReportPhotos(mapped)
      setPrintReady(true)
    } catch (error) {
      setBackupMessage(`Some evidence could not be prepared for printing: ${error.message}`)
      printWarningRef.current = `Some photos could not be prepared: ${error.message}`
      setPrintSnapshot(snapshot)
      setReportPhotos({})
      setPrintReady(true)
    }
  }

  const reportData = printSnapshot || data
  const reportItems = reportData.items.map(item => localizeItem(item, language))
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
  const sampleReportProfile = reportData.sampleReportProfile || ''
  const sampleReportClass = sampleReportProfile ? ` print-sample-report print-sample-${sampleReportProfile}` : ''
  const reportTemplateName = reportData.level === 'Custom'
    ? reportData.customTemplates.find(template => template.id === reportData.selectedTemplateId)?.name || 'Custom template'
    : `${tr(reportElement)} ${tr(reportData.level)}`
  const reportDateText = reportData.date ? new Date(`${reportData.date}T00:00:00`).toLocaleDateString(language === 'ja' ? 'ja-JP-u-ca-gregory' : 'en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  }) : tr('Not specified')

  return <>
    <div className="screen-only">
      <div className="app-shell" lang={language}>
        <header className="topbar">
          <div className="brand"><div className="brand-icon" role="img" aria-label="ConcreteCheck structural concrete block with verification checkmark"><svg viewBox="0 0 48 48" focusable="false" aria-hidden="true"><path className="logo-structure" d="M6 12 24 5l18 7v23l-18 8-18-8V12Z" /><path className="logo-face" d="m6 12 18 8 18-8M24 20v23" /><path className="logo-check" d="m15 26 6 6 13-14" /></svg></div><div className="brand-copy"><strong>ConcreteCheck</strong><span>Concrete Pre-Pour Inspection Management</span></div></div>
          <div className="topbar-actions">
            <button className="primary-button" onClick={() => printReport()} disabled={printBusy}>{tr(printBusy ? 'Preparing report…' : 'Export report')}</button>
            <div className="topbar-preferences">
              <label className="language-picker"><select aria-label={tr('Language')} value={language} onChange={event => setLanguage(event.target.value)}><option value="en">English</option><option value="ja">日本語</option></select></label>
              {language === 'ja' && <button type="button" className="reading-toggle" aria-label={tr(showAllKanjiReadings ? 'Hide Kanji readings' : 'Show Kanji readings')} title={tr(showAllKanjiReadings ? 'Hide Kanji readings' : 'Show Kanji readings')} aria-pressed={showAllKanjiReadings} onClick={() => setShowAllKanjiReadings(value => !value)}>{tr(showAllKanjiReadings ? 'Hide Kanji readings' : 'Show Kanji readings')}</button>}
            </div>
            <span className="draft-label" role="status" aria-live="polite" title={tr('Inspection changes are saved automatically on this device')}><span className="auto-save-label">{tr('Auto-save')}:</span> <span>{translateMessage(saveMessage, language)}</span></span>
            {printStatus && <span className="print-status-indicator" role="status">{translateMessage(printStatus, language)}</span>}
          </div>
        </header>
        <nav className="app-primary-nav" aria-label={tr('Main navigation')}>
          {[
            ['dashboard', 'Dashboard'], ['workspace', 'Current Inspection'], ['inspections', 'My Inspections'],
            ['templates', 'My Templates'], ['help', 'Help / How to Use'], ['settings', 'Settings'],
          ].map(([page, label]) => <button type="button" key={page} className={activePage === page ? 'is-active' : ''} aria-current={activePage === page ? 'page' : undefined} onClick={() => { setActivePage(page); setSelectedItemId(null) }}>{tr(label)}</button>)}
        </nav>
        <main className="main-content">
          {activePage === 'workspace' && <>
          <section className="current-project-summary" aria-labelledby="current-project-heading">
            <div className="project-summary-copy"><span className="summary-kicker">{readingText(tr(activePage === 'dashboard' ? 'CURRENT PROJECT' : 'CURRENT INSPECTION'))}</span><h1 id="current-project-heading">{project.trim() || readingText(tr('Project details not entered'))}</h1><p>{project.trim() ? readingText(`${tr(element)} ${tr('inspection')} · ${dateText}`) : readingText(tr('Add project details before recording this inspection.'))}</p></div>
            <button type="button" className="setup-shortcut" onClick={() => { setShowProjectDetails(true); setActivePage('settings') }}>{project.trim() ? tr('Edit project details') : tr('Enter project details')}</button>
            <dl className="project-summary-facts"><div><dt>{readingText(tr('Structural element'))}</dt><dd>{readingText(tr(element))}</dd></div><div><dt>{readingText(tr('Location / Grid'))}</dt><dd>{location.trim() || tr('Not specified')}</dd></div><div><dt>{readingText(tr('Inspection date'))}</dt><dd>{dateText}</dd></div>{drawing.trim() && <div><dt>{readingText(tr('Drawing'))}</dt><dd>{drawing}{revision.trim() ? ` · ${revision}` : ''}</dd></div>}{inspector.trim() && <div><dt>{readingText(tr('Inspector'))}</dt><dd>{inspector}</dd></div>}</dl>
          </section>

          <section className="inspection-overview" aria-label={tr('Inspection overview')}>
            <div className="inspection-overview-main"><div className="inspection-progress-block"><div className="inspection-progress-heading"><div><span className="summary-kicker">{readingText(tr('INSPECTION OVERVIEW'))}</span><h2>{readingText(tr('Inspection progress'))}</h2></div><strong>{progress}%</strong></div><div className="overview-progress-track" role="progressbar" aria-label={tr('Inspection progress')} aria-valuemin="0" aria-valuemax="100" aria-valuenow={progress}><span style={{ width: `${progress}%` }} /></div><p>{readingText(language === 'ja' ? `${reviewed}／${items.length} 項目確認済み · 未完了の是正措置 ${counts.openActions} 件` : `${reviewed} of ${items.length} items reviewed · ${counts.openActions} open corrective actions`)}</p></div>
              <div className="overview-counts" aria-label={tr('Inspection status counts')}><div><strong>{items.length}</strong><span>{readingText(tr('Total'))}</span></div><div className="overview-count-ok"><strong>{counts.ok}</strong><span>{readingText(tr('OK'))}</span></div><div className="overview-count-failed"><strong>{counts.failed}</strong><span>{readingText(tr('Not OK'))}</span></div><div className="overview-count-pending"><strong>{counts.pending}</strong><span>{readingText(tr('Pending'))}</span></div><div><strong>{counts.na}</strong><span>{readingText(tr('N/A'))}</span></div><div className="overview-count-actions"><strong>{counts.openActions}</strong><span>{readingText(tr('Open actions'))}</span></div></div>
            </div>
            <div className={`needs-attention${counts.failed ? '' : ' needs-attention-clear'}`}><div className="attention-heading"><h3>{readingText(tr('Needs attention'))}</h3><span>{counts.failed ? `${counts.failed} ${language === 'ja' ? '項目' : `item${counts.failed === 1 ? '' : 's'}`}` : tr('Clear')}</span></div>{counts.failed ? <div className="attention-items">{items.map((item, index) => item.status === 'Not OK' ? <button type="button" key={item.id} onClick={() => { if (isMobileLayout) setSelectedItemId(item.id); else document.getElementById(`checklist-item-${item.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }}><span>{String(index + 1).padStart(2, '0')}</span><span className="attention-item-copy"><strong>{localizeItem(item, language).requirement || tr('Untitled inspection item')}</strong><small>{(item.actions || []).filter(action => action.status !== 'Completed').length} {tr('corrective actions open · review status and evidence')}</small></span><b>{tr('Review →')}</b></button> : null)}</div> : <p>{readingText(tr('No items are currently marked Not OK.'))}</p>}</div>
          </section>
          </>}

          {activePage === 'dashboard' && <>
          <section className="dashboard-section" aria-labelledby="start-inspection-heading">
            <div className="dashboard-section-heading"><div><span className="summary-kicker">{readingText(tr('START A FIELD INSPECTION'))}</span><h2 id="start-inspection-heading">{readingText(tr('Start New Inspection'))}</h2><p>{readingText(tr('Choose the structural element to open its matching checklist.'))}</p></div></div>
            <div className="inspection-category-grid">{ELEMENTS.map(category => <article className="inspection-category-card" key={category}>
              <div className="category-card-icon"><StructuralIcon element={category} /></div><div className="category-card-copy"><h3>{readingText(tr(category))}</h3><p>{readingText(tr(`${category} category description`))}</p><span>{makeItems(category, 'Standard').length} {readingText(tr('standard checklist items'))}</span></div>
              <button type="button" className="primary-button" onClick={() => startInspectionFrom(keyOf(category, 'Standard'))}>{tr('Start Inspection')} <span aria-hidden="true">→</span></button>
            </article>)}</div>
          </section>
          <section className="dashboard-section future-categories-section" aria-labelledby="future-categories-heading">
            <div className="dashboard-section-heading"><div><h2 id="future-categories-heading">{readingText(tr('More Inspection Categories'))}</h2><p>{readingText(tr('Additional inspection types are planned for a later release.'))}</p></div></div>
            <div className="future-category-grid">{[['Bridge', 'BR'], ['Retaining Wall', 'RW'], ['Staircase', 'ST'], ['Other Structures', 'OS']].map(([name, mark]) => <button type="button" className="future-category-card" key={name} disabled aria-disabled="true"><span className="future-category-mark">{mark}</span><strong>{readingText(tr(name))}</strong><span className="coming-soon-badge">{readingText(tr('Coming Soon'))}</span></button>)}</div>
          </section>
          </>}

          {['workspace', 'settings', 'templates'].includes(activePage) && <section className="project-setup-area" id="project-setup-area">
            <h2 className="mobile-area-title">{readingText(tr(activePage === 'templates' ? 'My Templates' : activePage === 'settings' ? 'Settings' : 'Project & Setup'))}</h2>
            {activePage === 'workspace' && <section className="panel">
              <div className="section-heading"><div><h2>{readingText(tr('Project information'))}</h2><p>{project.trim() ? `${tr(element)} · ${location.trim() || tr('Location not specified')} · ${dateText}` : tr('Project details are missing. Enter them before recording the inspection.')}</p></div><button className="section-toggle" type="button" aria-expanded={showProjectDetails} aria-controls="project-information-fields" onClick={() => setShowProjectDetails(value => !value)}>{showProjectDetails ? tr('Hide details') : project.trim() ? tr('Edit details') : tr('Enter project details')}</button></div>
              <div className="form-grid" id="project-information-fields" hidden={!showProjectDetails}>
                <label>{readingText(tr('Project name'))}<input value={project} onChange={e => field('project', e.target.value)} placeholder={tr('e.g. Residential Apartment Building')} /></label>
                <label>{readingText(tr('Structural element'))}<select value={element} onChange={e => chooseTemplate(keyOf(e.target.value, 'Standard'))}>{ELEMENTS.map(x => <option key={x} value={x}>{tr(x)}</option>)}</select></label>
                <label>{readingText(tr('Location / Grid'))}<input value={location} onChange={e => field('location', e.target.value)} placeholder={tr('e.g. Third Floor – Grid A1 to A4')} /></label>
                <label>{readingText(tr('Inspection date'))}<input type="date" value={date} onChange={e => field('date', e.target.value)} /></label>
                <label>{readingText(tr('Drawing number'))}<input value={drawing} onChange={e => field('drawing', e.target.value)} placeholder={tr('e.g. STR-SLAB-003')} /></label>
                <label>{readingText(tr('Drawing revision'))}<input value={revision} onChange={e => field('revision', e.target.value)} placeholder={tr('e.g. Rev. 02')} /></label>
                <label>{readingText(tr('Inspector'))}<input value={inspector} onChange={e => field('inspector', e.target.value)} placeholder={tr('Inspector name')} /></label>
                <label>{readingText(tr('Contractor representative'))}<input value={contractor} onChange={e => field('contractor', e.target.value)} placeholder={tr('Name')} /></label>
                <label>{readingText(tr('Engineer'))}<input value={engineer} onChange={e => field('engineer', e.target.value)} placeholder={tr('Name')} /></label>
              </div>
            </section>}
            {activePage === 'settings' && <section className="panel report-settings-panel"><div className="section-heading"><div><h2>{readingText(tr('Report Preferences'))}</h2><p>{readingText(tr('Choose the existing report presentation for future print previews.'))}</p></div></div><label className="settings-select-label">{readingText(tr('PDF report design'))}<select value={reportDesign} onChange={e => field('reportDesign', e.target.value)}>{DESIGNS.map(value => <option key={value} value={value}>{tr(value)}</option>)}</select></label></section>}
            {activePage === 'workspace' && level === 'Custom' && customTemplates.some(template => template.id === selectedTemplateId) && <section className="panel workspace-template-tools"><div><h2>{readingText(tr('Custom template'))}: {activeTemplateName}</h2><p>{readingText(tr('Checklist edits can be saved back to this reusable template.'))}</p></div><div className="custom-template-actions"><button type="button" className="secondary-button" onClick={updateCustomTemplate}>{tr('Update custom template')}</button><button type="button" className="danger-button" onClick={deleteTemplate}>{tr('Delete custom template')}</button></div></section>}
            {activePage === 'templates' && <>
              <section className="panel template-library-panel"><div className="section-heading"><div><h2>{readingText(tr('Create or copy a template'))}</h2><p>{readingText(tr('Templates are separate from active inspection records. Creating one will not change your current checklist.'))}</p></div></div>
                <div className="template-controls"><label>{readingText(tr('Structural element for new standard template'))}<select value={templateSourceElement} onChange={event => setTemplateSourceElement(event.target.value)}>{ELEMENTS.map(value => <option key={value} value={value}>{tr(value)}</option>)}</select></label><label>{readingText(tr('Custom template name'))}<input value={newTemplateName} onChange={event => setNewTemplateName(event.target.value)} placeholder={tr('e.g. Typical residential slab')} /></label></div>
                <div className="custom-template-actions"><button type="button" className="secondary-button" onClick={createFromStandard}>{tr('Create from standard')}</button><button type="button" className="secondary-button" onClick={saveCurrentAsCustom}>{tr('Save current as custom')}</button><button type="button" className="secondary-button" onClick={duplicateCurrentTemplate}>{tr('Duplicate current')}</button></div>
              </section>
              <details className="panel sample-template-library" open>
                <summary className="sample-template-library-summary"><span className="summary-kicker">{readingText(tr('BUILT-IN SAMPLES'))}</span><strong>{readingText(tr('Sample Templates'))}</strong><small>{SAMPLE_INSPECTIONS.length}</small></summary>
                <div className="sample-template-grid">{SAMPLE_INSPECTIONS.map(sample => {
                  const coverPhoto = SAMPLE_PHOTOS[sample.items.flatMap(item => item.mediaIds)[0]]
                  const photoCount = [...new Set(sample.items.flatMap(item => item.mediaIds || []))].length
                  return <article className="sample-template-card" key={sample.id}>
                    {coverPhoto && <img className="sample-template-preview" src={coverPhoto.dataUrl} alt={tr('Sample construction photo')} loading="lazy" decoding="async" />}
                    <div className="sample-template-copy"><span className="sample-template-tag">{readingText(tr('BUILT-IN SAMPLE TEMPLATE'))}</span><h3>{readingText(tr(sample.element))} {readingText(tr('Sample'))}</h3><p>{readingText(tr(sample.description))}</p><small>{sample.items.length} {readingText(tr('items'))} · {photoCount} {readingText(tr('photos'))}</small></div>
                    <div className="sample-template-actions"><button type="button" className="secondary-button" onClick={() => setSampleViewingId(sample.id)}>{tr('View Sample')}</button><button type="button" className="secondary-button" onClick={() => printReport(localizeSample(sample, language))} disabled={printBusy}>{tr('Print / PDF')}</button><button type="button" className="primary-button" onClick={() => handleUseSampleAsTemplate(sample.id)}>{tr('Use Checklist')}</button></div>
                  </article>
                })}</div>
              </details>
              <section className="panel my-templates-list"><div className="section-heading"><div><h2>{readingText(tr('My Custom Templates'))}</h2><p>{data.customTemplates.length} {readingText(tr('custom templates'))}</p></div></div>
                {data.customTemplates.length ? <div className="custom-template-grid">{data.customTemplates.map(template => <article className="custom-template-card" key={template.id}><span className="summary-kicker">{readingText(tr('CUSTOM TEMPLATE'))}</span><h3>{template.name}</h3><p>{readingText(tr(template.element))} · {template.items.length} {readingText(tr('items'))}</p><div className="custom-template-card-actions"><button type="button" className="secondary-button" onClick={() => { chooseTemplate(template.id); setShowProjectDetails(true); setActivePage('workspace') }}>{tr('Edit in workspace')}</button><button type="button" className="primary-button" onClick={() => startInspectionFrom(template.id)}>{tr('Start inspection')}</button></div></article>)}</div> : <div className="empty-checklist">{readingText(tr('No custom templates yet. Save or create one above.'))}</div>}
              </section>
            </>}
          </section>}

          {activePage === 'inspections' && <section className="application-page" aria-labelledby="inspections-page-title">
            <header className="application-page-heading"><div><span className="summary-kicker">{readingText(tr('HISTORY AND RECORDS'))}</span><h1 id="inspections-page-title">{readingText(tr('My Inspections'))}</h1><p>{readingText(tr('Open the current inspection or restore a previous saved record.'))}</p></div></header>
            <section className="panel active-inspection-card"><div><span className="sample-card-badge">{readingText(tr('CURRENT INSPECTION'))}</span><h2>{project.trim() || tr('Untitled project')}</h2><p>{readingText(tr(element))} · {readingText(tr(level))} · {dateText} · {items.length} {readingText(tr('items'))}</p></div><div className="inspection-record-actions"><button type="button" className="secondary-button" onClick={() => setActivePage('workspace')}>{tr('Open current inspection')}</button><button type="button" className="primary-button" onClick={archiveInspection}>{tr('Archive inspection')}</button></div></section>
            <section className="panel history-records-panel"><div className="section-heading"><div><h2>{readingText(tr('Inspection History'))}</h2><p>{data.inspectionHistory.length} {readingText(tr('archived inspections'))}</p></div></div>
              {data.inspectionHistory.length ? <div className="history-record-grid">{data.inspectionHistory.map((record, index) => <article className="history-record-card" key={record.id || `${record.inspectionInstanceId || 'legacy'}-${index}`}><div><span className="summary-kicker">{readingText(tr('ARCHIVED INSPECTION'))}</span><h3>{record.project || tr('Untitled project')}</h3><p>{readingText(tr(record.element || 'Slab'))} · {readingText(tr(record.templateName || 'Custom template'))} · {record.date || tr('Not specified')}</p><small>{record.items?.length || 0} {readingText(tr('items'))}{record.savedAt ? ` · ${new Date(record.savedAt).toLocaleString(language === 'ja' ? 'ja-JP' : 'en-US')}` : ''}</small></div><div className="inspection-record-actions"><button type="button" className="secondary-button" onClick={() => restoreInspection(record, index)}>{tr('Restore')}</button><button type="button" className="danger-button" onClick={() => removeInspection(record, index)}>{tr('Remove from history')}</button></div></article>)}</div> : <div className="empty-checklist">{readingText(tr('No archived inspections yet.'))}</div>}
            </section>
            <section className="panel backup-panel"><div className="section-heading"><div><h2>{readingText(tr('Reports and backup'))}</h2><p>{readingText(tr('Backups stay on this device until you download and store them elsewhere.'))}</p></div></div><div className="backup-actions"><button type="button" className="secondary-button" onClick={exportBackup}>{tr('Download full backup')}</button><label className="secondary-button backup-import-control">{tr('Restore backup')}<input type="file" accept=".ccbackup,.json,application/json" onChange={event => { const file = event.target.files?.[0]; restoreBackup(file); event.target.value = '' }} /></label></div>{backupMessage && <p className="backup-status" role="status">{translateMessage(backupMessage, language)}</p>}</section>
          </section>}

          {activePage === 'help' && <section className="application-page help-page" aria-labelledby="help-page-title">
            <header className="application-page-heading"><div><span className="summary-kicker">{readingText(tr('FIELD WORKFLOW GUIDE'))}</span><h1 id="help-page-title">{readingText(tr('Help / How to Use'))}</h1><p>{readingText(tr('A practical guide from selecting a structure to saving the inspection record.'))}</p></div></header>
            <ol className="guide-step-list">{[
              ['Choose Inspection Category', 'Choose Slab, Beam, Column or Footing. ConcreteCheck opens the matching checklist for the new inspection.', 'Select one of the four structural cards on Dashboard. A current inspection with entered data is preserved in History before a new inspection starts.'],
              ['Enter Project Information', 'Add the project, location, drawing revision and inspection date so the record can be identified later.', 'Use Project & Setup to enter the project name, location or grid, structural element, drawing number, revision, inspection date and responsible people.'],
              ['Complete the Checklist', 'Acceptance Criteria explain the expected reference. Quick Checks are reminders. Set the overall status yourself: Pending, OK, Not OK or N/A.', 'Review each requirement and acceptance criteria. Tick the technical Quick Checks as reminders, then manually confirm the item status. N/A remains a deliberate recorded result.'],
              ['Add Photo Evidence', 'Attach photos and record an Observation or Corrective Action when needed.', 'Open an item, choose Take photo or Choose from device, select a caption and evidence type. Each attached photo remains associated with its checklist item.'],
              ['Preview and Export PDF', 'Use Export report to open the browser print dialog, then select Save as PDF to create a shareable record.', 'Review the report in Print Preview before saving. Check project details, checklist numbers and statuses, evidence references and sign-off.'],
              ['Save and Manage Templates', 'Save an inspection checklist as a custom template to reuse its structure without carrying over inspection results.', 'Use My Templates to create a template, edit its checklist, save changes and start a fresh inspection. Templates are separate from inspection history.'],
            ].map(([title, summary, detail], index) => <li className="guide-step-card" key={title}><span className="guide-step-number">{String(index + 1).padStart(2, '0')}</span><div><h2>{readingText(tr(title))}</h2><p className="guide-step-summary">{readingText(tr(summary))}</p><details><summary>{readingText(tr('More details'))}</summary><p>{readingText(tr(detail))}</p></details></div></li>)}</ol>
            <details className="panel help-reference-disclosure">
              <summary className="help-reference-summary"><span className="summary-kicker">{readingText(tr('VISUAL REFERENCE'))}</span><strong>{readingText(tr('Reference PDF Documents'))}</strong></summary>
              <section className="reference-pdf-card help-reference-pdf" aria-label={tr('Reference PDF Documents')}>
              <p className="reference-pdf-description">{readingText(tr('Upload a report PDF to compare its pages and visual organization. It remains separate from inspections and templates.'))}</p>
              <div className="reference-pdf-controls"><label className="secondary-button reference-pdf-upload">{referencePdf ? tr('Replace Reference PDF') : tr('Upload Reference PDF')}<input type="file" accept="application/pdf,.pdf" disabled={referencePdfBusy} onChange={event => { const file = event.target.files?.[0]; handleReferencePdfUpload(file); event.target.value = '' }} /></label>{referencePdf && <><span className="reference-pdf-name" title={referencePdf.name}>{referencePdf.name} · {(referencePdf.size / (1024 * 1024)).toFixed(1)} MB</span><button type="button" className="danger-button" onClick={handleReferencePdfRemove} disabled={referencePdfBusy}>{tr('Remove Reference PDF')}</button><a className="secondary-button" href={referencePdf.url} target="_blank" rel="noreferrer">{tr('Open in new tab')}</a></>}</div>
              {referencePdfMessage && <p className="reference-pdf-message" role="status">{translateMessage(referencePdfMessage, language)}</p>}
              {referencePdf && <iframe className="reference-pdf-viewer" title={`${tr('Reference PDF')}: ${referencePdf.name}`} src={referencePdf.url} />}
              <div className="reference-guide-actions"><button type="button" className="secondary-button" onClick={() => setShowReferenceGuide(value => !value)} aria-expanded={showReferenceGuide}>{tr('Create an Interactive Sample Based on This Reference')}</button></div>
              {showReferenceGuide && <div className="reference-create-guide"><h4>{readingText(tr('Manual reference-based sample workflow'))}</h4><ol><li>{readingText(tr('Keep the Reference PDF open in this tab or a second browser tab for comparison.'))}</li><li>{readingText(tr('Open My Templates and create a clean template for the matching structural element.'))}</li><li>{readingText(tr('Manually enter the requirements, criteria and Quick Checks that you want to reuse.'))}</li><li>{readingText(tr('Start a new inspection from your template and attach your own site evidence. No automatic PDF conversion is performed.'))}</li></ol><button type="button" className="primary-button" onClick={() => { setActivePage('templates'); setShowReferenceGuide(false) }}>{tr('Open My Templates')}</button></div>}
              {!referencePdf && <p className="reference-pdf-empty">{readingText(tr('No Reference PDF is stored on this device yet. You can upload one here when available.'))}</p>}
              </section>
            </details>
          </section>}

          {activePage === 'workspace' && <>
          <section className="panel checklist-panel" id="checklist-workspace">
            <div className="section-heading checklist-heading"><div><span className="summary-kicker">{readingText(tr('MAIN INSPECTION CHECKLIST'))}</span><h2>{readingText(tr(element))} {readingText(tr('inspection checklist'))}</h2><p>{level === 'Custom' ? activeTemplateName : readingText(activeTemplateName)} · {readingText(tr('Showing'))} {filteredItems.length} {readingText(tr('of'))} {items.length} {readingText(tr('items'))}</p></div><div className="inline-actions"><button className="primary-button add-item-action" onClick={addItem}>+ {tr('Add item')}</button><button className="secondary-button archive-action" onClick={archiveInspection}>{tr('Archive inspection')}</button><button className="secondary-button new-inspection-action" onClick={startNewInspection}>{tr('Start new inspection')}</button></div></div>
            <div className="checklist-toolbar"><input value={searchText} onChange={e => setSearchText(e.target.value)} placeholder={tr('Search checklist items')} /><select aria-label={tr('Filter checklist by status')} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>{FILTER_OPTIONS.map(filter => <option key={filter} value={filter}>{tr(filter)}</option>)}</select><label className="checkbox-label"><input type="checkbox" checked={showCriteria} onChange={e => setShowCriteria(e.target.checked)} /> {readingText(tr('Show acceptance criteria'))}</label></div>
            <div className="checklist-table">
              <div className="table-header"><span>{readingText(tr('Inspection item'))}</span><span>{readingText(tr('Status'))}</span><span>{readingText(tr('Remarks and action'))}</span><span>{readingText(tr('Remove'))}</span></div>
              {items.length === 0 && <div className="empty-checklist">{readingText(tr('No checklist items. Select Add item to begin.'))}</div>}
              {items.length > 0 && filteredItems.length === 0 && <div className="empty-checklist">{readingText(tr('No checklist items match the current search or status filter.'))}</div>}
              {categoryGroups.map(group => <section className="category-group" key={group.key}>
                <header className="category-group-heading"><div><h3>{readingText(tr(group.label))}</h3><p>{readingText(language === 'ja' ? `${group.reviewed}／${group.total} 件確認済み · ${group.visibleItems.length} 件表示` : `${group.reviewed} of ${group.total} reviewed · ${group.visibleItems.length} shown`)}</p></div><strong>{group.progress}%</strong><div className="category-progress"><span style={{ width: group.progress + '%' }} /></div></header>
                <div className="category-group-items">{group.visibleItems.map(item => <div className="category-item-pair" id={`checklist-item-${item.id}`} key={item.id}>
                  <div className="desktop-checklist-item"><ChecklistItemCard
                    key={item.id} item={localizeItem(item, language)} number={item.originalIndex + 1} showCriteria={showCriteria} language={language} showAllReadings={showAllKanjiReadings}
                    canReorder={canReorderItems} canMoveUp={item.originalIndex > 0} canMoveDown={item.originalIndex < items.length - 1}
                    onMoveUp={() => moveItem(item.id, -1)} onMoveDown={() => moveItem(item.id, 1)} onDragStart={setDraggedItemId}
                    onDragOver={event => event.preventDefault()} onDrop={event => handleDropItem(item.id, event)} onDragEnd={() => setDraggedItemId(null)}
                    editableQuickChecks={canReorderItems}
                    onItemChange={(prop, value) => editItem(item.id, prop, value)}
                    onSubCheckChange={(subCheckId, checked) => editSubCheck(item.id, subCheckId, checked)}
                    onSubCheckLabelChange={(subCheckId, label) => editSubCheckLabel(item.id, subCheckId, label)}
                    onAddSubCheck={() => addSubCheck(item.id)} onRemoveSubCheck={subCheckId => removeSubCheck(item.id, subCheckId)}
                    onNotesChange={(key, value) => editNotes(item.id, key, value)}
                    onAddAction={() => addAction(item.id)}
                    onEditAction={(actionId, key, value) => editAction(item.id, actionId, key, value)}
                    onRemoveAction={actionId => removeAction(item.id, actionId)}
                    onAddEvidence={file => addEvidence(item.id, file)}
                    onRemoveEvidence={photoId => removeEvidence(item.id, photoId)}
                    onEditEvidence={editEvidence} onRemove={() => removeItem(item.id)}
                  /></div>
                  <MobileChecklistItem item={localizeItem(item, language)} number={item.originalIndex + 1} showCriteria={showCriteria} language={language} showAllReadings={showAllKanjiReadings} canReorder={canReorderItems} canMoveUp={item.originalIndex > 0} canMoveDown={item.originalIndex < items.length - 1} onMoveUp={() => moveItem(item.id, -1)} onMoveDown={() => moveItem(item.id, 1)} onShowCriteria={() => setShowCriteria(true)} onStatusChange={status => editItem(item.id, 'status', status)} onSubCheckChange={(subCheckId, checked) => editSubCheck(item.id, subCheckId, checked)} onOpen={() => setSelectedItemId(item.id)} />
                </div>)}</div>
              </section>)}

            </div>
          </section>

          <section className="panel notice-panel"><strong>{readingText(tr('Before concrete placement'))}</strong><p>{readingText(tr('Resolve and re-inspect items marked Not OK. Confirm pending items and required approvals with the responsible engineer before pouring. Use the latest approved drawings and project specifications as the acceptance reference.'))}</p></section>
          {isMobileLayout && focusedItem ? (<section className="mobile-inspection-focus" role="dialog" aria-modal="true" aria-labelledby="focused-item-title"><div className="focus-topbar"><button type="button" className="focus-back" onClick={() => setSelectedItemId(null)}>{tr('← Checklist')}</button><span>{readingText(tr('Item'))} {focusedIndex + 1} {readingText(tr('of'))} {items.length}</span></div><div className="focus-navigation"><button type="button" disabled={focusedIndex <= 0} onClick={() => setSelectedItemId(items[focusedIndex - 1]?.id)}>← {tr('Previous item')}</button><button type="button" disabled={focusedIndex >= items.length - 1} onClick={() => setSelectedItemId(items[focusedIndex + 1]?.id)}>{tr('Next item')} →</button></div><h2 id="focused-item-title">{readingText(tr('Full inspection'))}</h2>{!showCriteria && <button type="button" className="focus-show-criteria" onClick={() => setShowCriteria(true)}>{tr('Show acceptance criteria')}</button>}<ChecklistItemCard key={focusedItem.id} item={localizeItem(focusedItem, language)} number={focusedIndex + 1} showCriteria={showCriteria} language={language} showAllReadings={showAllKanjiReadings} canReorder={canReorderItems} canMoveUp={focusedIndex > 0} canMoveDown={focusedIndex < items.length - 1} onMoveUp={() => moveItem(focusedItem.id, -1)} onMoveDown={() => moveItem(focusedItem.id, 1)} editableQuickChecks={canReorderItems} onItemChange={(prop, value) => editItem(focusedItem.id, prop, value)} onSubCheckChange={(subCheckId, checked) => editSubCheck(focusedItem.id, subCheckId, checked)} onSubCheckLabelChange={(subCheckId, label) => editSubCheckLabel(focusedItem.id, subCheckId, label)} onAddSubCheck={() => addSubCheck(focusedItem.id)} onRemoveSubCheck={subCheckId => removeSubCheck(focusedItem.id, subCheckId)} onNotesChange={(key, value) => editNotes(focusedItem.id, key, value)} onAddAction={() => addAction(focusedItem.id)} onEditAction={(actionId, key, value) => editAction(focusedItem.id, actionId, key, value)} onRemoveAction={actionId => removeAction(focusedItem.id, actionId)} onAddEvidence={file => addEvidence(focusedItem.id, file)} onRemoveEvidence={photoId => removeEvidence(focusedItem.id, photoId)} onEditEvidence={editEvidence} onRemove={() => removeItem(focusedItem.id)} /></section>) : null}
          </>}
        </main>
        <footer className="app-footer">{readingText(tr('ConcreteCheck · A practical pre-pour inspection record'))}</footer>
        {viewedSample && <div className="sample-viewer-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setSampleViewingId(null) }}>
          <section className="sample-viewer" role="dialog" aria-modal="true" aria-labelledby="sample-viewer-title" lang={language}>
            <header className="sample-viewer-header"><div><span className="sample-card-badge">{readingText(tr('DEMONSTRATION ONLY — NOT A REAL INSPECTION'))}</span><h2 id="sample-viewer-title">{readingText(viewedSample.name)}</h2><p>{readingText(tr(viewedSample.element))} · {viewedSample.items.length} {readingText(tr('items'))}</p></div><button type="button" className="sample-viewer-close" aria-label={tr('Close example')} onClick={() => setSampleViewingId(null)}>×</button></header>
            <div className="sample-demo-notice">{readingText(tr('This example is illustrative only. Its drawings, inspection, photos and sign-off are not real project records or site evidence.'))}</div>
            <section className="sample-viewer-section"><h3>{readingText(tr('Sample Project Information'))}</h3><dl className="sample-project-grid"><div><dt>{readingText(tr('Project name'))}</dt><dd>{readingText(viewedSample.project)}</dd></div><div><dt>{readingText(tr('Location / Grid'))}</dt><dd>{readingText(viewedSample.location)}</dd></div><div><dt>{readingText(tr('Structural element'))}</dt><dd>{readingText(tr(viewedSample.element))}</dd></div><div><dt>{readingText(tr('Drawing number'))}</dt><dd>{viewedSample.drawing} · {viewedSample.revision}</dd></div><div><dt>{readingText(tr('Inspection date'))}</dt><dd>{viewedSample.date}</dd></div><div><dt>{readingText(tr('Inspector'))}</dt><dd>{readingText(viewedSample.inspector)}</dd></div><div><dt>{readingText(tr('Contractor representative'))}</dt><dd>{readingText(viewedSample.contractor)}</dd></div><div><dt>{readingText(tr('Engineer'))}</dt><dd>{readingText(viewedSample.engineer)}</dd></div></dl></section>
            <section className="sample-viewer-section sample-inspection-summary"><div className="section-heading"><div><h3>{readingText(tr('Inspection Summary'))}</h3><p>{viewedSampleCounts.total ? Math.round(((viewedSampleCounts.ok + viewedSampleCounts.notOk + viewedSampleCounts.na) / viewedSampleCounts.total) * 100) : 0}% {readingText(tr('Progress'))}</p></div><strong>{viewedSampleCounts.total} {readingText(tr('items'))}</strong></div><div className="sample-summary-counts"><span>{viewedSampleCounts.ok} {readingText(tr('OK'))}</span><span>{viewedSampleCounts.notOk} {readingText(tr('Not OK'))}</span><span>{viewedSampleCounts.pending} {readingText(tr('Pending'))}</span><span>{viewedSampleCounts.na} {readingText(tr('N/A'))}</span><span>{viewedSampleCounts.openActions} {readingText(tr('Open actions'))}</span></div></section>
            <section className="sample-viewer-section" id="sample-viewer-checklist"><div className="section-heading"><div><h3>{readingText(tr('Checklist'))}</h3><p>{readingText(tr('Acceptance criteria, Quick Checks and final status are shown for each original checklist item.'))}</p></div></div><div className="sample-category-groups">{viewedSampleGroups.map(group => <section className="sample-category-group" key={group.category}><header><h4>{readingText(tr(group.category))}</h4><span>{group.items.filter(({ item }) => item.status !== 'Pending').length}/{group.items.length} {readingText(tr('reviewed'))}</span></header><div className="sample-checklist-list">{group.items.map(({ item, index }) => <article className="sample-checklist-item" key={item.id}><div className="sample-checklist-item-head"><span>{readingText(tr('ITEM'))} {String(index + 1).padStart(2, '0')} · {readingText(tr(item.category))}</span><strong className={`sample-status sample-status-${item.status.toLowerCase().replace(' ', '-')}`}>{readingText(tr(item.status))}</strong></div><h4>{readingText(item.requirement)}</h4>{showCriteria && item.criteria && <p className="sample-checklist-criteria"><strong>{readingText(tr('Acceptance criteria'))}:</strong> {readingText(item.criteria)}</p>}<div className="sample-quick-checks"><strong>{readingText(tr('Quick checks'))}</strong>{item.subChecks.map(check => <span key={check.id}><i aria-hidden="true">{check.checked ? '✓' : '○'}</i> {readingText(check.label)}</span>)}</div>{(item.notes?.observations || item.actions?.length > 0) && <div className="sample-item-evidence">{item.notes?.observations && <p><strong>{readingText(tr('Observation:'))}</strong> {readingText(item.notes.observations)}</p>}{item.actions?.map(action => <p key={action.id}><strong>{readingText(tr('Corrective Action:'))}</strong> {readingText(action.description)}{action.responsiblePerson ? ` · ${tr('Responsible:')} ${tr(action.responsiblePerson)}` : ''}{action.status ? ` · ${tr(action.status)}` : ''}</p>)}</div>}{(item.mediaIds || []).length > 0 && <div className="sample-item-photos">{item.mediaIds.map(photoId => { const photo = viewedSample.photos[photoId]; return photo && <figure key={photoId}><img src={photo.dataUrl} alt={`${tr('Sample photo — illustrative only')}: ${tr(photo.caption)}`} /><figcaption><span>{readingText(tr('ITEM'))} {String(index + 1).padStart(2, '0')}</span>{readingText(tr(photo.caption))}<small>{readingText(tr('Sample photo — illustrative only'))}</small></figcaption></figure> })}</div>}</article>)}</div></section>)}</div></section>
            <section className="sample-viewer-section sample-signoff"><h3>{readingText(tr('Sample Inspection Note'))}</h3><p>{readingText(tr(viewedSample.inspectionNote))}</p><div><span>{readingText(tr('Inspector'))}: {readingText(viewedSample.inspector)}</span><span>{readingText(tr('Contractor representative'))}: {readingText(viewedSample.contractor)}</span><span>{readingText(tr('Engineer'))}: {readingText(viewedSample.engineer)}</span></div></section>
            <footer className="sample-viewer-actions"><button type="button" className="secondary-button" onClick={() => document.getElementById('sample-viewer-checklist')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>{tr('View Inspection')}</button><button type="button" className="secondary-button" onClick={() => printReport(viewedSample)} disabled={printBusy}>{tr('Print / PDF')}</button><button type="button" className="primary-button" onClick={() => handleUseSampleAsTemplate(viewedSample.id)}>{tr('Use Checklist')}</button><button type="button" className="secondary-button" onClick={() => setSampleViewingId(null)}>{tr('Back to Gallery')}</button></footer>
          </section>
        </div>}
      </div>
    </div>

    <article className={`print-report print-${reportLayout.toLowerCase()}${sampleReportClass}`} lang={language}>
      <header className="print-header"><div className="print-brand">CONCRETECHECK</div><div className="print-document-label">{tr('INSPECTION RECORD')}</div><h1>{tr('CONCRETE PRE-POUR INSPECTION REPORT')}</h1><p>{tr('Pre-pour inspection and approval record')}</p>{sampleReportProfile && <div className="print-sample-profile"><strong>{tr(reportData.sampleReportTitle)}</strong><span>{tr(reportData.sampleReportFocus)}</span></div>}</header>

      <section className="print-section"><h2>{tr('1. PROJECT INFORMATION')}</h2><table className="print-info-table"><tbody>
        <tr><th>{tr('Project name')}</th><td>{reportData.project || tr('Not specified')}</td><th>{tr('Structural element')}</th><td>{tr(reportElement)}</td></tr>
        <tr><th>{tr('Location / Grid')}</th><td>{reportData.location || tr('Not specified')}</td><th>{tr('Inspection date')}</th><td>{reportDateText}</td></tr>
        <tr><th>{tr('Drawing number')}</th><td>{reportData.drawing || tr('Not specified')}</td><th>{tr('Drawing revision')}</th><td>{reportData.revision || tr('Not specified')}</td></tr>
        <tr><th>{tr('Checklist template')}</th><td>{reportTemplateName}</td><th>{tr('Report design')}</th><td>{tr(reportLayout)}</td></tr>
        <tr><th>{tr('Inspector')}</th><td colSpan="3">{reportData.inspector || tr('Not specified')}</td></tr>
      </tbody></table></section>

      <section className="print-section"><h2>{tr('2. INSPECTION SUMMARY')}</h2><table className="print-summary-table"><thead><tr><th>{tr('Total items')}</th><th>{tr('OK')}</th><th>{tr('Not OK')}</th><th>{tr('Pending')}</th><th>{tr('N/A')}</th><th>{tr('Progress')}</th></tr></thead><tbody><tr><td>{reportItems.length}</td><td>{reportCounts.ok}</td><td>{reportCounts.failed}</td><td>{reportCounts.pending}</td><td>{reportCounts.na}</td><td>{reportProgress}%</td></tr></tbody></table></section>

      <section className="print-section print-checklist-section"><h2>{reportChecklistNumber}. {tr(reportElement).toUpperCase()} {tr('INSPECTION CHECKLIST')}</h2><table className="print-checklist-table"><thead><tr>
        <th className="print-no">{tr('No.')}</th><th>{tr('Inspection requirement')}</th><th className="print-status">{tr('Status')}</th>
      </tr></thead><tbody>
        {reportChecklistGroups.map(group => <Fragment key={`group-${group.category}-${group.items[0]?.index}`}>
          <tr className="print-category-heading" key={`category-${group.category}-${group.items[0]?.index}`}><th colSpan="3" scope="rowgroup">{group.category}</th></tr>
          {group.items.map(({ item, index }) => <tr className={`print-checklist-item print-checklist-item-${String(item.status || 'Pending').toLowerCase().replace(' ', '-')}`} key={item.id}>
            <td className="print-no">{String(index + 1).padStart(2, '0')}</td>
            <td className="print-requirement-cell">
              <strong>{item.requirement || tr('Not specified')}</strong>
              {item.criteria && <div className="print-criteria">{item.criteria}</div>}
              {item.subChecks?.length > 0 && <ul className="print-subchecks">{item.subChecks.map(check => <li key={check.id}><span className={`print-subcheck-mark${check.checked ? ' is-checked' : ''}`}>{check.checked ? '✓' : ''}</span>{check.label}</li>)}</ul>}
            </td>
            <td className={`print-status print-status-${String(item.status || 'Pending').toLowerCase().replace(' ', '-')}`}>{tr(item.status || 'Pending')}</td>
          </tr>)}
        </Fragment>)}
      </tbody></table></section>

      <section className="print-section print-evidence-section"><h2>{reportEvidenceNumber}. {tr('PHOTO EVIDENCE REGISTER')}</h2>{sampleReportProfile && reportData.sampleEvidenceIntro && <p className="print-sample-evidence-intro">{tr(reportData.sampleEvidenceIntro)}</p>}{reportEvidenceItems.length > 0 ? <div className="print-evidence-register">
        {reportEvidenceItems.map(({ item, index, observation, comments, actions, legacyAction, photoIds }) => <article className="print-evidence-entry" data-photo-count={photoIds.length} key={`evidence-${item.id}`}>
          <header className="print-evidence-reference"><div><strong>{tr('ITEM')} {String(index + 1).padStart(2, '0')}</strong><span>{item.category || tr('GENERAL')}</span></div><p>{item.requirement || tr('Not specified')}</p></header>
          {photoIds.length > 0 && <div className="print-photo-grid" data-photo-count={photoIds.length}>
            {photoIds.map(id => {
              const photo = reportPhotos[id]
              const evidenceType = photo?.evidenceType
              return <figure className="print-photo" key={id}>
                {photo?.printUrl ? <img src={photo.printUrl} alt={photo.caption || tr('Inspection evidence')} onError={event => {
                  event.currentTarget.hidden = true
                  event.currentTarget.parentElement.querySelector('.print-photo-unavailable')?.removeAttribute('hidden')
                }} /> : <span className="print-photo-unavailable">{tr('Photo unavailable')}</span>}
                {photo?.printUrl && <figcaption>{photo.caption ? translate(photo.caption, language) : tr('Inspection evidence')}{(evidenceType === 'Before' || evidenceType === 'After') && <span className="print-photo-type">{tr(evidenceType)}</span>}</figcaption>}
                {photo?.printUrl && <small className="print-photo-unavailable" hidden>{tr('Photo unavailable')}</small>}
              </figure>
            })}
          </div>}
          {(observation || comments || actions.length > 0 || legacyAction) && <div className="print-evidence-copy">
            {observation && <p className="print-observation"><strong>{tr('Observation:')}</strong> {observation}</p>}
            {comments && <p className="print-observation print-observation-comment"><strong>{tr('Comment:')}</strong> {comments}</p>}
            {actions.map((action, actionIndex) => <p className="print-corrective-action" key={action.id || `${item.id}-action-${actionIndex}`}><strong>{tr('Corrective Action')}{action.status ? ` (${tr(action.status)})` : ''}:</strong> {action.description || '—'}{action.responsiblePerson ? ` · ${tr('Responsible:')} ${action.responsiblePerson}` : ''}{action.dueDate ? ` · ${tr('Due:')} ${action.dueDate}` : ''}</p>)}
            {legacyAction && <p className="print-corrective-action"><strong>{tr('Corrective Action')}:</strong> {legacyAction}</p>}
          </div>}
        </article>)}
      </div> : <p className="print-evidence-empty">{tr('No photo evidence, observations, comments or corrective actions recorded.')}</p>}</section>

      <section className="print-section print-signoff-section">
        <section className="print-note"><strong>{tr('Inspection note')}</strong><p>{reportData.inspectionNote ? tr(reportData.inspectionNote) : tr('Verify all requirements against the latest approved drawings, project specifications and applicable inspection criteria. This checklist is a recording tool and does not replace project-specific technical approval.')}</p></section>
        <h2>{reportSignoffNumber}. {tr('INSPECTION SIGN-OFF')}</h2><table className="print-sign-table"><thead><tr><th>{tr('Inspector')}</th><th>{tr('Contractor representative')}</th><th>{tr('Engineer')}</th></tr></thead><tbody>
        <tr><td>{reportData.inspector || ' '}</td><td>{reportData.contractor || ' '}</td><td>{reportData.engineer || ' '}</td></tr>
        <tr><td>{tr('Signature: __________________')}</td><td>{tr('Signature: __________________')}</td><td>{tr('Signature: __________________')}</td></tr>
        <tr><td>{tr('Date: _______________________')}</td><td>{tr('Date: _______________________')}</td><td>{tr('Date: _______________________')}</td></tr>
      </tbody></table></section>

      <footer className="print-footer">{tr('ConcreteCheck · Concrete Pre-Pour Inspection Report')}</footer>
    </article>
  </>
}
