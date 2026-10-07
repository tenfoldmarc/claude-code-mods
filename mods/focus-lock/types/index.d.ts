export type Sprint = { task: string; startedAt: number; endsAt: number }

declare module 'claude-code' {
  interface PluginState {
    'focus-lock': {
      /** The running sprint, or null between sprints. */
      sprint: Sprint | null
      /** Prompts held back during a sprint, oldest first. */
      held: string[]
      /** The clock as last ticked, so the countdown redraws. */
      now: number
    }
  }
}
