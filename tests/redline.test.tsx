import { expect, mock, test } from 'claude-code/testing'

import { compactErrorText, compactNow } from '../hooks/register'

const BAND = {
  plugin: 'redline-mod',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

test('la banda mostra 5 ore, settimana e contesto con colore dinamico', async ($, on) => {
  on('session.measure', (_, e) => ({ changed: e.changed }))
  mock.store(on)
  on('clock.now', () => ({ value: Date.parse('2098-12-31T21:45:00Z') }))

  await $.session.measure({
    context: { tokens: 50_000, window: 200_000, percent: 25 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 0, resetsAt: '2099-01-01T00:00:00Z' },
      { kind: 'seven_day', percentUsed: 60, resetsAt: '2099-01-03T23:45:00Z' },
    ],
    changed: ['context', 'rateLimits'],
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })

    expect((await ui.find({ type: 'Text', text: '0%' }))?.props.color).toBe('#22c55e')
    expect((await ui.find({ type: 'Text', text: '60%' }))?.props.color).toBe('#f97316')
    // Una cella per colore: 0 + 5 + 2, la prima è il verde della sfumatura a 12,5%.
    const cells = await ui.findAll({ type: 'Text', text: '━' })
    expect(cells).toHaveLength(7)
    expect(cells[0]?.props.color).toBe('#69bf3f')
    expect(await ui.find({ type: 'Text', text: '25%' })).toBeDefined()
    // Orari locali: 5h solo ora se è oggi, settimana sempre con giorno.
    const pad = (n: number) => `${n}`.padStart(2, '0')
    const five = new Date('2099-01-01T00:00:00Z')
    const week = new Date('2099-01-03T23:45:00Z')
    const day = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab']
    const sameDay = five.toDateString() === new Date('2098-12-31T21:45:00Z').toDateString()
    const fiveClock = `${sameDay ? '' : `${day[five.getDay()]} `}${pad(five.getHours())}:${pad(five.getMinutes())}`
    expect(await ui.find({ type: 'Text', text: `reset ${fiveClock} · 2h 15m` })).toBeDefined()
    expect(
      await ui.find({
        type: 'Text',
        text: `reset ${day[week.getDay()]} ${pad(week.getHours())}:${pad(week.getMinutes())} · 3g 2h`,
      }),
    ).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '50k / 200k' })).toBeDefined()

    // Contesto al 25%: sotto il 26% il bottone non si vede.
    expect(await ui.find({ type: 'Button', key: 'compatta' })).toBeUndefined()
    await ui.unmount()
  }
})

for (const [percent, variant] of [
  [26, 'secondary'],
  [70, 'secondary'],
  [71, 'primary'],
] as const) {
  test(`con contesto al ${percent}% il bottone Compatta è ${variant}`, async ($, on) => {
    on('session.measure', (_, e) => ({ changed: e.changed }))
    mock.store(on)
    on('clock.now', () => ({ value: 0 }))

    await $.session.measure({
      context: { tokens: percent * 2000, window: 200_000, percent },
      rateLimits: [],
      changed: ['context'],
    })

    const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
    const button = await ui.find({ type: 'Button', key: 'compatta' })
    expect(button?.props.variant).toBe(variant)
    expect(button?.props.plain).toBeUndefined()
    await ui.unmount()
  })
}

test('il ritmo dice quando finiscono le 5h solo se arrivano a 100% prima del reset', async ($, on) => {
  on('session.measure', (_, e) => ({ changed: e.changed }))
  mock.store(on)
  on('clock.now', () => ({ value: Date.parse('2098-12-31T21:45:00Z') }))

  // Finestra 19:00Z-00:00Z, 2h45m trascorse: il 60% finisce alle 23:35Z, il 10% no.
  await $.session.measure({
    context: { tokens: 50_000, window: 200_000, percent: 25 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 60, resetsAt: '2099-01-01T00:00:00Z' },
      { kind: 'seven_day', percentUsed: 10, resetsAt: '2099-01-03T23:45:00Z' },
    ],
    changed: ['context', 'rateLimits'],
  })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const eta = new Date('2098-12-31T23:35:00Z')
  const pad = (n: number) => `${n}`.padStart(2, '0')
  const clock = `${pad(eta.getHours())}:${pad(eta.getMinutes())}`
  const today = eta.toDateString() === new Date('2098-12-31T21:45:00Z').toDateString()
  const day = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'][eta.getDay()]

  expect(
    await ui.find({
      type: 'Text',
      text: `A questo ritmo finisci le 5h ${today ? '' : `${day} `}alle ${clock}`,
    }),
  ).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /la settimana/ })).toBeUndefined()
  await ui.unmount()
})

