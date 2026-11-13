import { useEffect, useState } from 'react'
import { createPhotoUrl, getPhotos, revokePhotoUrl } from '../storage/mediaDb.js'
import { translate } from '../i18n.js'
import JapaneseReadingText from './JapaneseReadingText.jsx'

const STATUSES = ['Pending', 'OK', 'Not OK', 'N/A']
const ACTION_STATUSES = ['Open', 'In Progress', 'Completed']
const EVIDENCE_TYPES = ['Before', 'After', 'General Inspection']
const PHOTO_CAPTIONS = [
  'Drawing & Grid Layout',
  'Slab Formwork',
  'Beam Formwork',
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


export function SubCheckList({ subChecks = [], onChange, compact = false, status = 'Pending', language = 'en', showAllReadings = false, editable = false, onLabelChange, onAdd, onRemove }) {
  const tr = value => translate(value, language)
  const readingText = value => <JapaneseReadingText language={language} showAll={showAllReadings}>{value}</JapaneseReadingText>
  if (!subChecks.length && !editable) return null
  const completed = subChecks.filter(check => check.checked).length
  return <fieldset className={`subcheck-list${compact ? ' subcheck-list-compact' : ''}`}>
    <legend>{readingText(tr('Quick checks'))} <span>{completed}/{subChecks.length}{status === 'N/A' ? <> · {readingText(tr('optional'))}</> : ''}</span></legend>
    {subChecks.map(check => editable ? <div className="subcheck-option subcheck-option-editable" key={check.id}>
      <input aria-label={check.label || tr('Quick Check label')} type="checkbox" checked={check.checked} onChange={event => onChange(check.id, event.target.checked)} />
      <input className="subcheck-label-editor" value={check.label} onChange={event => onLabelChange(check.id, event.target.value)} placeholder={tr('Quick Check label')} />
      <button type="button" className="remove-quick-check" aria-label={tr('Remove Quick Check')} onClick={() => onRemove(check.id)}>×</button>
    </div> : <label className="subcheck-option" key={check.id}>
      <input type="checkbox" checked={check.checked} onChange={event => onChange(check.id, event.target.checked)} />
      <span>{readingText(check.label)}</span>
    </label>)}
    {editable && <button type="button" className="secondary-button add-quick-check" onClick={onAdd}>+ {readingText(tr('Add Quick Check'))}</button>}
  </fieldset>
}

export default function ChecklistItemCard({ item, number, language = 'en', showAllReadings = false, canReorder = false, canMoveUp = false, canMoveDown = false, onMoveUp, onMoveDown, onDragStart, onDragOver, onDrop, onDragEnd, showCriteria, editableQuickChecks = false, onItemChange, onSubCheckChange, onSubCheckLabelChange, onAddSubCheck, onRemoveSubCheck, onNotesChange, onAddAction, onEditAction, onRemoveAction, onAddEvidence, onRemoveEvidence, onEditEvidence, onRemove }) {
  const tr = value => translate(value, language)
  const readingText = value => <JapaneseReadingText language={language} showAll={showAllReadings}>{value}</JapaneseReadingText>
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
  return <article className={`checklist-row checklist-row-expanded item-card status-card-${item.status.toLowerCase().replace(' ', '-')}${canReorder ? ' item-card-reorderable' : ''}`} onDragOver={canReorder ? onDragOver : undefined} onDrop={canReorder ? onDrop : undefined} onDragEnd={canReorder ? onDragEnd : undefined}>
    <div className="item-card-main">
      <div className="item-number">{readingText(tr('ITEM'))} {String(number).padStart(2, '0')}{canReorder && <div className="item-reorder-controls"><button type="button" className="drag-item-handle" draggable aria-label={tr('Drag to reorder')} title={tr('Drag to reorder')} onDragStart={event => { event.dataTransfer.setData('text/plain', item.id); event.dataTransfer.effectAllowed = 'move'; onDragStart?.(item.id) }}>↕</button><button type="button" onClick={onMoveUp} disabled={!canMoveUp}>{tr('Move up')}</button><button type="button" onClick={onMoveDown} disabled={!canMoveDown}>{tr('Move down')}</button></div>}</div>
      <details className="item-section category-editor-section"><summary>{readingText(tr('Edit category'))} <span>{readingText(item.category || tr('GENERAL'))}</span></summary><div className="item-section-body"><label className="field-label">{readingText(tr('Category'))}<input aria-label={tr('Category')} value={item.category} onChange={e => onItemChange('category', e.target.value)} placeholder={tr('Category (e.g. FORMWORK)')} /></label></div></details>
      <label className="field-label">{readingText(tr('Inspection item'))}<textarea aria-label={tr('Inspection requirement')} value={item.requirement} onChange={e => onItemChange('requirement', e.target.value)} placeholder={tr('Inspection requirement')} rows="2" /></label>
      {showCriteria && <label className="field-label criteria-field">{readingText(tr('Acceptance criteria'))}<textarea aria-label={tr('Acceptance criteria')} value={item.criteria} onChange={e => onItemChange('criteria', e.target.value)} placeholder={tr('Acceptance criteria / inspection reference')} rows="2" /></label>}
      <SubCheckList subChecks={item.subChecks || []} onChange={onSubCheckChange} status={item.status} language={language} showAllReadings={showAllReadings} editable={editableQuickChecks} onLabelChange={onSubCheckLabelChange} onAdd={onAddSubCheck} onRemove={onRemoveSubCheck} />
    </div>
    <div className="status-cell"><label className="field-label">{readingText(tr('Status'))}<select className={`status-select status-${item.status.toLowerCase().replace(' ', '-')}`} value={item.status} onChange={e => onItemChange('status', e.target.value)}>{STATUSES.map(status => <option key={status} value={status}>{tr(status)}</option>)}</select>{language === 'ja' && <small className="reading-status-label">{readingText(tr(item.status))}</small>}</label></div>
    <div className="item-card-sections">
      <details className="item-section"><summary>{readingText(tr('Notes'))} <span>{item.notes?.observations || item.notes?.comments ? tr('• filled') : tr('Add notes')}</span></summary><div className="item-section-body"><label className="field-label">{readingText(tr('Inspection observations'))}<textarea value={item.notes?.observations ?? item.remarks ?? ''} onChange={e => onNotesChange('observations', e.target.value)} rows="2" placeholder={tr('Record site observations')} /></label><label className="field-label">{readingText(tr('General comments'))}<textarea value={item.notes?.comments || ''} onChange={e => onNotesChange('comments', e.target.value)} rows="2" placeholder={tr('Additional comments')} /></label></div></details>
            <details className="item-section">
        <summary>{readingText(tr('Media'))} <span>{photos.length} {readingText(tr('photos'))}</span></summary>
        <div className="item-section-body">
          <div className="media-pickers">
            <label className="secondary-button media-picker">{readingText(tr('Take photo'))}<input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" capture="environment" onChange={async e => { await Promise.all([...(e.target.files || [])].map(onAddEvidence)); e.target.value = '' }} /></label>
            <label className="secondary-button media-picker">{readingText(tr('Choose from device'))}<input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" multiple onChange={async e => { await Promise.all([...(e.target.files || [])].map(onAddEvidence)); e.target.value = '' }} /></label>
          </div>
          {photoError && <p className="media-error">{photoError}</p>}
          <div className="evidence-grid">
            {photos.map(photo => {
              const captionChoice = captionChoices[photo.id] ?? getCaptionChoice(photo.caption)
              return <div className="evidence-item" key={photo.id}>
                <img src={photo.previewUrl} alt={photo.caption || 'Inspection evidence'} onError={e => { e.currentTarget.hidden = true; if (e.currentTarget.nextElementSibling) e.currentTarget.nextElementSibling.hidden = false }} />
                <span className="media-unavailable" hidden>{readingText(tr('Preview unavailable; the original file remains saved.'))}</span>
                <label className="field-label">{readingText(tr('Photo caption'))}<select value={captionChoice} onChange={e => {
                  const choice = e.target.value
                  setCaptionChoices(current => ({ ...current, [photo.id]: choice }))
                  if (choice !== CUSTOM_CAPTION) updateCaption(photo.id, choice)
                }}>
                  <option value="">{tr('Select a caption')}</option>
                  {PHOTO_CAPTIONS.map(caption => <option key={caption} value={caption}>{tr(caption)}</option>)}
                  <option value={CUSTOM_CAPTION}>{tr(CUSTOM_CAPTION)}</option>
                </select></label>
                {language === 'ja' && captionChoice && captionChoice !== CUSTOM_CAPTION && <small className="reading-caption-label">{readingText(tr(captionChoice))}</small>}
                {captionChoice === CUSTOM_CAPTION && <label className="field-label">{readingText(tr('Custom caption'))}<input defaultValue={photo.caption || ''} onBlur={e => updateCaption(photo.id, e.currentTarget.value)} placeholder={tr('Enter a short photo caption')} /></label>}
                <label className="field-label">{readingText(tr('Evidence type'))}<select value={photo.evidenceType || 'General Inspection'} onChange={e => { const evidenceType = e.target.value; setPhotos(current => current.map(entry => entry.id === photo.id ? { ...entry, evidenceType } : entry)); onEditEvidence(photo.id, 'evidenceType', evidenceType) }}>{EVIDENCE_TYPES.map(type => <option key={type} value={type}>{tr(type)}</option>)}</select>{language === 'ja' && <small className="reading-caption-label">{readingText(tr(photo.evidenceType || 'General Inspection'))}</small>}</label>
                <button type="button" className="danger-button" onClick={() => onRemoveEvidence(photo.id)}>{tr('Remove photo')}</button>
              </div>
            })}
          </div>
        </div>
      </details>
      <details className="item-section"><summary>{readingText(tr('Corrective actions'))} <span>{openActions} {readingText(tr('open ·'))} {(item.actions || []).length} {readingText(tr('total'))}</span></summary><div className="item-section-body"><div className="actions-list">{(item.actions || []).map((action, index) => <div className="action-editor" key={action.id}><strong>{readingText(tr('Action'))} {index + 1}</strong><label className="field-label">{readingText(tr('Description'))}<textarea value={action.description} onChange={e => onEditAction(action.id, 'description', e.target.value)} rows="2" placeholder={tr('Corrective action')} /></label><div className="action-fields"><label className="field-label">{readingText(tr('Responsible person'))}<input value={action.responsiblePerson} onChange={e => onEditAction(action.id, 'responsiblePerson', e.target.value)} placeholder={tr('Name')} /></label><label className="field-label">{readingText(tr('Due date'))}<input type="date" value={action.dueDate} onChange={e => onEditAction(action.id, 'dueDate', e.target.value)} /></label><label className="field-label">{readingText(tr('Status'))}<select value={action.status} onChange={e => onEditAction(action.id, 'status', e.target.value)}>{ACTION_STATUSES.map(status => <option key={status} value={status}>{tr(status)}</option>)}</select>{language === 'ja' && <small className="reading-status-label">{readingText(tr(action.status))}</small>}</label></div><button type="button" className="danger-button" onClick={() => onRemoveAction(action.id)}>{tr('Remove action')}</button></div>)}</div><button type="button" className="secondary-button" onClick={onAddAction}>{tr('+ Add action')}</button></div></details>
    </div>
    <div className="remove-cell"><button type="button" className="danger-button" onClick={onRemove}>{tr('Remove item')}</button></div>
  </article>
}
