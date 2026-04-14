import type { Plugin } from "@opencode-ai/plugin"
import { handleIdleEvent, handleUserMessage } from "./idle-handler.js"
import { handlePermissionReplied, handleToolError, handleSessionStatus } from "./deny-handler.js"

export const OpencodeNudgePlugin: Plugin = async (input) => {
  input.client.app.log({ body: { service: "opencode-nudge", level: "info", message: "plugin loaded" } })

  return {
    event: ({ event }) => {
      if (event.type === "session.status" && event.properties.status.type === "busy") {
        handleUserMessage({ sessionID: event.properties.sessionID })
      }
      handleSessionStatus({ event }, input.client)
      if (event.type === "permission.replied" && event.properties.response === "deny") {
        handlePermissionReplied({ sessionID: event.properties.sessionID }, input.client)
      }
      return handleIdleEvent({ event }, input.client)
    },
    "tool.execute.after": (_input, output) => {
      handleToolError(_input, output, input.client)
      return Promise.resolve()
    },
  }
}
