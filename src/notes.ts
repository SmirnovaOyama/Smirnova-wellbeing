// The grammar of a note, kept apart from the component that renders it so
// both can be read in one place — and so Markdown.tsx exports nothing but a
// component.
//
// A deliberately small subset of Markdown: images — the reason this exists at
// all, since pasting one writes `![](…)` into the note — plus links and inline
// emphasis.

export function inlinePattern(): RegExp {
  // Fresh each call: a module-level /g regex carries lastIndex between calls.
  return /!\[([^\]\n]*)\]\(([^)\s]+)\)|\[([^\]\n]+)\]\(([^)\s]+)\)|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|`([^`\n]+)`/g
}

// The image arm of the pattern above, on its own, and kept next to it so the
// two stay in step. The bar tooltip reports a note's picture rather than
// rendering it, so it needs to find one and to read the note without it.
function imagePattern(): RegExp {
  return /!\[[^\]\n]*\]\([^)\s]+\)/g
}

export function hasImage(text: string): boolean {
  return imagePattern().test(text)
}

export function stripImages(text: string): string {
  return text.replace(imagePattern(), '')
}

/** Same-origin paths and http(s) only — this is what keeps `javascript:` and
 *  `data:` URLs from being reachable through a note. */
export function safeUrl(url: string): string | null {
  if (url.startsWith('/')) return url
  try {
    const { protocol } = new URL(url)
    return protocol === 'http:' || protocol === 'https:' ? url : null
  } catch {
    return null
  }
}
