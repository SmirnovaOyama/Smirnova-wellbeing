import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react'

/** The thumbnail's box on screen, read at the moment it was clicked. */
interface Box {
  left: number
  top: number
  width: number
  height: number
}

interface ZoomRequest {
  src: string
  alt: string
  from: Box
  /** Focus goes back here when the overlay closes. */
  trigger: HTMLElement | null
}

const ImageViewerContext = createContext<((request: ZoomRequest) => void) | null>(null)

// Opening is split across three nested boxes — one carries the sideways
// travel, one the vertical, one the growth — and each runs its own curve over
// its own duration. Two different rates on two axes is what bends the path:
// the picture rises out of the note along an arc rather than sliding down the
// straight line between the two boxes. Nothing overshoots — every control
// point below stays inside [0, 1].
const ENTER = {
  x: 'transform 400ms cubic-bezier(0.22, 1, 0.36, 1)',
  y: 'transform 500ms cubic-bezier(0.16, 1, 0.3, 1)',
  scale: 'transform 440ms cubic-bezier(0.33, 1, 0.68, 1)',
}

// Folding back is quicker and leans the other way — slow to leave, fast to
// arrive, so the picture drops into the note rather than drifting into it.
const EXIT = {
  x: 'transform 260ms cubic-bezier(0.64, 0, 0.78, 0.5)',
  y: 'transform 220ms cubic-bezier(0.5, 0, 0.9, 0.45)',
  scale: 'transform 240ms cubic-bezier(0.55, 0, 0.85, 0.4)',
}

/** Long enough for the slowest leg of EXIT to land. Kept in step with the
 *  `veil-out` duration in App.css, which fades this whole subtree out. */
const EXIT_MS = 280

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function place(el: HTMLElement, transform: string, transition: string | null) {
  el.style.transition = transition ?? 'none'
  el.style.transform = transform
}

/** Pins an element to wherever it happens to be right now, so the next
 *  transition sets off from there instead of snapping back to the start
 *  first — which is what closing mid-flight would otherwise look like. */
function freeze(el: HTMLElement) {
  const { transform } = getComputedStyle(el)
  el.style.transition = 'none'
  el.style.transform = transform === 'none' ? '' : transform
  void el.offsetWidth
}

