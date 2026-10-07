import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Sprint } from '../types'

const sprint = atom({ plugin: 'focus-lock', key: 'sprint' } as const, null)
const held = atom({ plugin: 'focus-lock', key: 'held' } as const, [])
const now = atom({ plugin: 'focus-lock', key: 'now' } as const, 0)

const SOUND = 'sounds/sprint-done.wav'
const OVERRIDE = '!!'
const MAX_HELD = 20

const JUDGE = [
  'You guard a focus sprint. The person committed to ONE task and asked to be',
  'kept on it. Decide whether their new message belongs to that task.',
  'Answer with exactly one word: ON or OFF.',
  'ON: anything that works on the task, plus short follow-ups, answers,',
  'approvals, corrections ("yes", "do that", "fix it", "try again") and',
  'anything ambiguous.',
  'OFF: only a message that clearly starts a different piece of work.',
].join('\n')

const countdown = (ms: number): string => {
  const seconds = Math.max(0, Math.ceil(ms / 1000))
  const pad = (n: number) => String(n).padStart(2, '0')

  return `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`
}

const clip = (text: string, length: number): string => {
  const line = text.replace(/\s+/g, ' ').trim()

  return line.length <= length ? line : `${line.slice(0, Math.max(1, length - 3))}...`
}

type Ask =
  | { kind: 'status' }
  | { kind: 'stop' }
  | { kind: 'start'; minutes: number; task: string }

const parse = (args: string, defaultMinutes: number): Ask => {
  const text = args.trim()

  if (text === '') {
    return { kind: 'status' }
  }

  if (/^(stop|end|off|cancel)$/i.test(text)) {
    return { kind: 'stop' }
  }

  const timed = /^(\d{1,3})\s*(?:m|min|mins|minutes)?\s+(.+)$/is.exec(text)
  const minutes = timed?.[1] === undefined ? defaultMinutes : Number(timed[1])

  return { kind: 'start', minutes: Math.max(1, minutes), task: (timed?.[2] ?? text).trim() }
}

// What a person typed, at the terminal, in the desktop app or from their phone.
// Never `sdk`: a headless `claude -p` run or a script is nobody's morning.
const TYPED = new Set(['composer', 'bridge'])

let timer: Timer | undefined

const disarm = () => {
  timer?.cancel()
  timer = undefined
}

async function finish($: EngineInterface, isEarly: boolean, gain: number) {
  const running = await read($, sprint)

  if (running === null) {
    return
  }

  disarm()
  await update($, sprint, () => null)
  $.ui.status(undefined)
  const waiting = (await read($, held)).length
  const tail =
    waiting === 0 ? '' : ` ${waiting} held prompt${waiting === 1 ? ' is' : 's are'} waiting above the prompt.`
  $.ui.toast(`${isEarly ? 'Sprint ended early.' : 'Sprint done.'}${tail}`, { timeoutMs: 10000 })

  if (!isEarly && gain > 0) {
    void $.audio.play({ asset: SOUND }, { gain }).catch(() => {})
  }
}

async function tick($: EngineInterface, gain: number) {
  const running = await read($, sprint)

  if (running === null) {
    disarm()

    return
  }

  const time = await $.clock.now()

  if (time >= running.endsAt) {
    await finish($, false, gain)

    return
  }

  await update($, now, () => time)
  $.ui.status(`Focus ${countdown(running.endsAt - time)} | ${clip(running.task, 40)}`)
}

function arm($: EngineInterface, gain: number) {
  disarm()
  timer = $.clock.every(1000, () => void tick($, gain))
}

