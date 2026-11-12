import { useEffect, useState } from 'react'
import { createPhotoUrl, getPhotos, revokePhotoUrl } from '../storage/mediaDb.js'

const STATUSES = ['Pending', 'OK', 'Not OK', 'N/A']
const ACTION_STATUSES = ['Open', 'In Progress', 'Completed']
const EVIDENCE_TYPES = ['Before', 'After', 'General Inspection']
const PHOTO_CAPTIONS = [
  'Drawing & Grid Layout',
  'Slab Formwork',
  'Reinforcement Arrangement',
  'Concrete Cover Blocks',
  'Embedded Items',
  'Construction Joints',
  'Concrete Placement Readiness',
]
const CUSTOM_CAPTION = 'Other / Custom Caption'

function getCaptionChoice(caption) {
  if (PHOTO_CAPTIONS.includes(caption)) return caption
  return caption ? CUSTOM_CAPTION : ''
}


export function SubCheckList({ subChecks = [], onChange, compact = false, status = 'Pending' }) {
  if (!subChecks.length) return null
  const completed = subChecks.filter(check => check.checked).length
  return <fieldset className={`subcheck-list${compact ? ' subcheck-list-compact' : ''}`}>
    <legend>Quick checks <span>{completed}/{subChecks.length}{status === 'N/A' ? ' · optional' : ''}</span></legend>
    {subChecks.map(check => <label className="subcheck-option" key={check.id}>
      <input type="checkbox" checked={check.checked} onChange={event => onChange(check.id, event.target.checked)} />
      <span>{check.label}</span>
    </label>)}
  </fieldset>
}

