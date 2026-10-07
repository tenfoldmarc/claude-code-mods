import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Day, Metric, Task } from '../types'

const PANE = 'today'
const TASKS = 3
const MAX_TASK = 120
const CHECK = 'sounds/check.wav'
const ALL_DONE = 'sounds/all-done.wav'

const day = atom({ plugin: 'daily-command-center', key: 'day' } as const, {
  date: '',
  tasks: [],
  isSkipped: false,
})
const metrics = atom({ plugin: 'daily-command-center', key: 'metrics' } as const, [])
const refreshedAt = atom({ plugin: 'daily-command-center', key: 'refreshedAt' } as const, 0)
const minute = atom({ plugin: 'daily-command-center', key: 'minute' } as const, 0)
const zone = atom({ plugin: 'daily-command-center', key: 'zone' } as const, 0)

type Config = {
  startHour: number
  stripeKey: string
  metricsCommand: string
  refreshMs: number
  gain: number
}

type Parts = { date: string; hour: number; dayStart: number; monthStart: number }

// The person's own calendar day, from the clock and their offset from UTC.
const localParts = (ms: number, offsetMinutes: number): Parts => {
  const local = new Date(ms + offsetMinutes * 60_000)
  const [year, month, date] = [local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()]
  const pad = (n: number) => String(n).padStart(2, '0')

  return {
    date: `${year}-${pad(month + 1)}-${pad(date)}`,
    hour: local.getUTCHours(),
    dayStart: Date.UTC(year, month, date) - offsetMinutes * 60_000,
    monthStart: Date.UTC(year, month, 1) - offsetMinutes * 60_000,
  }
}

const isTask = (value: unknown): value is Task =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Task).text === 'string' &&
  typeof (value as Task).isDone === 'boolean'

const asDay = (value: unknown): Day | undefined => {
  const held = value as Day | null | undefined

  return typeof held === 'object' &&
    held !== null &&
    typeof held.date === 'string' &&
    Array.isArray(held.tasks) &&
    held.tasks.every(isTask)
    ? { date: held.date, tasks: held.tasks.slice(0, TASKS), isSkipped: held.isSkipped === true }
    : undefined
}

const forToday = (held: Day, date: string): Day =>
  held.date === date ? held : { date, tasks: [], isSkipped: false }

const isAsking = (today: Day, hour: number, startHour: number): boolean =>
  hour >= startHour && !today.isSkipped && today.tasks.length < TASKS

const clip = (text: string, length: number): string => {
  const line = text.replace(/\s+/g, ' ').trim()

  return line.length <= length ? line : `${line.slice(0, Math.max(1, length - 3))}...`
}

const SYMBOLS: Record<string, string> = { usd: '$', cad: 'CA$', aud: 'A$', eur: '€', gbp: '£' }
const NO_CENTS = new Set(['jpy', 'krw', 'vnd', 'clp'])

