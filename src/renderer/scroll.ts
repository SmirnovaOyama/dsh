import { createContext } from 'react'

/** Called before a disclosure opens or closes, so the transcript keeps the clicked row where it is. */
export const HoldScroll = createContext<() => void>(() => {})