export default function ChecklistItemCard({ item, number, showCriteria, onItemChange, onSubCheckChange, onNotesChange, onAddAction, onEditAction, onRemoveAction, onAddEvidence, onRemoveEvidence, onEditEvidence, onRemove }) {
  const [photos, setPhotos] = useState([])
  const [captionChoices, setCaptionChoices] = useState({})
  const [photoError, setPhotoError] = useState('')
  useEffect(() => {
    let active = true
    let urls = []
    getPhotos(item.mediaIds || []).then(records => {
      if (!active) return
      urls = records.map(photo => ({ ...photo, previewUrl: createPhotoUrl(photo.previewBlob || photo.originalBlob) }))
      setCaptionChoices(Object.fromEntries(urls.map(photo => [photo.id, getCaptionChoice(photo.caption)])))
      setPhotos(urls)
      
    }).catch(error => setPhotoError(error.message))
    return () => { active = false; urls.forEach(photo => revokePhotoUrl(photo.previewUrl)) }
  }, [item.mediaIds])
  const openActions = (item.actions || []).filter(action => action.status !== 'Completed').length
  function updateCaption(photoId, caption) {
  setPhotos(current => current.map(photo => photo.id === photoId ? { ...photo, caption } : photo))
  onEditEvidence(photoId, 'caption', caption)
}
  return <article className={`checklist-row checklist-row-expanded item-card status-card-${item.status.toLowerCase().replace(' ', '-')}`}>
    <div className="item-card-main">
      <div className="item-number">ITEM {String(number).padStart(2, '0')}</div>
      <details className="item-section category-editor-section"><summary>Edit category <span>{item.category || 'GENERAL'}</span></summary><div className="item-section-body"><label className="field-label">Category<input aria-label="Category" value={item.category} onChange={e => onItemChange('category', e.target.value)} placeholder="Category (e.g. FORMWORK)" /></label></div></details>
      <label className="field-label">Inspection item<textarea aria-label="Inspection requirement" value={item.requirement} onChange={e => onItemChange('requirement', e.target.value)} placeholder="Inspection requirement" rows="2" /></label>
      {showCriteria && <label className="field-label criteria-field">Acceptance criteria<textarea aria-label="Acceptance criteria" value={item.criteria} onChange={e => onItemChange('criteria', e.target.value)} placeholder="Acceptance criteria / inspection reference" rows="2" /></label>}
      <SubCheckList subChecks={item.subChecks || []} onChange={onSubCheckChange} status={item.status} />
    </div>
    <div className="status-cell"><label className="field-label">Status<select className={`status-select status-${item.status.toLowerCase().replace(' ', '-')}`} value={item.status} onChange={e => onItemChange('status', e.target.value)}>{STATUSES.map(status => <option key={status}>{status}</option>)}</select></label></div>
    <div className="item-card-sections">
      <details className="item-section"><summary>Notes <span>{item.notes?.observations || item.notes?.comments ? '• filled' : 'Add notes'}</span></summary><div className="item-section-body"><label className="field-label">Inspection observations<textarea value={item.notes?.observations ?? item.remarks ?? ''} onChange={e => onNotesChange('observations', e.target.value)} rows="2" placeholder="Record site observations" /></label><label className="field-label">General comments<textarea value={item.notes?.comments || ''} onChange={e => onNotesChange('comments', e.target.value)} rows="2" placeholder="Additional comments" /></label></div></details>
            <details className="item-section">
        <summary>Media <span>{photos.length} photo{photos.length === 1 ? '' : 's'}</span></summary>
        <div className="item-section-body">
          <div className="media-pickers">
            <label className="secondary-button media-picker">Take photo<input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" capture="environment" onChange={async e => { await Promise.all([...(e.target.files || [])].map(onAddEvidence)); e.target.value = '' }} /></label>
            <label className="secondary-button media-picker">Choose from device<input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple onChange={async e => { await Promise.all([...(e.target.files || [])].map(onAddEvidence)); e.target.value = '' }} /></label>
          </div>
          {photoError && <p className="media-error">{photoError}</p>}
          <div className="evidence-grid">
            {photos.map(photo => {
              const captionChoice = captionChoices[photo.id] ?? getCaptionChoice(photo.caption)
              return <div className="evidence-item" key={photo.id}>
                <img src={photo.previewUrl} alt={photo.caption || 'Inspection evidence'} onError={e => { e.currentTarget.hidden = true; if (e.currentTarget.nextElementSibling) e.currentTarget.nextElementSibling.hidden = false }} />
                <span className="media-unavailable" hidden>Preview unavailable; the original file remains saved.</span>
                <label className="field-label">Photo caption<select value={captionChoice} onChange={e => {
                  const choice = e.target.value
                  setCaptionChoices(current => ({ ...current, [photo.id]: choice }))
                  if (choice !== CUSTOM_CAPTION) updateCaption(photo.id, choice)
                }}>
                  <option value="">Select a caption</option>
                  {PHOTO_CAPTIONS.map(caption => <option key={caption} value={caption}>{caption}</option>)}
                  <option value={CUSTOM_CAPTION}>{CUSTOM_CAPTION}</option>
                </select></label>
                {captionChoice === CUSTOM_CAPTION && <label className="field-label">Custom caption<input defaultValue={photo.caption || ''} onBlur={e => updateCaption(photo.id, e.currentTarget.value)} placeholder="Enter a short photo caption" /></label>}
                <label className="field-label">Evidence type<select value={photo.evidenceType || 'General Inspection'} onChange={e => { const evidenceType = e.target.value; setPhotos(current => current.map(entry => entry.id === photo.id ? { ...entry, evidenceType } : entry)); onEditEvidence(photo.id, 'evidenceType', evidenceType) }}>{EVIDENCE_TYPES.map(type => <option key={type}>{type}</option>)}</select></label>
                <button type="button" className="danger-button" onClick={() => onRemoveEvidence(photo.id)}>Remove photo</button>
              </div>
            })}
          </div>
        </div>
      </details>
      <details className="item-section"><summary>Corrective actions <span>{openActions} open · {(item.actions || []).length} total</span></summary><div className="item-section-body"><div className="actions-list">{(item.actions || []).map((action, index) => <div className="action-editor" key={action.id}><strong>Action {index + 1}</strong><label className="field-label">Description<textarea value={action.description} onChange={e => onEditAction(action.id, 'description', e.target.value)} rows="2" placeholder="Corrective action" /></label><div className="action-fields"><label className="field-label">Responsible person<input value={action.responsiblePerson} onChange={e => onEditAction(action.id, 'responsiblePerson', e.target.value)} placeholder="Name" /></label><label className="field-label">Due date<input type="date" value={action.dueDate} onChange={e => onEditAction(action.id, 'dueDate', e.target.value)} /></label><label className="field-label">Status<select value={action.status} onChange={e => onEditAction(action.id, 'status', e.target.value)}>{ACTION_STATUSES.map(status => <option key={status}>{status}</option>)}</select></label></div><button type="button" className="danger-button" onClick={() => onRemoveAction(action.id)}>Remove action</button></div>)}</div><button type="button" className="secondary-button" onClick={onAddAction}>+ Add action</button></div></details>
    </div>
    <div className="remove-cell"><button type="button" className="danger-button" onClick={onRemove}>Remove item</button></div>
  </article>
}
