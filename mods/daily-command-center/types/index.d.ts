export type Task = { text: string; isDone: boolean }

/** One local day's three tasks. `date` is YYYY-MM-DD in the person's own time. */
export type Day = { date: string; tasks: Task[]; isSkipped: boolean }

export type Metric = { label: string; value: string }

declare module 'claude-code' {
  interface PluginState {
    'daily-command-center': {
      /** The day on the board; kept across sessions in the store too. */
      day: Day
      /** The numbers under the tasks: Stripe, the metrics command, then manual. */
      metrics: Metric[]
      /** When the numbers were last refreshed, ms since the epoch (0: never). */
      refreshedAt: number
      /** The clock as last ticked, once a minute, so the 9am ask redraws. */
      minute: number
      /** The person's offset from UTC in minutes (-240 for EDT). */
      zone: number
    }
  }
}
