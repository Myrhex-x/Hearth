import { useRef } from 'react'
import { cx } from './ui'

/** A thin drag handle. `onDrag` receives the total offset since the drag began. */
export function Resizer({
  axis,
  onDrag,
  onEnd,
  className
}: {
  axis: 'x' | 'y'
  onDrag: (delta: number) => void
  onEnd: () => void
  className?: string
}) {
  const start = useRef(0)
  return (
    <div
      className={cx('resizer', `resizer-${axis}`, className)}
      onPointerDown={(e) => {
        e.preventDefault()
        ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
        start.current = axis === 'x' ? e.clientX : e.clientY
        document.body.classList.add(axis === 'x' ? 'is-resizing-x' : 'is-resizing-y')
      }}
      onPointerMove={(e) => {
        if (!(e.target as HTMLElement).hasPointerCapture(e.pointerId)) return
        onDrag((axis === 'x' ? e.clientX : e.clientY) - start.current)
      }}
      onPointerUp={(e) => {
        ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
        document.body.classList.remove('is-resizing-x', 'is-resizing-y')
        onEnd()
      }}
    />
  )
}
