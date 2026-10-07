import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

// 2026-10-07 at 10:00 in a UTC-4 zone, and the same day at 08:00.
const TEN_AM = Date.UTC(2026, 9, 7, 14, 0, 0)
const EIGHT_AM = Date.UTC(2026, 9, 7, 12, 0, 0)
const BAND = {
  component: 'AbovePrompt' as const,
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100 } as never,
}
const PANE = {
  component: 'Pane' as const,
  requestId: 'today',
  props: { title: 'Today', isFocused: true, bodyColumns: 40, placement: 'dock' } as never,
}

// The world beneath the mod: a clock, a store, a UTC-4 host, a Stripe account.
const world = (on: On, now: number) => {
  const seen = { entered: [] as string[], toasts: [] as string[], played: [] as string[], opened: [] as string[], fetched: [] as string[] }
  const clock = mock.clock(on, { now })
  mock.store(on)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.toast', (_$, e) => {
    seen.toasts.push(e.text)

    return { value: undefined }
  })
  on('audio.play', (_$, e) => {
    seen.played.push(String(e.clip.asset))

    return { value: undefined }
  })
  on('ui.open', (_$, e) => {
    seen.opened.push(e.id)

    return { value: { isPlaced: true as const } }
  })
  on('process.run', (_$, e) => ({
    value: {
      exitCode: 0,
      stdout: e.argv[0] === 'date' ? '-0400\n' : 'Followers: 12,400\nnot a metric line\nEmail list: 4,210\n',
      stderr: '',
    } as never,
  }))
  on('http.fetch', (_$, e) => {
    seen.fetched.push(e.url)
    const second = (ms: number) => Math.floor(ms / 1000)

    return {
      value: {
        status: 200,
        ok: true,
        headers: {},
        text: JSON.stringify({
          has_more: false,
          data: [
            { id: 'txn_3', type: 'charge', amount: 9700, currency: 'usd', created: second(TEN_AM - 3_600_000) },
            { id: 'txn_2', type: 'payout', amount: -5000, currency: 'usd', created: second(TEN_AM - 7_200_000) },
            { id: 'txn_1', type: 'payment', amount: 19700, currency: 'usd', created: second(TEN_AM - 3 * 86_400_000) },
          ],
        }),
      },
    }
  })
  on('prompt.submit', (_$, e) => {
    seen.entered.push(e.text)

    return { text: e.text }
  })

  return { seen, clock }
}

const start = { cwd: '/tmp', surface: 'terminal', isInteractive: true } as const
const typed = (text: string) => ({ text, wait: false, origin: { kind: 'composer' } }) as never
const run = (command: string, args = '') =>
  ({ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } }) as never

test('after the start hour the first three prompts become the tasks, then Claude unlocks', async ($, on) => {
  const { seen } = world(on, TEN_AM)
  await $.session.start(start)

  const band = await $.ui.mount({ plugin: 'daily-command-center', surface: 'terminal', ...BAND })
  expect(await band.find({ type: 'Text', text: /What are your 3 tasks/ })).toBeDefined()
  await band.unmount()

  const first = await $.prompt.submit(typed('record the mods reel'))
  expect(first.drop).toBe('Task 1 of 3 locked in. Now type task 2.')
  await $.prompt.submit(typed('send the launch email'))
  const third = await $.prompt.submit(typed('call the accountant'))
  expect(third.drop).toContain('All three tasks are set')
  expect(seen.entered).toEqual([])
  expect(seen.opened).toEqual(['today', 'today'])

  await $.prompt.submit(typed('now write the email'))
  expect(seen.entered).toEqual(['now write the email'])

  const board = await $.command.run(run('today'))
  expect(board.text).toBe('1. [ ] record the mods reel\n2. [ ] send the launch email\n3. [ ] call the accountant')
})

test('before the start hour nothing is asked; at the hour a toast asks', async ($, on) => {
  const { seen, clock } = world(on, EIGHT_AM)
  await $.session.start(start)

  await $.prompt.submit(typed('early bird work'))
  expect(seen.entered).toEqual(['early bird work'])

  await clock.advance(61 * 60_000)
  expect(seen.toasts.some(text => text.includes('Time to set your 3 tasks'))).toBe(true)
  const held = await $.prompt.submit(typed('- task one\n- task two\n3. task three'))
  expect(held.drop).toContain('All three tasks are set')
  expect((await $.command.run(run('today'))).text).toContain('3. [ ] task three')
})

test('a long message or a question goes through to Claude instead of becoming a task', async ($, on) => {
  const { seen } = world(on, TEN_AM)
  await $.session.start(start)
  const long = 'Wait, for the command center I actually want something different. '.repeat(3)

  await $.prompt.submit(typed(long))
  await $.prompt.submit(typed('what is on my calendar?'))
  await $.prompt.submit(typed('a\nb\nc\nd'))
  expect(seen.entered).toEqual([long, 'what is on my calendar?', 'a\nb\nc\nd'])
  expect(seen.toasts.filter(text => text.includes('still due')).length).toBe(3)
  expect((await $.prompt.submit(typed('record the reel'))).drop).toContain('Task 1 of 3')
})

test('skip lifts the ask for the day, reset brings it back, slash commands always pass', async ($, on) => {
  const { seen } = world(on, TEN_AM)
  await $.session.start(start)

  await $.prompt.submit(typed('/help'))
  await $.command.run(run('today', 'skip'))
  await $.prompt.submit(typed('just let me work'))
  expect(seen.entered).toEqual(['/help', 'just let me work'])

  await $.command.run(run('today', 'reset'))
  expect((await $.prompt.submit(typed('a real task'))).drop).toContain('Task 1 of 3')
})

test(
  'the pane shows the tasks beside Stripe, command and pinned numbers, and checks them off',
  { options: { stripe_key: 'placeholder-key', metrics_command: 'print-my-metrics' } },
  async ($, on) => {
    const { seen } = world(on, TEN_AM)
    await $.session.start(start)
    await $.prompt.submit(typed('one\ntwo\nthree'))
    await $.command.run(run('metric', 'Skool members 312'))

    for (const surface of ['terminal', 'desktop'] as const) {
      const pane = await $.ui.mount({ plugin: 'daily-command-center', surface, ...PANE })
      expect(await pane.find({ key: 'task-1', text: /\[ \] one/ })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: '$97.00' })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: '$294.00' })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: '12,400' })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: '4,210' })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: '312' })).toBeDefined()
      await pane.unmount()
    }

    expect(seen.fetched[0]).toContain('https://api.stripe.com/v1/balance_transactions')

    const pane = await $.ui.mount({ plugin: 'daily-command-center', surface: 'terminal', ...PANE })
    await pane.press({ key: 'task-1' })
    await pane.press({ key: 'task-2' })
    expect(await pane.find({ key: 'task-2', text: /\[x\] two/ })).toBeDefined()
    expect(seen.played).toEqual(['sounds/check.wav', 'sounds/check.wav'])
    await pane.press({ key: 'task-3' })
    expect(seen.played.at(-1)).toBe('sounds/all-done.wav')
    expect(seen.toasts.at(-1)).toBe('All three tasks done. That is the day.')
    await pane.unmount()
  },
)