const money = (minorUnits: number, currency: string): string => {
  const amount = NO_CENTS.has(currency) ? minorUnits : Math.round(minorUnits) / 100
  const whole = Math.trunc(Math.abs(amount)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const cents = NO_CENTS.has(currency) ? '' : `.${Math.abs(amount).toFixed(2).split('.')[1]}`
  const symbol = SYMBOLS[currency] ?? `${currency.toUpperCase()} `

  return `${amount < 0 ? '-' : ''}${symbol}${whole}${cents}`
}

const ago = (ms: number): string => {
  const minutes = Math.floor(ms / 60_000)

  return minutes < 1 ? 'just now' : minutes < 60 ? `${minutes}m ago` : `${Math.floor(minutes / 60)}h ago`
}

// What a person typed, at the terminal, in the desktop app or from their phone.
// Never `sdk`: a headless `claude -p` run or a script is nobody's morning.
const TYPED = new Set(['composer', 'bridge'])

let timer: Timer | undefined
let wasAsking: boolean | undefined

// The store is the truth across sessions; the state is what this one draws.
async function load($: EngineInterface): Promise<{ today: Day; parts: Parts; time: number }> {
  const time = await $.clock.now()
  const parts = localParts(time, await read($, zone))
  const today = forToday(asDay(await $.store.get('day')) ?? (await read($, day)), parts.date)

  if (JSON.stringify(await read($, day)) !== JSON.stringify(today)) {
    await update($, day, () => today)
  }

  return { today, parts, time }
}

async function save($: EngineInterface, next: Day) {
  await $.store.set('day', next)
  await update($, day, () => next)
}

async function readZone($: EngineInterface) {
  const time = await $.clock.now()
  let offset = -new Date(time).getTimezoneOffset()

  try {
    // The host's own answer wins: the module's environment may run in UTC.
    const { exitCode, stdout } = await $.process.run(['date', '+%z'], { timeoutMs: 5000 })
    const found = /^([+-])(\d{2})(\d{2})/.exec(stdout.trim())

    if (exitCode === 0 && found !== null) {
      offset = (found[1] === '-' ? -1 : 1) * (Number(found[2]) * 60 + Number(found[3]))
    }
  } catch {
    // No `date` here (Windows): the environment's own offset stands.
  }

  await update($, zone, () => offset)
}

type StripePage = {
  data: { id: string; amount: number; currency: string; created: number; type: string }[]
  has_more: boolean
}

async function stripeRevenue($: EngineInterface, key: string, parts: Parts): Promise<Metric[]> {
  let today = 0
  let month = 0
  let currency = 'usd'
  let after = ''
  let hasMore = false

  try {
    for (let page = 0; page < 20; page += 1) {
      const since = Math.floor(parts.monthStart / 1000)
      const response = await $.http.fetch(
        `https://api.stripe.com/v1/balance_transactions?limit=100&created%5Bgte%5D=${since}${after}`,
        { headers: { Authorization: `Bearer ${key}` } },
      )

      if (!response.ok) {
        return [{ label: 'Revenue', value: `Stripe said ${response.status}. Check the key.` }]
      }

      const body = JSON.parse(response.text) as StripePage

      for (const row of body.data) {
        if (row.type !== 'charge' && row.type !== 'payment') {
          continue
        }

        currency = row.currency
        month += row.amount
        today += row.created * 1000 >= parts.dayStart ? row.amount : 0
      }

      const last = body.data.at(-1)
      hasMore = body.has_more && last !== undefined

      if (!hasMore || last === undefined) {
        break
      }

      after = `&starting_after=${last.id}`
    }
  } catch {
    return [{ label: 'Revenue', value: 'Stripe could not be reached.' }]
  }

  return [
    { label: 'Revenue today', value: money(today, currency) },
    { label: 'Month to date', value: `${money(month, currency)}${hasMore ? '+' : ''}` },
  ]
}

async function commandMetrics($: EngineInterface, command: string): Promise<Metric[]> {
  try {
    const { exitCode, stdout } = await $.process.run(['sh', '-c', command], { timeoutMs: 20_000 })

    if (exitCode !== 0) {
      return [{ label: 'Metrics command', value: `exited ${exitCode}` }]
    }

    return stdout
      .split('\n')
      .map(line => /^([^:]{1,40}):\s*(.+)$/.exec(line.trim()))
      .flatMap(found => (found === null ? [] : [{ label: String(found[1]).trim(), value: clip(String(found[2]), 40) }]))
      .slice(0, 8)
  } catch {
    return [{ label: 'Metrics command', value: 'could not run' }]
  }
}

async function manualMetrics($: EngineInterface): Promise<Metric[]> {
  const held = await $.store.get('manual')

  return typeof held === 'object' && held !== null
    ? Object.entries(held as Record<string, unknown>).map(([label, value]) => ({ label, value: String(value) }))
    : []
}

async function refresh($: EngineInterface, config: Config) {
  const { parts, time } = await load($)
  const fromStripe = config.stripeKey === '' ? [] : await stripeRevenue($, config.stripeKey, parts)
  const fromCommand = config.metricsCommand === '' ? [] : await commandMetrics($, config.metricsCommand)
  const all = [...fromStripe, ...fromCommand, ...(await manualMetrics($))]
  await update($, metrics, () => all)
  await update($, refreshedAt, () => time)
}

async function tick($: EngineInterface, config: Config) {
  const { today, parts, time } = await load($)
  await update($, minute, () => time)
  const asking = isAsking(today, parts.hour, config.startHour)

  if (asking && wasAsking === false) {
    $.ui.toast('Time to set your 3 tasks for today. Type the first one.', { timeoutMs: 15_000 })
  }

  wasAsking = asking

  if (time - (await read($, refreshedAt)) >= config.refreshMs) {
    await refresh($, config)
  }
}

async function toggle($: EngineInterface, index: number, config: Config) {
  const { today } = await load($)
  const tasks = today.tasks.map((task, at) => (at === index ? { ...task, isDone: !task.isDone } : task))
  const flipped = tasks[index]

  if (flipped === undefined) {
    return
  }

  await save($, { ...today, tasks })
  const isAllDone = tasks.length === TASKS && tasks.every(task => task.isDone)

  if (isAllDone) {
    $.ui.toast('All three tasks done. That is the day.', { timeoutMs: 10_000 })
  }

  if (flipped.isDone && config.gain > 0) {
    void $.audio.play({ asset: isAllDone ? ALL_DONE : CHECK }, { gain: config.gain }).catch(() => {})
  }
}

const board = (today: Day): string =>
  today.tasks.length === 0
    ? 'No tasks set for today yet.'
    : today.tasks.map((task, at) => `${at + 1}. [${task.isDone ? 'x' : ' '}] ${task.text}`).join('\n')

export const register: Register = (on, options) => {
  const config: Config = {
    startHour: Math.min(23, Math.max(0, Math.floor(Number(options.start_hour ?? 9)))),
    stripeKey: String(options.stripe_key ?? '').trim(),
    metricsCommand: String(options.metrics_command ?? '').trim(),
    refreshMs: Math.max(1, Number(options.refresh_minutes ?? 5)) * 60_000,
    gain: Math.min(4, Math.max(0, Number(options.volume ?? 1))),
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'today',
      description: "Show today's three tasks and your numbers in a side pane.",
      argumentHint: '[done <1-3> | reset | skip | refresh]',
    })
    await $.command.register({
      name: 'metric',
      description: 'Pin a number to the Today pane, or remove one by giving only its label.',
      argumentHint: '<label> <value>',
    })
    await readZone($)
    const { today, parts } = await load($)
    wasAsking = isAsking(today, parts.hour, config.startHour)

    timer?.cancel()
    timer = $.clock.every(60_000, () => void tick($, config))
    // Not awaited: a slow Stripe never holds the first prompt.
    void refresh($, config)

    // The board is up from the start, tasks set or not.
    void $.ui.open({ id: PANE, title: 'Today' })

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const isTyped = TYPED.has(e.origin.kind)
    const text = e.text.trim()

    if (!isTyped || text === '' || text.startsWith('/')) {
      return next(e)
    }

    const { today, parts } = await load($)

    if (!isAsking(today, parts.hour, config.startHour)) {
      return next(e)
    }

    // One task per line, so all three can go in at once.
    const lines = text
      .split('\n')
      .map(line => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').trim())
      .filter(line => line !== '')

    // A long message or a question is meant for Claude, not the board: it goes
    // through, with a reminder that the tasks are still due.
    if (lines.length > TASKS || lines.some(line => line.length > MAX_TASK || line.endsWith('?'))) {
      $.ui.toast(`Your ${TASKS} tasks for today are still due. Type a short one to set it.`, { timeoutMs: 8000 })

      return next(e)
    }

    const added = lines.map(line => ({ text: line, isDone: false }))
    const tasks = [...today.tasks, ...added].slice(0, TASKS)
    await save($, { ...today, tasks })

    if (tasks.length < TASKS) {
      return { drop: `Task ${tasks.length} of ${TASKS} locked in. Now type task ${tasks.length + 1}.` }
    }

    wasAsking = false
    await $.ui.open({ id: PANE, title: 'Today' })

    return { drop: 'All three tasks are set and pinned on the right. Get to work.' }
  })

  on('command.run', { command: 'today' }, async ($, e) => {
    const { today } = await load($)
    const [verb = '', argument = ''] = e.args.trim().toLowerCase().split(/\s+/)

    if (verb === 'reset') {
      await save($, { ...today, tasks: [], isSkipped: false })

      return { text: "Today's tasks are cleared. Your next three prompts set them again." }
    }

    if (verb === 'skip') {
      await save($, { ...today, isSkipped: true })

      return { text: 'No tasks asked today. They are asked again tomorrow.' }
    }

    if (verb === 'refresh') {
      await refresh($, config)

      return { text: 'Numbers refreshed.' }
    }

    if (verb === 'done') {
      const index = Number(argument) - 1

      if (today.tasks[index] === undefined) {
        return { text: `There is no task ${argument}. Use /today done 1, 2 or 3.` }
      }

      await toggle($, index, config)
    }

    await $.ui.open({ id: PANE, title: 'Today' })

    return { text: board((await load($)).today) }
  })

  on('command.run', { command: 'metric' }, async ($, e) => {
    const text = e.args.trim()
    const split = /^(.+?):\s*(.*)$/.exec(text) ?? /^(.+)\s+(\S+)$/.exec(text)
    const label = clip(split?.[1] ?? text, 30)
    const value = clip(split?.[2] ?? '', 40)

    if (label === '') {
      return { text: 'Pin a number with /metric Followers 12,400. Remove it with /metric Followers.' }
    }

    const held = await $.store.get('manual')
    const manual: Record<string, unknown> = typeof held === 'object' && held !== null ? { ...held } : {}

    if (value === '') {
      delete manual[label]
    } else {
      manual[label] = value
    }

    await $.store.set('manual', manual)
    await refresh($, config)

    return { text: value === '' ? `Removed ${label}.` : `Pinned ${label}: ${value}` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // Read for the redraw each minute; the time itself is the clock's.
    await read($, minute)
    const parts = localParts(await $.clock.now(), await read($, zone))
    const today = forToday(await read($, day), parts.date)

    if (e.props.hasSurvey || !isAsking(today, parts.hour, config.startHour)) {
      return next(e)
    }

    const { Box, Button, Text } = $.ui.resolve(e)
    const left = TASKS - today.tasks.length

    return (
      <Box flexDirection="column">
        <Text bold>What are your {TASKS} tasks for today?</Text>
        {today.tasks.map((task, at) => (
          <Text dimColor>
            {at + 1}. {task.text}
          </Text>
        ))}
        <Box>
          <Text>
            Type task {today.tasks.length + 1} and press enter. Claude is locked until {left === TASKS ? 'all three are' : `${left} more ${left === 1 ? 'is' : 'are'}`} in.{' '}
          </Text>
          <Button
            key="skip"
            label="Skip today"
            dimColor
            onPress={async () => save($, { ...(await load($)).today, isSkipped: true })}
          />
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    await read($, minute)
    const time = await $.clock.now()
    const parts = localParts(time, await read($, zone))
    const today = forToday(await read($, day), parts.date)
    const numbers = await read($, metrics)
    const refreshed = await read($, refreshedAt)
    const width = Math.max(24, e.props.bodyColumns)
    const done = today.tasks.filter(task => task.isDone).length
    const labelWidth = Math.min(20, Math.max(8, ...numbers.map(one => one.label.length)))

    return (
      <Box flexDirection="column">
        <Text bold>
          TODAY'S {TASKS} TASKS {today.tasks.length === TASKS ? `${done}/${TASKS}` : ''}
        </Text>
        {today.tasks.length === 0 && (
          <Text dimColor>
            {today.isSkipped ? 'Skipped for today.' : `Not set yet. Claude asks from ${config.startHour}:00.`}
          </Text>
        )}
        {today.tasks.map((task, at) => (
          <Button
            key={`task-${at + 1}`}
            plain
            hotkey={String(at + 1)}
            dimColor={task.isDone}
            label={`${task.isDone ? '[x]' : '[ ]'} ${clip(task.text, width - 8)}`}
            onPress={() => toggle($, at, config)}
          />
        ))}
        <Text> </Text>
        <Text bold>NUMBERS</Text>
        {numbers.length === 0 && (
          <Text dimColor wrap="wrap">
            Nothing pinned yet. Add one with /metric Followers 12,400 or connect Stripe in /config.
          </Text>
        )}
        {numbers.map(one => (
          <Box>
            <Text dimColor>{clip(one.label, labelWidth).padEnd(labelWidth + 2)}</Text>
            <Text bold wrap="truncate-end">
              {one.value}
            </Text>
          </Box>
        ))}
        <Text> </Text>
        <Box>
          <Button key="refresh" label="Refresh" hotkey="r" onPress={() => refresh($, config)} />
          <Text dimColor> {refreshed === 0 ? '' : `updated ${ago(time - refreshed)}`}</Text>
        </Box>
      </Box>
    )
  })
}
