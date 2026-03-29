import type { Plugin } from "@opencode-ai/plugin"
import { handleIdleEvent, handleUserMessage } from "./idle-handler.js"

export const AutoContinuePlugin: Plugin = async (input) => {
  return {
    event: ({ event }) => handleIdleEvent({ event }, input.client),
    "chat.message": (messageInput) => {
      handleUserMessage({ sessionID: messageInput.sessionID })
      return Promise.resolve()
    },
  }
}
