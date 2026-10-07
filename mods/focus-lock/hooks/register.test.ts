import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const START = 1_800_000_000_000
const USAGE = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
const BAND = {
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100 } as never,
}

// The world beneath the mod. `verdict` is what the judge model answers.
const world = (on: On, verdict: () => string | null) => {
  const seen = { entered: [] as string[], judged: [] as string[], toasts: [] as string[], played: 0, status: '' as string | undefined }
  const clock = mock.clock(on, { now: START })
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.status', (_$, e) => {
    seen.status = e.text

    return { value: undefined }
  })
  on('ui.toast', (_$, e) => {
    seen.toasts.push(e.text)

    return { value: undefined }
  })
  on('audio.play', () => {
    seen.played += 1

    return { value: undefined }
  })
  on('model.complete', (_$, e) => {
    seen.judged.push(e.prompt)
    const text = verdict()

    return {
      value:
        text === null
          ? { isAnswered: false as const, reason: 'aborted' as const, usage: USAGE }
          : { isAnswered: true as const, text, usage: USAGE },
    }
  })
  on('prompt.submit', (_$, e) => {
    seen.entered.push(e.text)

    return { text: e.text }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))

  return { seen, clock }
}

const typed = (text: string) => ({ text, wait: false, origin: { kind: 'composer' } }) as never
const focus = (args: string) =>
  ({ command: 'sprint', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } }) as never

test('a sprint holds an off-task prompt and lets an on-task one through', async ($, on) => {
  let answer = 'OFF'
  const { seen } = world(on, () => answer)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

  const started = await $.command.run(focus('25 write the sales page'))
  expect(started.text).toContain('25 minutes')
  expect(seen.status).toBe('Focus 25:00 | write the sales page')

  const off = await $.prompt.submit(typed('what should I name my dog'))
  expect(off.drop).toContain('Focus lock')
  expect(seen.entered).toEqual([])
  expect(seen.judged[0]).toContain('write the sales page')

  answer = 'ON'
  const onTask = await $.prompt.submit(typed('tighten the headline'))
  expect(onTask.text).toBe('tighten the headline')
  expect(seen.entered).toEqual(['tighten the headline'])
})

test('!! pushes a prompt through, slash commands pass, and a dead judge never blocks', async ($, on) => {
  let answer: string | null = 'OFF'
  const { seen } = world(on, () => answer)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await $.command.run(focus('ship the mods'))

  await $.prompt.submit(typed('!! check my email'))
  await $.prompt.submit(typed('/help'))
  expect(seen.entered).toEqual(['check my email', '/help'])
  expect(seen.judged).toEqual([])

  answer = null
  await $.prompt.submit(typed('anything at all'))
  expect(seen.entered).toEqual(['check my email', '/help', 'anything at all'])
})

test('the timer ends the sprint, chimes, and offers the held prompts', async ($, on) => {
  const { seen, clock } = world(on, () => 'OFF')
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await $.command.run(focus('2 outline the video'))
  await $.prompt.submit(typed('book a flight'))

  await clock.advance(61_000)
  expect(seen.status).toBe('Focus 00:59 | outline the video')

  await clock.advance(60_000)
  expect(seen.status).toBeUndefined()
  expect(seen.played).toBe(1)
  expect(seen.toasts.at(-1)).toContain('1 held prompt is waiting')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'focus-lock', surface, ...BAND })
    expect(await ui.find({ type: 'Text', text: /book a flight/ })).toBeDefined()
    await ui.unmount()
  }

  // Nothing is locked once the sprint is over.
  await $.prompt.submit(typed('book a flight'))
  expect(seen.entered).toEqual(['book a flight'])
})

test('Send on a held prompt submits it and takes it off the list', async ($, on) => {
  const { seen } = world(on, () => 'OFF')
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await $.command.run(focus('10 edit the reel'))
  await $.prompt.submit(typed('plan my weekend'))
  await $.prompt.submit(typed('research standing desks'))
  const stopped = await $.command.run(focus('stop'))
  expect(stopped.text).toContain('ended')
  expect(seen.played).toBe(0)

  const ui = await $.ui.mount({ plugin: 'focus-lock', surface: 'terminal', ...BAND })
  await ui.press({ key: 'send-0' })
  expect(seen.entered).toEqual(['plan my weekend'])
  expect(await ui.find({ type: 'Text', text: /plan my weekend/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /research standing desks/ })).toBeDefined()
  await ui.unmount()
})
