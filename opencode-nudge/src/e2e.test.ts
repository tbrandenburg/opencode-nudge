import { afterAll, describe, expect, it } from "bun:test"
import { OpenCode } from "@opencode/client"
import { spawn, type ChildProcess } from "node:child_process"
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { once } from "node:events"
import { CONTINUE_PROMPT } from "./types.js"

const E2E_TIMEOUT_MS = Number(process.env["OPENCODE_NUDGE_E2E_TIMEOUT_MS"] ?? 90_000)
const serverChildren: ChildProcess[] = []
const tempDirs: string[] = []

afterAll(async () => {
  for (const child of serverChildren) {
    if (child.exitCode !== null || child.signalCode !== null) continue
    child.kill("SIGTERM")
    await once(child, "exit")
  }
  await Promise.all(tempDirs.map((directory) => rm(directory, { recursive: true, force: true })))
})

describe("opencode-nudge v2 plugin — E2E", () => {
  it(
    "injects a continuation prompt after a real v2 session becomes idle",
    async () => {
      const executable = process.env["OPENCODE_BIN"] ?? "opencode"
      const runtime = await Bun.$`${executable} --version`.quiet()
      const version = runtime.stdout.toString().trim()
      expect(version).toMatch(/^opencode v2\./)

      const directory = await mkdtemp(join(tmpdir(), "opencode-nudge-v2-e2e-"))
      tempDirs.push(directory)
      const port = await getFreePort()
      const baseUrl = `http://127.0.0.1:${port}`
      const serverPassword = "opencode-nudge-e2e-only"
      const localPlugins = join(directory, ".opencode", "plugins")
      await mkdir(localPlugins, { recursive: true })
      await symlink(resolve(process.cwd(), "dist/index.js"), join(localPlugins, "opencode-nudge.js"))
      await writeFile(
        join(directory, "opencode.json"),
        JSON.stringify({
          "$schema": "https://opencode.ai/config.json",
          model: "opencode/big-pickle",
        }),
      )

      const child = spawn(executable, ["serve", "--hostname", "127.0.0.1", "--port", String(port), "--print-logs"], {
        cwd: directory,
        env: {
          ...process.env,
          HOME: directory,
          XDG_CONFIG_HOME: join(directory, "config"),
          XDG_DATA_HOME: join(directory, "data"),
          OPENCODE_IDLE_THRESHOLD_MS: "0",
          OPENCODE_SERVER_PASSWORD: serverPassword,
        },
        stdio: ["ignore", "pipe", "pipe"],
      })
      serverChildren.push(child)
      const output: string[] = []
      child.stdout?.on("data", (chunk: Buffer) => output.push(chunk.toString()))
      child.stderr?.on("data", (chunk: Buffer) => output.push(chunk.toString()))

      const client = OpenCode.make({
        baseUrl,
        headers: {
          authorization: `Basic ${Buffer.from(`opencode:${serverPassword}`).toString("base64")}`,
        },
      })
      await waitForServer(baseUrl, child)
      const session = await client.session.create({})
      const sessionID = session.id
      const controller = new AbortController()
      const events = client.event.subscribe({ signal: controller.signal })
      const eventReader = (async () => {
        for await (const event of events) {
          if (
            event.type === "session.inbox.enqueued" &&
            event.data.sessionID === sessionID &&
            event.data.item.type === "user" &&
            event.data.item.payload.text === CONTINUE_PROMPT
          ) {
            return true
          }
        }
        return false
      })().catch((error: unknown) => {
        if (controller.signal.aborted) return false
        throw error
      })
      await Bun.sleep(200)
      try {
        await client.session.prompt({ sessionID, text: "Reply with exactly: READY" })
        const found = await withTimeout(eventReader, E2E_TIMEOUT_MS)
        expect(found).toBe(true)
      } catch (error) {
        throw new Error(`${String(error)}\nOpenCode server output:\n${output.join("")}`)
      } finally {
        controller.abort()
      }
    },
    E2E_TIMEOUT_MS + 15_000,
  )
})

async function getFreePort(): Promise<number> {
  const server = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } })
  const port = server.port
  server.stop(true)
  return port
}

async function waitForServer(baseUrl: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`OpenCode server exited with ${child.exitCode}`)
    try {
      const response = await fetch(`${baseUrl}/global/health`)
      if (response.ok) return
    } catch {
      await Bun.sleep(100)
    }
  }
  throw new Error("Timed out waiting for OpenCode v2 server")
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out after ${timeoutMs}ms waiting for continuation prompt`)),
      timeoutMs,
    )
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}
