import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const turn = (durationMs: number, extra: Record<string, unknown> = {}) =>
  ({
    answer: 'ok',
    durationMs,
    isAborted: false,
    turnId: 't1',
    reason: 'answer',
    ...extra,
  }) as never

// The world beneath the mod: records what it played and showed.
const world = (on: On) => {
  const played: string[] = []
  const toasts: string[] = []
  on('audio.play', (_$, e) => {
    played.push(String(e.clip.asset))

    return { value: undefined }
  })
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })
  on('turn.complete', (_$, e) => ({ text: e.answer }))

  return { played, toasts }
}

test('chimes and toasts after a long turn', async ($, on) => {
  const { played, toasts } = world(on)

  await $.turn.complete(turn(95_000))

  expect(played).toEqual(['sounds/done.wav'])
  expect(toasts[0]).toBe('Done in 1m 35s')
})

test('stays quiet after a short turn, an interrupt, or a subagent turn', async ($, on) => {
  const { played, toasts } = world(on)

  await $.turn.complete(turn(3_000))
  await $.turn.complete(turn(95_000, { isAborted: true, reason: 'aborted' }))
  await $.turn.complete(turn(95_000, { agentId: 'a1' }))

  expect(played).toEqual([])
  expect(toasts).toEqual([])
})

test('plays the error sound when the turn ends on an error', async ($, on) => {
  const { played } = world(on)

  await $.turn.complete(turn(40_000, { reason: 'error' }))

  expect(played).toEqual(['sounds/error.wav'])
})

test('volume 0 keeps the toast and drops the sound', { options: { volume: 0 } }, async ($, on) => {
  const { played, toasts } = world(on)

  await $.turn.complete(turn(40_000))

  expect(played).toEqual([])
  expect(toasts).toEqual(['Done in 40s'])
})
