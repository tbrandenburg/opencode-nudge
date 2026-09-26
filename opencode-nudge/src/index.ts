import { Plugin } from "@opencode/plugin"
import type { OpenCodeEvent } from "@opencode/client"
import { getIdleThreshold } from "./types.js"
import { handleIdleSession, handleUserMessage, type SendPrompt } from "./idle-handler.js"
import { handlePermissionReplied, handleToolError, handleSessionStatus } from "./deny-handler.js"
import { getNextContinuationDelay, getOrCreateState } from "./throttle.js"

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  return JSON.stringify(error) ?? String(error)
}

export default Plugin.define({
  id: "opencode-nudge",
  async setup(ctx) {
    console.info("[opencode-nudge] plugin loaded")

    const sendPrompt: SendPrompt = ({ sessionID, text }) =>
      ctx.session.prompt({ sessionID, text })
    const idleTimers = new Map<string, ReturnType<typeof setTimeout>>()
    const cancelIdleTimer = (sessionID: string): void => {
      const timer = idleTimers.get(sessionID)
      if (timer) clearTimeout(timer)
      idleTimers.delete(sessionID)
    }
    const scheduleIdleNudge = (sessionID: string): void => {
      cancelIdleTimer(sessionID)
      const retryDelay = getNextContinuationDelay(getOrCreateState(sessionID), Date.now())
      const timer = setTimeout(() => {
        idleTimers.delete(sessionID)
        void handleIdleSession({ sessionID }, sendPrompt)
      }, Math.max(getIdleThreshold(), retryDelay))
      idleTimers.set(sessionID, timer)
    }

    await ctx.tool.hook("execute.after", (event) => {
      if (event.status !== "error") return
      handleToolError({ sessionID: event.sessionID }, errorMessage(event.error), sendPrompt)
    })

    const controller = new AbortController()
    const consumeEvents = async (): Promise<void> => {
      try {
        for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
          handleEvent(event, sendPrompt, scheduleIdleNudge, cancelIdleTimer)
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error("[opencode-nudge] event subscription failed", error)
        }
      }
    }

    void consumeEvents()
    return () => {
      controller.abort()
      for (const timer of idleTimers.values()) clearTimeout(timer)
      idleTimers.clear()
    }
  },
})

function handleEvent(
  event: OpenCodeEvent,
  sendPrompt: SendPrompt,
  scheduleIdleNudge: (sessionID: string) => void,
  cancelIdleTimer: (sessionID: string) => void,
): void {
  if (event.type === "session.idle") {
    scheduleIdleNudge(event.data.sessionID)
    return
  }

  if (event.type === "session.execution.started") {
    cancelIdleTimer(event.data.sessionID)
    handleUserMessage({ sessionID: event.data.sessionID })
    return
  }

  if (
    event.type === "session.execution.succeeded" ||
    event.type === "session.execution.failed" ||
    event.type === "session.execution.interrupted"
  ) {
    scheduleIdleNudge(event.data.sessionID)
    return
  }

  if (event.type === "session.status") {
    handleSessionStatus(event)
    if (event.data.status.type === "busy") {
      cancelIdleTimer(event.data.sessionID)
      handleUserMessage({ sessionID: event.data.sessionID })
    }
    return
  }

  if (event.type === "permission.replied" && event.data.reply === "reject") {
    handlePermissionReplied({ sessionID: event.data.sessionID }, sendPrompt)
  }
}
