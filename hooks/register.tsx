import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionContextUsage, SessionRateLimit } from 'claude-code'

import type { Usage } from '../types'

const usage = atom({ plugin: 'redline-mod', key: 'usage' } as const, null)
const isCompacting = atom({ plugin: 'redline-mod', key: 'isCompacting' } as const, false)
const minute = atom({ plugin: 'redline-mod', key: 'minute' } as const, 0)

const CELLS = 8
const REFRESH_MS = 5000
const PROBE_GAP_MS = 2 * 60_000
const ESTIMATE_GAP_MS = 60_000
// Compatta sparisce sotto HIDE_BELOW% di contesto e si evidenzia sopra WARN_ABOVE%.
const HIDE_BELOW = 26
const WARN_ABOVE = 70
const FIVE_HOUR_MS = 5 * 3_600_000
const WEEK_MS = 7 * 86_400_000
type Rgb = [number, number, number]

// Sfumatura: verde a 0%, giallo a 35%, arancione a 60%, rosso a 100%.
const STOPS: [number, Rgb][] = [
  [0, [34, 197, 94]],
  [35, [234, 179, 8]],
  [60, [249, 115, 22]],
  [100, [239, 68, 68]],
]

function toUsage(context: SessionContextUsage, rateLimits: SessionRateLimit[]): Usage {
  const fiveHour = rateLimits.find(limit => limit.kind === 'five_hour')
  const week = rateLimits.find(limit => limit.kind === 'seven_day')

  return {
    contextPercent: estimatedPercent(context),
    contextTokens: context.tokens,
    contextEstimated: context.tokens !== undefined && context.percent === undefined ? true : undefined,
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
  const i = Math.max(1, STOPS.findIndex(([at]) => p <= at))
  const [from, a] = STOPS[i - 1]!
  const [to, b] = STOPS[i]!
  const t = (p - from) / (to - from)
  const mix = (k: 0 | 1 | 2) =>
    Math.round(a[k] + (b[k] - a[k]) * t).toString(16).padStart(2, '0')

  return `#${mix(0)}${mix(1)}${mix(2)}`
}

// Linea sottile: pieno ━ (una cella per colore della sfumatura), vuoto ─.
function bar(percent: number): { full: number; track: string } {
  const full = Math.round((clamp(percent) / 100) * CELLS)

  return { full, track: '─'.repeat(CELLS - full) }
}

function tokens(n: number): string {
  if (Math.round(n / 1000) >= 1000) return `${Math.round(n / 100_000) / 10}M`
  return n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`
}

const DAYS = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab']

// Ora locale del reset, preceduta dal giorno se non è oggi (o se alwaysDay).
export function clockAt(at: Date, now: number, alwaysDay: boolean): string {
  const pad = (n: number) => `${n}`.padStart(2, '0')
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`

  return alwaysDay || at.toDateString() !== new Date(now).toDateString()
    ? `${DAYS[at.getDay()]} ${time}`
    : time
}

function resetIn(resetsAt: string, now: number, alwaysDay: boolean): string | null {
  const minutes = Math.round((Date.parse(resetsAt) - now) / 60000)
  if (Number.isNaN(minutes)) return null
  if (minutes <= 0) return 'reset a breve'

  const d = Math.floor(minutes / 1440)
  const h = Math.floor((minutes % 1440) / 60)
  const m = minutes % 60
  const left = d > 0 ? `${d}g ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`

  return `reset ${clockAt(new Date(resetsAt), now, alwaysDay)} · ${left}`
}

// Ritmo: consumo medio dall'inizio della finestra, proiettato in avanti.
// Nulla da dire se non arriva a 100% prima del reset o se la finestra è
// appena iniziata (meno del 5%: la stima sarebbe rumore).
export function paceText(
  percent: number | undefined,
  resetsAt: string | undefined,
  windowMs: number,
  now: number,
  what: string,
  alwaysDay: boolean,
): string | null {
  if (percent === undefined || !resetsAt || percent <= 0 || percent >= 100) return null

  const end = Date.parse(resetsAt)
  const elapsed = now - (end - windowMs)
  if (Number.isNaN(end) || elapsed < windowMs * 0.05) return null

  const eta = now + ((100 - percent) * elapsed) / percent
  if (eta >= end) return null

  // "Ven 19:10" diventa "Ven alle 19:10"; senza giorno, "alle 19:10".
  const when = clockAt(new Date(eta), now, alwaysDay)

  return `A questo ritmo finisci ${what} ${when.includes(' ') ? when.replace(' ', ' alle ') : `alle ${when}`}`
}


// Dopo una compattazione (e in una chat nuova) il motore non conosce il
// contesto finché non arriva la risposta successiva: tokens e percent
// mancano. Intanto si usa la stima locale di /context, senza richieste di
// rete, ricalcolata al massimo una volta al minuto.
let estimate: { tokens: number; at: number } | null = null

async function withEstimate($: EngineInterface, context: SessionContextUsage): Promise<SessionContextUsage> {
  if (context.tokens !== undefined) {
    estimate = null
    return context
  }

  const now = await $.clock.now()
  if (!estimate || now - estimate.at >= ESTIMATE_GAP_MS) {
    try {
      const { context: counted } = await $.session.usage({ breakdown: 'summary' })
      const total = counted.breakdown?.totalTokens
      if (total !== undefined) estimate = { tokens: total, at: now }
    } catch {
      // Senza stima la barra resta vuota fino alla prossima risposta.
    }
  }

  // tokens senza percent: toUsage lo segna come stimato.
  return estimate ? { ...context, tokens: estimate.tokens } : context
}

function estimatedPercent(context: SessionContextUsage): number | undefined {
  if (context.percent !== undefined) return context.percent
  return context.tokens === undefined ? undefined : Math.round((context.tokens / context.window) * 100)
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
        const context = await withEstimate($, current.context)
        const fresh = toUsage(context, await shareLimits($, current.rateLimits))
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
    const context = await withEstimate($, e.context)
    await update($, usage, () => toUsage(context, limits))

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

    const meter = (
      label: string,
      percent: number | undefined,
      detail: string | null,
      pace: string | null = null,
    ) => {
      const color = percent === undefined ? undefined : colorFor(percent)
      const { full, track } = bar(percent ?? 0)

      return (
        <Box flexDirection="column" flexShrink={0}>
          <Box flexDirection="row" columnGap={1}>
            <Text dimColor>{label}</Text>
            <Box flexDirection="row">
              {Array.from({ length: full }, (_, i) => (
                <Text key={String(i)} color={colorFor(((i + 1) / CELLS) * 100)}>
                  ━
                </Text>
              ))}
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
          {pace ? (
            <Text color={colorFor(60)} size="footnote">
              {pace}
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

    // Percentuale ignota (contesto non ancora misurato): il bottone resta.
    const showCompact = current.contextPercent === undefined || current.contextPercent >= HIDE_BELOW
    const reset = (resetsAt: string | undefined, alwaysDay = false) =>
      resetsAt ? resetIn(resetsAt, now, alwaysDay) : null
    const context =
      current.contextTokens === undefined
        ? `finestra ${tokens(current.contextWindow)}`
        : `${current.contextEstimated ? '~' : ''}${tokens(current.contextTokens)} / ${tokens(current.contextWindow)}`

    return (
      <Box
        flexDirection="row"
        flexWrap="wrap"
        justifyContent="space-between"
        alignItems="center"
        columnGap="md"
        rowGap="xs"
      >
        {meter(
          '5h',
          current.fiveHourPercent,
          reset(current.fiveHourResetsAt),
          paceText(current.fiveHourPercent, current.fiveHourResetsAt, FIVE_HOUR_MS, now, 'le 5h', false),
        )}
        {meter(
          '7g',
          current.weekPercent,
          reset(current.weekResetsAt, true),
          paceText(current.weekPercent, current.weekResetsAt, WEEK_MS, now, 'la settimana', true),
        )}
        {meter('ctx', current.contextPercent, context)}
        {showCompact ? (
          <Box flexShrink={0}>
            <Button
              key="compatta"
              variant={current.contextPercent !== undefined && current.contextPercent > WARN_ABOVE ? 'primary' : 'secondary'}
              label={compacting ? 'Compattazione…' : 'Compatta'}
              onPress={compact}
            />
          </Box>
        ) : null}
      </Box>
    )
  })
}
