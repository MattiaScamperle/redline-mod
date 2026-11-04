export type Usage = {
  contextPercent?: number
  contextTokens?: number
  // Stima locale: il motore non ha ancora misurato il contesto (dopo una compattazione).
  contextEstimated?: boolean
  contextWindow: number
  fiveHourPercent?: number
  fiveHourResetsAt?: string
  weekPercent?: number
  weekResetsAt?: string
}

declare module 'claude-code' {
  interface PluginState {
    'redline-mod': { usage: Usage | null; isCompacting: boolean; minute: number }
  }
}
