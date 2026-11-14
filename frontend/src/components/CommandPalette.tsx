import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CornerDownLeft, Search } from 'lucide-react'

export interface PaletteItem {
  id: string
  group: string
  label: string
  hint?: string
  icon?: ReactNode
  run: () => void
}

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
  items: PaletteItem[]
}

/** Keyboard-first ⌘K palette: type to filter, ↑/↓ to move, Enter to run, Esc to close. */
export default function CommandPalette({ open, onClose, items }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter((i) => `${i.group} ${i.label} ${i.hint ?? ''}`.toLowerCase().includes(q))
  }, [items, query])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setActive(0)
    const t = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(t)
  }, [open])

  useEffect(() => setActive(0), [query])

  if (!open) return null

  function runItem(item: PaletteItem | undefined) {
    if (!item) return
    onClose()
    item.run()
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      runItem(filtered[active])
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  let lastGroup = ''
  return (
    <div className="ss-palette-backdrop" onMouseDown={onClose} role="presentation">
      <div
        className="ss-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="ss-palette-input-row">
          <Search size={16} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search sections, commands, actions…"
            aria-label="Search commands"
          />
          <kbd>esc</kbd>
        </div>
        <ul className="ss-palette-list" role="listbox">
          {filtered.length === 0 && <li className="ss-palette-empty">No matches for “{query}”</li>}
          {filtered.map((item, idx) => {
            const header = item.group !== lastGroup ? item.group : null
            lastGroup = item.group
            return (
              <li key={item.id} role="none">
                {header && <div className="ss-palette-group">{header}</div>}
                <button
                  type="button"
                  role="option"
                  aria-selected={idx === active}
                  className={`ss-palette-item ${idx === active ? 'active' : ''}`}
                  onMouseEnter={() => setActive(idx)}
                  onClick={() => runItem(item)}
                >
                  <span className="ss-palette-icon">{item.icon}</span>
                  <span className="ss-palette-label">{item.label}</span>
                  {item.hint && <span className="ss-palette-hint">{item.hint}</span>}
                  {idx === active && <CornerDownLeft size={13} className="ss-palette-enter" />}
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