test('il rosso arriva a 100% e i limiti mancanti sono n/d', async ($, on) => {
  on('session.measure', (_, e) => ({ changed: e.changed }))
  mock.store(on)
  on('clock.now', () => ({ value: 0 }))

  await $.session.measure({
    context: { tokens: 200_000, window: 200_000, percent: 100 },
    rateLimits: [],
    changed: ['context'],
  })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })

  expect((await ui.find({ type: 'Text', text: '100%' }))?.props.color).toBe('#ef4444')
  const cells = await ui.findAll({ type: 'Text', text: '━' })
  expect(cells).toHaveLength(8)
  expect(cells[7]?.props.color).toBe('#ef4444')
  expect(await ui.findAll({ type: 'Text', text: 'n/d' })).toHaveLength(2)
  expect(await ui.find({ type: 'Text', text: '200k / 200k' })).toBeDefined()
  await ui.unmount()
})

test('dopo una compattazione il contesto mostra la stima finché non arriva una risposta', async ($, on) => {
  let measured = false
  let estimates = 0
  const clock = mock.clock(on)
  mock.store(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', (_, e) => {
    if (e.breakdown === 'summary') estimates += 1
    const context = measured
      ? { tokens: 50_000, window: 200_000, percent: 25 }
      : {
          window: 200_000,
          breakdown: e.breakdown === 'summary' ? ({ totalTokens: 30_000 } as never) : undefined,
        }
    return { value: { startedAt: '2099-01-01T00:00:00Z', context, rateLimits: [] } as never }
  })

  await $.session.start({ cwd: '/progetto', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: '~30k / 200k' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '15%' })).toBeDefined()

  // La stima non si ricalcola a ogni giro.
  const first = estimates
  await clock.advance(5000)
  expect(estimates).toBe(first)

  measured = true
  await clock.advance(5000)
  expect(await ui.find({ type: 'Text', text: '50k / 200k' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '25%' })).toBeDefined()
  await ui.unmount()
})

test('una finestra da un milione si scrive 1M', async ($, on) => {
  on('session.measure', (_, e) => ({ changed: e.changed }))
  mock.store(on)
  on('clock.now', () => ({ value: 0 }))

  await $.session.measure({
    context: { tokens: 999_600, window: 1_000_000, percent: 50 },
    rateLimits: [],
    changed: ['context'],
  })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })

  expect(await ui.find({ type: 'Text', text: '1M / 1M' })).toBeDefined()
  await ui.unmount()
})

test('la barra si aggiorna da sola durante la sessione', async ($, on) => {
  let percent = 10
  const clock = mock.clock(on)
  mock.store(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({
    value: {
      startedAt: '2099-01-01T00:00:00Z',
      context: { tokens: percent * 2000, window: 200_000, percent },
      rateLimits: [],
    } as never,
  }))

  await $.session.start({ cwd: '/progetto', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: '10%' })).toBeDefined()

  percent = 40
  await clock.advance(5000)
  expect(await ui.find({ type: 'Text', text: '40%' })).toBeDefined()
  await ui.unmount()
})

test('il bottone Compatta compatta il contesto', async ($, on) => {
  let compacted = 0
  on('session.measure', (_, e) => ({ changed: e.changed }))
  mock.store(on)
  on('clock.now', () => ({ value: 0 }))
  on('session.compact', () => {
    compacted += 1
    return { skip: 'test' }
  })
  on('ui.toast', () => ({ value: undefined }))

  await $.session.measure({
    context: { window: 200_000, percent: 80 },
    rateLimits: [],
    changed: ['context'],
  })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'compatta' })

  expect(compacted).toBe(1)
  await ui.unmount()
})

test('se la compattazione fallisce il bottone mostra l\'errore e torna Compatta', async ($, on) => {
  const toasts: string[] = []
  on('session.measure', (_, e) => ({ changed: e.changed }))
  mock.store(on)
  on('clock.now', () => ({ value: 0 }))
  on('session.compact', () => {
    throw new Error('rotto')
  })
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })

  await $.session.measure({
    context: { window: 200_000, percent: 80 },
    rateLimits: [],
    changed: ['context'],
  })

  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, isWorking: true }, surface: 'desktop' })
  await ui.press({ key: 'compatta' })

  expect(toasts).toHaveLength(1)
  expect(toasts[0]?.startsWith('Compattazione non riuscita: ')).toBe(true)
  expect((await ui.find({ type: 'Button', key: 'compatta' }))?.props.label).toBe('Compatta')
  await ui.unmount()
})

