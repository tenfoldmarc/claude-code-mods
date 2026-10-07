import type { Register } from 'claude-code'

const DONE = 'sounds/done.wav'
const ERROR = 'sounds/error.wav'

const spell = (ms: number): string => {
  const seconds = Math.round(ms / 1000)
  const minutes = Math.floor(seconds / 60)

  return minutes === 0 ? `${seconds}s` : `${minutes}m ${seconds % 60}s`
}

export const register: Register = (on, options) => {
  const minMs = Math.max(0, Number(options.min_seconds ?? 20)) * 1000
  const gain = Math.min(4, Math.max(0, Number(options.volume ?? 1)))

  on('turn.complete', async ($, e, next) => {
    // A subagent's turn is not the job the person is waiting on.
    const isTheirs = e.agentId === undefined && !e.isAborted

    if (isTheirs && e.durationMs >= minMs) {
      const hasFailed = e.reason === 'error'
      $.ui.toast(
        hasFailed
          ? `Claude hit an error after ${spell(e.durationMs)}`
          : `Done in ${spell(e.durationMs)}`,
        { timeoutMs: 8000 },
      )

      if (gain > 0) {
        // Not awaited: the turn should not wait on the clip. A machine with no
        // player (Linux, Windows) plays nothing, and the toast still shows.
        void $.audio.play({ asset: hasFailed ? ERROR : DONE }, { gain }).catch(() => {})
      }
    }

    return next(e)
  })
}
