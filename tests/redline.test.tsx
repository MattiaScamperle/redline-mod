import { expect, mock, test } from 'claude-code/testing'

const BAND = {
  plugin: 'redline-mod',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
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
    expect((await ui.find({ type: 'Text', text: '━━━━━' }))?.props.color).toBe('#f97316')
    expect(await ui.find({ type: 'Text', text: '25%' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '━━' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'reset 2h 15m' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'reset 3g 2h' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '50k / 200k' })).toBeDefined()

    const button = await ui.find({ type: 'Button', key: 'compatta' })
    expect(button?.props.variant).toBe('secondary')
    expect(button?.props.plain).toBeUndefined()
    await ui.unmount()
  }
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
  expect(await ui.find({ type: 'Text', text: '━━━━━━━━' })).toBeDefined()
  expect(await ui.findAll({ type: 'Text', text: 'n/d' })).toHaveLength(2)
  expect(await ui.find({ type: 'Text', text: '200k / 200k' })).toBeDefined()
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
    },
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

test('durante una risposta il bottone resta e spiega perché non compatta', async ($, on) => {
  const toasts: string[] = []
  on('session.measure', (_, e) => ({ changed: e.changed }))
  mock.store(on)
  on('clock.now', () => ({ value: 0 }))
  on('session.compact', () => {
    throw new Error('a turn is running')
  })
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })

  await $.session.measure({
    context: { window: 200_000, percent: 10 },
    rateLimits: [],
    changed: ['context'],
  })

  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, isWorking: true }, surface: 'desktop' })
  await ui.press({ key: 'compatta' })

  expect(toasts).toEqual(['Compattazione possibile solo a fine risposta'])
  await ui.unmount()
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
