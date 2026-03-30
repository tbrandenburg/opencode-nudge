import type { Plugin } from "@opencode-ai/plugin"
import { handleIdleEvent, handleUserMessage } from "./idle-handler.js"

export const OpencodeNudgePlugin: Plugin = async (input) => {
  input.client.app.log({ body: { service: "opencode-nudge", level: "info", message: "plugin loaded" } })

  return {
    event: ({ event }) => handleIdleEvent({ event }, input.client),
    "chat.message": (messageInput) => {
      handleUserMessage({ sessionID: messageInput.sessionID })
      return Promise.resolve()
    },
  }
}
