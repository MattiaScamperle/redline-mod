export type Usage = {
  contextPercent?: number
  contextTokens?: number
  contextWindow: number
  fiveHourPercent?: number
  fiveHourResetsAt?: string
  weekPercent?: number
  weekResetsAt?: string
}

declare module 'claude-code' {
  interface PluginState {
    'barra-utilizzo': { usage: Usage | null; isCompacting: boolean; minute: number }
  }
}
