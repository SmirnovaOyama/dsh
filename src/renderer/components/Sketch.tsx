/**
 * Small hand-drawn marks for the side panel tabs. The lines wobble a little and overshoot their
 * corners, like a quick pen sketch, but stay in the text colour so the panel keeps to black and white.
 */
const PATHS = {
  // A pencil leaning over a scribbled line, its tip hatched in.
  changes: [
    'M13.4 2.6c1.3.9 2.9 2.5 4 3.9-2.8 2.9-5.6 5.6-8.5 8.6-1.6.6-3.4 1.1-5.3 1.4.3-1.8.7-3.4 1.2-5 2.8-2.9 5.6-5.7 8.3-8.4.4-.4.9-.6 1.5-.3',
    'M11.3 4.9c1.4 1 2.7 2.4 3.8 3.8',
    'M5 11.8c1.2.7 2.3 1.8 3.2 3.1',
    'M4.4 14.3l1.2 1.3M3.9 15.8l.6-1',
    'M10.6 17.6c.8-.9 1.5-.1 2.2.4.7.4 1.2-1.1 2-1 .8.1 1 1.1 1.8.6.5-.3.8-.8 1.3-.9',
  ],
  // A folder drawn in one loose stroke that runs past where it started, with a doubled flap.
  files: [
    'M2.4 8.8c0-1.6-.2-3.2.3-4.3.4-.6 3.4-.5 4.8-.4.9.1 1.2 1.1 1.8 2 .3.4 5.7.1 7.6.4.9.1 1.2.9 1.2 1.7.1 2.6-.1 5.3-.3 7.4-.1.9-.7 1.2-1.6 1.2-4 .2-8.2.3-12.2 0-.9-.1-1.3-.6-1.4-1.4-.2-2.3-.1-4.5.1-6.8.1-.6.2-1 .2-1.3',
    'M2.6 9c4.9-.5 10.2-.1 15.3-.6',
    'M4.6 11.3c1.6-.1 3.2 0 4.8-.1',
  ],
} as const

export function Sketch({ name }: { name: keyof typeof PATHS }) {
  return (
    <svg className="hx-sketch" width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}