function Lightbox({ request, onClose }: { request: ZoomRequest; onClose: () => void }) {
  const xRef = useRef<HTMLDivElement>(null)
  const yRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const veilRef = useRef<HTMLDivElement>(null)
  // The transform that maps the full-size picture back down onto the
  // thumbnail. Measured once the image has a size of its own; null until then,
  // and closing before that means there is nothing to fold back into.
  const foldRef = useRef<{ dx: number; dy: number; scale: number } | null>(null)
  const closingRef = useRef(false)
  const [closing, setClosing] = useState(false)

  useLayoutEffect(() => {
    const img = imgRef.current
    const x = xRef.current
    const y = yRef.current
    if (!img || !x || !y) return

    let cancelled = false

    function start() {
      if (cancelled || !img || !x || !y) return
      // Measure from a known rest state. An earlier run of this effect —
      // StrictMode invokes it twice in development — leaves the fold transform
      // on these boxes, and getBoundingClientRect reports the transformed box,
      // so without this the second run measures the thumbnail and computes a
      // fold of nothing.
      place(x, '', null)
      place(y, '', null)
      place(img, '', null)
      const to = img.getBoundingClientRect()
      // Nothing laid out yet — the `load` handler below will come back to this.
      if (to.width < 1 || to.height < 1) return

      const fold = {
        dx: request.from.left + request.from.width / 2 - (to.left + to.width / 2),
        dy: request.from.top + request.from.height / 2 - (to.top + to.height / 2),
        scale: request.from.width / to.width,
      }
      foldRef.current = fold
      // Held invisible by the stylesheet until here: an image that finishes
      // decoding a frame before this runs would otherwise flash full-size in
      // the middle of the screen and only then jump back to its thumbnail.
      img.style.opacity = '1'
      if (prefersReducedMotion()) return

      place(x, `translateX(${fold.dx}px)`, null)
      place(y, `translateY(${fold.dy}px)`, null)
      place(img, `scale(${fold.scale})`, null)
      // Flush that starting state into the computed style. Without the read the
      // three assignments below would coalesce with the three above and the
      // browser would have nothing to transition away from.
      void x.offsetWidth
      place(x, 'translateX(0px)', ENTER.x)
      place(y, 'translateY(0px)', ENTER.y)
      place(img, 'scale(1)', ENTER.scale)
    }

    // The thumbnail put the same URL in the cache, so this is normally already
    // decoded and `start` runs before the first paint.
    if (img.complete && img.naturalWidth > 0) start()
    else img.addEventListener('load', start)

    return () => {
      cancelled = true
      img.removeEventListener('load', start)
    }
  }, [request])

  // A rotation changes the picture's size and the note's position underneath
  // it, and the fold measured at open now points somewhere that no longer
  // exists. The opening flight is landed first so the rect below is the
  // settled one rather than one read through a transform in mid-air.
  useEffect(() => {
    function remeasure() {
      const img = imgRef.current
      const x = xRef.current
      const y = yRef.current
      const thumb = request.trigger?.querySelector('img') ?? request.trigger
      if (!img || !x || !y || !thumb || !foldRef.current || closingRef.current) return

      place(x, 'translateX(0px)', null)
      place(y, 'translateY(0px)', null)
      place(img, 'scale(1)', null)
      const to = img.getBoundingClientRect()
      const from = thumb.getBoundingClientRect()
      if (to.width < 1 || from.width < 1) return

      foldRef.current = {
        dx: from.left + from.width / 2 - (to.left + to.width / 2),
        dy: from.top + from.height / 2 - (to.top + to.height / 2),
        scale: from.width / to.width,
      }
    }

    window.addEventListener('resize', remeasure)
    return () => window.removeEventListener('resize', remeasure)
  }, [request])

  const close = useCallback(() => {
    if (closingRef.current) return
    closingRef.current = true
    setClosing(true)

    const img = imgRef.current
    const x = xRef.current
    const y = yRef.current
    const fold = foldRef.current
    if (!img || !x || !y || !fold || prefersReducedMotion()) {
      onClose()
      return
    }

    freeze(x)
    freeze(y)
    freeze(img)
    place(x, `translateX(${fold.dx}px)`, EXIT.x)
    place(y, `translateY(${fold.dy}px)`, EXIT.y)
    place(img, `scale(${fold.scale})`, EXIT.scale)
    window.setTimeout(onClose, EXIT_MS)
  }, [onClose])

  useEffect(() => {
    // `body` is the scrolling box here (see index.css), so this is what pins
    // the page behind the overlay — and keeps the thumbnail the picture has to
    // fold back into where it was measured.
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // The overlay holds no controls of its own — a click anywhere on it closes
    // it, and so does Escape — so focus goes to the overlay itself. It is not
    // in the tab order (tabIndex -1); this is only so the key handler has
    // somewhere to sit and so focus is not left on a thumbnail behind it.
    veilRef.current?.focus()

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        close()
      } else if (e.key === 'Tab') {
        // Nothing behind the overlay is reachable while it is up.
        e.preventDefault()
        veilRef.current?.focus()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [close])

  return (
    <div
      ref={veilRef}
      className={`lightbox${closing ? ' is-closing' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={request.alt ? `${request.alt} — enlarged. Press Escape to close.` : 'Enlarged image. Press Escape to close.'}
      tabIndex={-1}
      onClick={(e) => {
        e.stopPropagation()
        close()
      }}
    >
      <div className="lightbox-x" ref={xRef}>
        <div className="lightbox-y" ref={yRef}>
          <img
            ref={imgRef}
            className="lightbox-image"
            src={request.src}
            alt={request.alt}
            // Nothing to fold out of if it never arrives — show the alt text
            // so the overlay is not simply blank.
            onError={(e) => {
              e.currentTarget.style.opacity = '1'
            }}
          />
        </div>
      </div>
    </div>
  )
}

/** Holds the one overlay the page needs, and hands the notes below it a way to
 *  open it. Rendered as a sibling of the page rather than inside it, so the
 *  overlay is not caught by the page's own click-to-dismiss handler. */
export function ImageViewerProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ZoomRequest | null>(null)
  const triggerRef = useRef<HTMLElement | null>(null)

  const open = useCallback((next: ZoomRequest) => {
    if (triggerRef.current) triggerRef.current.style.visibility = ''
    triggerRef.current = next.trigger
    // The overlay's veil is not opaque, so without this the thumbnail shows
    // through underneath the copy flying out of it — two of the same picture,
    // which gives the whole trick away.
    if (next.trigger) next.trigger.style.visibility = 'hidden'
    setRequest(next)
  }, [])

  const close = useCallback(() => {
    const trigger = triggerRef.current
    triggerRef.current = null
    if (trigger) {
      // Restored before the focus call, and only now: the fold-back lands on
      // this box, so it has to stay out of the way until it gets there.
      trigger.style.visibility = ''
      // Focus moves back before the overlay goes, so the browser never has to
      // fall back to `body` — a keyboard walk through the log picks up where
      // it left off.
      trigger.focus()
    }
    setRequest(null)
  }, [])

  return (
    <ImageViewerContext.Provider value={open}>
      {children}
      {request && <Lightbox request={request} onClose={close} />}
    </ImageViewerContext.Provider>
  )
}

/** An image inside a note. Zoomable ones are wrapped in a button so a keyboard
 *  and a screen reader can reach the enlargement too; the tooltip renders the
 *  plain image, since it is `pointer-events: none` and vanishes on the way to
 *  it anyway. */
export function NoteImage({ src, alt, zoomable }: { src: string; alt: string; zoomable: boolean }) {
  const open = useContext(ImageViewerContext)
  const image = <img className="note-image" src={src} alt={alt} loading="lazy" />

  if (!zoomable || !open) return image

  function handleClick(e: MouseEvent<HTMLButtonElement>) {
    e.stopPropagation()
    // The button can be wider than the picture — a tall image is capped by its
    // own max-height — so measure the image itself or the zoom would grow out
    // of the wrong box.
    const el = e.currentTarget.querySelector('img') ?? e.currentTarget
    const rect = el.getBoundingClientRect()
    if (rect.width < 1 || rect.height < 1) return
    open?.({
      src,
      alt,
      from: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      trigger: e.currentTarget,
    })
  }

  return (
    <button
      type="button"
      className="note-image-button"
      aria-label={alt ? `Enlarge image: ${alt}` : 'Enlarge image'}
      onClick={handleClick}
    >
      {image}
    </button>
  )
}
