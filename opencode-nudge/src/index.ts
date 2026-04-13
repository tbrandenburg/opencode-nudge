import type { Plugin } from "@opencode-ai/plugin"
import { handleIdleEvent, handleUserMessage } from "./idle-handler.js"

export const OpencodeNudgePlugin: Plugin = async (input) => {
  input.client.app.log({ body: { service: "opencode-nudge", level: "info", message: "plugin loaded" } })

  return {
    event: ({ event }) => {
      if (event.type === "session.status" && event.properties.status.type === "busy") {
        handleUserMessage({ sessionID: event.properties.sessionID })
      }
      return handleIdleEvent({ event }, input.client)
    },
  }
}
