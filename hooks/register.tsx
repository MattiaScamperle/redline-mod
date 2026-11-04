import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextUsage, SessionRateLimit } from 'claude-code'

import type { Usage } from '../types'

const usage = atom({ plugin: 'redline-mod', key: 'usage' } as const, null)
const isCompacting = atom({ plugin: 'redline-mod', key: 'isCompacting' } as const, false)
const minute = atom({ plugin: 'redline-mod', key: 'minute' } as const, 0)

const CELLS = 8
const REFRESH_MS = 5000
const PROBE_GAP_MS = 2 * 60_000

type Rgb = [number, number, number]

// Verde a 0%, arancione a 60%, rosso a 100%.
const GREEN: Rgb = [34, 197, 94]
const ORANGE: Rgb = [249, 115, 22]
const RED: Rgb = [239, 68, 68]
const MID = 60

function toUsage(context: SessionContextUsage, rateLimits: SessionRateLimit[]): Usage {
  const fiveHour = rateLimits.find(limit => limit.kind === 'five_hour')
  const week = rateLimits.find(limit => limit.kind === 'seven_day')

  return {
    contextPercent: context.percent,
    contextTokens: context.tokens,
    contextWindow: context.window,
    fiveHourPercent: fiveHour?.percentUsed,
    fiveHourResetsAt: fiveHour?.resetsAt,
    weekPercent: week?.percentUsed,
    weekResetsAt: week?.resetsAt,
  }
}

function clamp(percent: number): number {
  return Math.max(0, Math.min(100, percent))
}

function colorFor(percent: number): string {
  const p = clamp(percent)
  const [a, b, t] = p <= MID ? [GREEN, ORANGE, p / MID] : [ORANGE, RED, (p - MID) / (100 - MID)]
  const mix = (i: 0 | 1 | 2) =>
    Math.round(a[i] + (b[i] - a[i]) * t).toString(16).padStart(2, '0')

  return `#${mix(0)}${mix(1)}${mix(2)}`
}

// Linea sottile: pieno ━, vuoto ─.
function bar(percent: number): { filled: string; track: string } {
  const full = Math.round((clamp(percent) / 100) * CELLS)

  return {
    filled: '━'.repeat(full),
    track: '─'.repeat(CELLS - full),
  }
}