export const register: Register = (on, options) => {
  const defaultMinutes = Math.max(1, Number(options.minutes ?? 50))
  const model = String(options.model ?? 'haiku')
  const gain = Math.min(4, Math.max(0, Number(options.volume ?? 1)))

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'sprint',
      description: 'Start a focus sprint on one task. Off-task prompts are held until it ends.',
      argumentHint: '[minutes] <task> | stop',
    })

    // A reload or a resumed session picks the running sprint back up.
    if ((await read($, sprint)) !== null) {
      arm($, gain)
      await tick($, gain)
    }

    return next(e)
  })

  on('command.run', { command: 'sprint' }, async ($, e) => {
    const ask = parse(e.args, defaultMinutes)
    const running = await read($, sprint)
    const time = await $.clock.now()

    if (ask.kind === 'status') {
      return {
        text:
          running === null
            ? 'No sprint is running. Start one with /sprint 50 write the sales page'
            : `Focus sprint: "${running.task}", ${countdown(running.endsAt - time)} left. End it with /sprint stop`,
      }
    }

    if (ask.kind === 'stop') {
      if (running === null) {
        return { text: 'No sprint is running.' }
      }

      await finish($, true, gain)

      return { text: `Sprint on "${running.task}" ended.` }
    }

    const next: Sprint = { task: ask.task, startedAt: time, endsAt: time + ask.minutes * 60_000 }
    await update($, sprint, () => next)
    await update($, now, () => time)
    arm($, gain)
    $.ui.status(`Focus ${countdown(next.endsAt - time)} | ${clip(next.task, 40)}`)

    return {
      text: `Focus lock on for ${ask.minutes} minutes: "${ask.task}". Anything off task is held until the timer ends. Start a prompt with ${OVERRIDE} to push it through.`,
    }
  })

  on('prompt.submit', async ($, e, next) => {
    const running = await read($, sprint)

    if (running === null) {
      return next(e)
    }

    const time = await $.clock.now()

    if (time >= running.endsAt) {
      await finish($, false, gain)

      return next(e)
    }

    // Only what the person types is judged: never a task notification, a
    // scheduled run or another plugin's prompt.
    const isTyped = TYPED.has(e.origin.kind)
    const text = e.text.trim()

    if (!isTyped || text === '' || text.startsWith('/')) {
      return next(e)
    }

    if (text.startsWith(OVERRIDE)) {
      return next({ ...e, text: text.slice(OVERRIDE.length).trimStart() })
    }

    const verdict = await $.model.complete({
      model,
      system: JUDGE,
      prompt: `The task: ${running.task}\n\nThe new message:\n${text.slice(0, 2000)}`,
      maxTokens: 8,
      effort: 'low',
      timeoutMs: 8000,
    })

    // No answer means no lock: a judge that is down never blocks the work.
    const isOff = verdict.isAnswered && /\bOFF\b/i.test(verdict.text) && !/\bON\b/i.test(verdict.text)

    if (!isOff) {
      return next(e)
    }

    await update($, held, list => [...list, e.text].slice(-MAX_HELD))

    return {
      drop: `Focus lock: that is not "${clip(running.task, 60)}". Held for ${countdown(running.endsAt - time)}, until the sprint ends. Start it with ${OVERRIDE} to push it through, or /sprint stop to end the sprint.`,
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const running = await read($, sprint)
    const waiting = await read($, held)

    if (e.props.hasSurvey || (running === null && waiting.length === 0)) {
      return next(e)
    }

    const { Box, Button, Text } = $.ui.resolve(e)
    const width = Math.max(20, e.props.bodyColumns)

    if (running !== null) {
      const time = Math.max(await read($, now), running.startedAt)

      return (
        <Box flexDirection="column">
          <Box>
            <Text bold>FOCUS {countdown(running.endsAt - time)} </Text>
            <Text wrap="truncate-end">{clip(running.task, width - 40)} </Text>
            <Button key="end" label="End sprint" onPress={() => finish($, true, gain)} />
          </Box>
          {waiting.length > 0 && (
            <Text dimColor>
              {waiting.length} off-task prompt{waiting.length === 1 ? '' : 's'} held until the timer ends.
            </Text>
          )}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Text bold>Held during your sprint:</Text>
        {waiting.slice(0, 5).map((text, index) => (
          <Box>
            <Button
              key={`send-${index}`}
              label="Send"
              onPress={async () => {
                await update($, held, list => list.filter((_, at) => at !== index))
                await $.prompt.submit({ text })
              }}
            />
            <Text> </Text>
            <Button
              key={`drop-${index}`}
              label="Drop"
              onPress={() => update($, held, list => list.filter((_, at) => at !== index))}
            />
            <Text wrap="truncate-end"> {clip(text, width - 22)}</Text>
          </Box>
        ))}
        {waiting.length > 5 && <Text dimColor>and {waiting.length - 5} more</Text>}
        <Box>
          <Button key="clear" label="Clear all" onPress={() => update($, held, () => [])} />
        </Box>
      </Box>
    )
  })
}
