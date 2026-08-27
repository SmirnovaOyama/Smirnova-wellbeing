import { Fragment, type ReactNode } from 'react'
import { NoteImage } from './ImageViewer'
import { inlinePattern, safeUrl } from './notes'

// Everything below builds React elements, never HTML, so there is no innerHTML
// path that would need sanitising. The grammar itself lives in notes.ts.
//
// Newlines are re-emitted as text and left to the container's `white-space`,
// so a note keeps the shape it was typed in — except in the bar tooltip, which
// sets `normal` to fold a note down into a two-line preview.

function renderInline(text: string, lineKey: number, zoomable: boolean): ReactNode[] {
  const nodes: ReactNode[] = []
  const pattern = inlinePattern()
  let last = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index))
    last = match.index + match[0].length

    const key = `${lineKey}-${match.index}`
    const [raw, imageAlt, imageUrl, linkText, linkUrl, bold, italic, code] = match

    if (imageUrl !== undefined) {
      const url = safeUrl(imageUrl)
      nodes.push(url ? <NoteImage key={key} src={url} alt={imageAlt} zoomable={zoomable} /> : raw)
    } else if (linkUrl !== undefined) {
      const url = safeUrl(linkUrl)
      nodes.push(
        url ? (
          <a key={key} className="note-link" href={url} target="_blank" rel="noreferrer noopener">
            {linkText}
          </a>
        ) : (
          raw
        ),
      )
    } else if (bold !== undefined) {
      nodes.push(<strong key={key}>{bold}</strong>)
    } else if (italic !== undefined) {
      nodes.push(<em key={key}>{italic}</em>)
    } else if (code !== undefined) {
      nodes.push(
        <code key={key} className="note-code">
          {code}
        </code>,
      )
    }
  }

  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

/** `zoomable` opts the images in this note into the enlarging overlay — the
 *  log passes it, the tooltip does not. */
export function Markdown({ text, zoomable = false }: { text: string; zoomable?: boolean }) {
  const lines = text.split('\n')
  return (
    <>
      {lines.map((line, i) => (
        <Fragment key={i}>
          {i > 0 && '\n'}
          {renderInline(line, i, zoomable)}
        </Fragment>
      ))}
    </>
  )
}
