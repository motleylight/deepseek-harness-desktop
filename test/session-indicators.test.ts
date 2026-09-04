import { expect, it } from 'vitest'
import { createSessionIndicators } from '../plugins/dsh-tauri-connections/src/session-indicators.js'

it('marks completion on the hidden frame current session and clears only when viewed', () => {
  const indicators = createSessionIndicators()
  indicators.update('remote', [{ id: 'same', running: true }], 'same', false)
  expect(indicators.get('remote', 'same')).toBe('running')
  indicators.update('local', [{ id: 'same', running: false }], 'same', true)
  indicators.update('remote', [{ id: 'same', running: false }], 'same', false)
  expect(indicators.get('remote', 'same')).toBe('completed')
  expect(indicators.get('local', 'same')).toBe('idle')
  indicators.update('remote', [{ id: 'same', running: false }], 'different', true)
  expect(indicators.get('remote', 'same')).toBe('completed')
  indicators.update('remote', [{ id: 'same', running: false }], 'same', true)
  expect(indicators.get('remote', 'same')).toBe('idle')
})

it('does not fabricate completion from an initial idle snapshot or rearm a viewed source reminder', () => {
  const indicators = createSessionIndicators()
  indicators.update('a', [{ id: 's', running: false }], undefined, false)
  expect(indicators.get('a', 's')).toBe('idle')
  indicators.update('a', [{ id: 's', completed: true }], undefined, false)
  expect(indicators.get('a', 's')).toBe('completed')
  indicators.update('a', [{ id: 's', completed: true }], 's', true)
  indicators.update('a', [{ id: 's', completed: true }], undefined, false)
  expect(indicators.get('a', 's')).toBe('idle')
  indicators.update('a', [{ id: 's', running: true }], undefined, false)
  expect(indicators.get('a', 's')).toBe('running')
  indicators.retain([])
  expect(indicators.get('a', 's')).toBe('idle')
})