function tokens(n: number): string {
  if (Math.round(n / 1000) >= 1000) return `${Math.round(n / 100_000) / 10}M`
  return n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`
}

function resetIn(resetsAt: string, now: number): string | null {
  const minutes = Math.round((Date.parse(resetsAt) - now) / 60000)
  if (Number.isNaN(minutes)) return null
  if (minutes <= 0) return 'reset a breve'

  const d = Math.floor(minutes / 1440)
  const h = Math.floor((minutes % 1440) / 60)
  const m = minutes % 60

  if (d > 0) return `reset ${d}g ${h}h`
  return h > 0 ? `reset ${h}h ${m}m` : `reset ${m}m`
}


type SharedLimits = { limits: SessionRateLimit[]; at: number }

// I limiti 5h e 7g sono dell'account, ma ogni chat li riceve solo con le
// proprie risposte. L'ultima lettura di qualsiasi chat va nello store
// condiviso, così una chat appena aperta o ferma mostra comunque i valori.
let own: { key: string; at: number } | null = null

async function shareLimits($: EngineInterface, limits: SessionRateLimit[]): Promise<SessionRateLimit[]> {
  const now = await $.clock.now()

  if (limits.length > 0) {
    const key = JSON.stringify(limits)
    if (own?.key !== key) {
      own = { key, at: now }
      await $.store.set('rateLimits', { limits, at: now } satisfies SharedLimits)
    }
  }

  const stored = (await $.store.get('rateLimits')) as SharedLimits | undefined
  if (!stored || (own && stored.at <= own.at)) return limits

  return stored.limits.filter(limit => !limit.resetsAt || Date.parse(limit.resetsAt) > now)
}

type Probe = { at: number; answered?: boolean; error?: string; gotLimits?: boolean }

// All'avvio dell'app nessuna chat ha ancora ricevuto una risposta, quindi i
// limiti esatti mancano. Una richiesta minima a Haiku li porta con sé; lo
// store fa sì che la faccia una sola chat ogni due minuti, non tutte insieme.
async function probeLimits($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  const last = (await $.store.get('probe')) as Probe | undefined
  if (last && now - last.at < PROBE_GAP_MS) return
  await $.store.set('probe', { at: now } satisfies Probe)

  const reply = await $.model.complete({
    model: 'haiku',
    prompt: 'ok',
    maxTokens: 8,
    effort: 'low',
    timeoutMs: 20_000,
  })
  const { rateLimits } = await $.session.usage()

  await $.store.set('probe', {
    at: now,
    answered: reply.isAnswered,
    error: reply.isAnswered ? undefined : reply.reason,
    gotLimits: rateLimits.length > 0,
  } satisfies Probe)
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// Nella chat desktop (SDK, headless) $.session.compact rifiuta sempre:
// lì la compattazione gira dentro un turno, come prompt /compact. In quel
// caso si accoda /compact, che parte appena la chat è ferma.
export async function compactNow($: EngineInterface): Promise<void> {
  try {
    const result = await $.session.compact()
    if ('skip' in result) $.ui.toast(`Compattazione annullata: ${result.skip}`)
  } catch (err) {
    if (!messageOf(err).includes('headless')) throw err
    await $.command.run({ command: 'compact' })
  }
}

export function compactErrorText(err: unknown): string {
  const message = messageOf(err)
  if (message.includes('turn is in flight')) return 'Compattazione possibile solo a fine risposta'
  return `Compattazione non riuscita: ${message}`
}

function same(a: Usage | null, b: Usage): boolean {
  return a !== null && JSON.stringify(a) === JSON.stringify(b)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)

    // Aggiorna i dati ogni pochi secondi, anche durante una risposta, e il
    // conto alla rovescia dei reset a ogni minuto.
    const refresh = async () => {
      try {
        const current = await $.session.usage()
        const fresh = toUsage(current.context, await shareLimits($, current.rateLimits))
        await update($, usage, prev => (same(prev, fresh) ? prev : fresh))

        const now = Math.floor((await $.clock.now()) / 60000)
        await update($, minute, prev => (prev === now ? prev : now))
      } catch {
        // Un giro saltato si recupera al successivo.
      }
    }

    await refresh()
    $.clock.every(REFRESH_MS, () => void refresh())

    const { rateLimits } = await $.session.usage()
    if (rateLimits.length === 0) {
      void probeLimits($)
        .then(refresh)
        .catch(() => {
          // Senza richiesta restano gli ultimi valori salvati.
        })
    }

    return result
  })

  on('session.measure', async ($, e, next) => {
    const limits = await shareLimits($, e.rateLimits)
    await update($, usage, () => toUsage(e.context, limits))

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const current = await read($, usage)

    if (e.props.hasSurvey || current === null) {
      return next(e)
    }

    const { Box, Button, Text } = $.ui.resolve(e)
    await read($, minute)
    const now = await $.clock.now()
    const compacting = await read($, isCompacting)

    const meter = (label: string, percent: number | undefined, detail: string | null) => {
      const color = percent === undefined ? undefined : colorFor(percent)
      const { filled, track } = bar(percent ?? 0)

      return (
        <Box flexDirection="column" flexShrink={0}>
          <Box flexDirection="row" columnGap={1}>
            <Text dimColor>{label}</Text>
            <Box flexDirection="row">
              {filled ? <Text color={color}>{filled}</Text> : null}
              <Text dimColor>{track}</Text>
            </Box>
            {percent === undefined ? (
              <Text dimColor tabular>n/d</Text>
            ) : (
              <Text color={color} tabular>
                {Math.round(percent)}%
              </Text>
            )}
          </Box>
          {detail ? (
            <Text dimColor size="footnote">
              {detail}
            </Text>
          ) : null}
        </Box>
      )
    }

    const compact = async () => {
      if (await read($, isCompacting)) return
      await update($, isCompacting, () => true)

      try {
        await compactNow($)
      } catch (err) {
        $.ui.toast(compactErrorText(err))
      } finally {
        await update($, isCompacting, () => false)
      }
    }

    const reset = (resetsAt: string | undefined) => (resetsAt ? resetIn(resetsAt, now) : null)
    const context =
      current.contextTokens === undefined
        ? `finestra ${tokens(current.contextWindow)}`
        : `${tokens(current.contextTokens)} / ${tokens(current.contextWindow)}`

    return (
      <Box
        flexDirection="row"
        flexWrap="wrap"
        justifyContent="space-between"
        alignItems="center"
        columnGap="md"
        rowGap="xs"
      >
        {meter('5h', current.fiveHourPercent, reset(current.fiveHourResetsAt))}
        {meter('7g', current.weekPercent, reset(current.weekResetsAt))}
        {meter('ctx', current.contextPercent, context)}
        <Box flexShrink={0}>
          <Button
            key="compatta"
            variant="secondary"
            label={compacting ? 'Compattazione…' : 'Compatta'}
            onPress={compact}
          />
        </Box>
      </Box>
    )
  })
}