// Il kit salta un hook che lancia, quindi qui $.session.compact che rifiuta
// con il testo del motore si prova con un $ finto.
function fakeEngine(rejectWith: string | null) {
  const calls = { compact: 0, commands: [] as string[], toasts: [] as string[] }
  const engine = {
    session: {
      compact: async () => {
        calls.compact += 1
        if (rejectWith !== null) throw new Error(`redline-mod: $.session.compact: ${rejectWith}`)
        return { messages: [] }
      },
    },
    command: {
      run: async (input: { command: string }) => {
        calls.commands.push(input.command)
        return {}
      },
    },
    ui: {
      toast: (text: string) => {
        calls.toasts.push(text)
      },
    },
  }
  return { calls, $: engine as unknown as Parameters<typeof compactNow>[0] }
}

test('nella chat desktop (SDK) Compatta accoda /compact', async () => {
  const { calls, $ } = fakeEngine(
    'not available in a headless (-p / SDK) session yet: compaction here runs inside a turn (a /compact prompt); catch it and carry on',
  )

  await compactNow($)

  expect(calls.compact).toBe(1)
  expect(calls.commands).toEqual(['compact'])
  expect(calls.toasts).toEqual([])
})

test('nel terminale Compatta compatta direttamente', async () => {
  const { calls, $ } = fakeEngine(null)

  await compactNow($)

  expect(calls.compact).toBe(1)
  expect(calls.commands).toEqual([])
})

test('durante una risposta Compatta spiega perché non compatta', async () => {
  const { calls, $ } = fakeEngine('a turn is in flight; the conversation compacts between turns')

  const error = await compactNow($).then(
    () => undefined,
    (err: unknown) => err,
  )

  expect(calls.commands).toEqual([])
  expect(compactErrorText(error)).toBe('Compattazione possibile solo a fine risposta')
})

test('un altro errore di compattazione mostra il suo messaggio', async () => {
  const { calls, $ } = fakeEngine('the compaction produced no summary')

  const error = await compactNow($).then(
    () => undefined,
    (err: unknown) => err,
  )

  expect(calls.commands).toEqual([])
  expect(compactErrorText(error)).toBe(
    'Compattazione non riuscita: redline-mod: $.session.compact: the compaction produced no summary',
  )
})

test('senza misure la banda lascia il posto al motore', async ($, on) => {
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })

  expect((await ui.find({ type: 'Text' }))?.text).toBe('engine')
  await ui.unmount()
})

test('una chat senza letture usa gli ultimi limiti salvati da un\'altra chat', async ($, on) => {
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('clock.now', () => ({ value: Date.parse('2098-12-31T21:45:00Z') }))
  mock.store(on, {
    rateLimits: {
      at: Date.parse('2098-12-31T21:00:00Z'),
      limits: [
        { kind: 'five_hour', percentUsed: 33, resetsAt: '2099-01-01T00:00:00Z' },
        { kind: 'seven_day', percentUsed: 71, resetsAt: '2099-01-03T23:45:00Z' },
        { kind: 'five_hour_old', percentUsed: 99, resetsAt: '2098-12-31T20:00:00Z' },
      ],
    },
  })

  await $.session.measure({
    context: { tokens: 50_000, window: 200_000, percent: 25 },
    rateLimits: [],
    changed: ['context'],
  })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })

  expect(await ui.find({ type: 'Text', text: '33%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '71%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'n/d' })).toBeUndefined()
  await ui.unmount()
})

test("all'avvio senza limiti una sola richiesta minima li carica subito", async ($, on) => {
  let calls = 0
  const clock = mock.clock(on, { now: Date.parse('2098-12-31T21:45:00Z') })
  mock.store(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('model.complete', (_, e) => {
    calls += 1
    expect(e.model).toBe('haiku')
    return {
      value: {
        isAnswered: true,
        text: 'ok',
        usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      },
    }
  })
  on('session.usage', () => ({
    value: {
      startedAt: '2099-01-01T00:00:00Z',
      context: { tokens: 20_000, window: 200_000, percent: 10 },
      rateLimits:
        calls === 0
          ? []
          : [
              { kind: 'five_hour', percentUsed: 12, resetsAt: '2099-01-01T00:00:00Z' },
              { kind: 'seven_day', percentUsed: 73, resetsAt: '2099-01-03T23:45:00Z' },
            ],
    } as never,
  }))

  await $.session.start({ cwd: '/progetto', surface: 'desktop', isInteractive: true })
  await $.session.start({ cwd: '/altro', surface: 'desktop', isInteractive: true })
  await clock.settle()
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })

  expect(calls).toBe(1)
  expect(await ui.find({ type: 'Text', text: '12%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '73%' })).toBeDefined()
  await ui.unmount()
})
