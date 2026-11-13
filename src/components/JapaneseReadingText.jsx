import { useState } from 'react'
import { kanjiReadings } from '../i18n.js'

const terms = Object.keys(kanjiReadings).sort((a, b) => b.length - a.length)
const termPattern = new RegExp(`(${terms.join('|')})`, 'g')

/** Adds optional, screen-only readings without changing the source string. */
export default function JapaneseReadingText({ children, language = 'en', showAll = false }) {
  const [override, setOverride] = useState(null)
  if (language !== 'ja' || typeof children !== 'string' || !children) return children
  const visible = override ?? showAll
  const pieces = children.split(termPattern)
  return pieces.map((piece, index) => {
    const reading = kanjiReadings[piece]
    if (!reading) return piece
    const toggle = event => {
      event.preventDefault()
      event.stopPropagation()
      setOverride(current => !(current ?? showAll))
    }
    return <span
      className={`kanji-reading-term${visible ? ' is-expanded' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={`${piece}${visible ? '、読み方を隠す' : `、${reading}、読み方を表示`}`}
      aria-expanded={visible}
      key={`${index}-${piece}`}
      onClick={toggle}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          event.stopPropagation()
          toggle()
        }
      }}
    ><span>{piece}</span>{visible && <small className="kanji-reading">（{reading}）</small>}</span>
  })
}
