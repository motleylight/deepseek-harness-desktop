/** Completion reminders follow real running transitions, including a hidden frame's current session. */
export function createSessionIndicators() {
  const states = new Map()
  function update(connectionId, sessions, currentSessionId, visible) {
    for (const session of sessions) {
      const key = JSON.stringify([connectionId, session.id])
      const previous = states.get(key)
      const running = session.running === true
      const sourceCompleted = session.completed === true
      let unread = previous?.unread === true
        || (sourceCompleted && !previous?.sourceCompleted)
        || (previous?.running === true && !running)
      if (running || (visible && currentSessionId === session.id))
        unread = false
      states.set(key, { running, sourceCompleted, unread })
    }
  }
  function get(connectionId, sessionId) {
    const state = states.get(JSON.stringify([connectionId, sessionId]))
    return state?.running ? 'running' : state?.unread ? 'completed' : 'idle'
  }
  function retain(connections) {
    for (const key of states.keys()) {
      if (!connections.includes(JSON.parse(key)[0]))
        states.delete(key)
    }
  }
  return { update, get, retain }
}
