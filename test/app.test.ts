import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { AppNotReadyError, startApp, waitForReady } from "../src/app.js";
import type { Config } from "../src/types.js";
import { tempDir } from "./helpers.js";

let server: Server | undefined;
afterEach(() => server?.close());

function listen(): Promise<string> {
  server = createServer((_req, res) => res.end("ok"));
  return new Promise((r) => server!.listen(0, () => r(`http://127.0.0.1:${(server!.address() as AddressInfo).port}`)));
}

const freePort = async (): Promise<number> => {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, () => r()));
  const port = (s.address() as AddressInfo).port;
  await new Promise((r) => s.close(r));
  return port;
};

const config = (url: string, start?: string): Config => ({
  url, start, env: [], vitals: { slowMs: 1000 }, flows: [], configDir: tempDir(), configPath: "x", secrets: {},
});

describe("waitForReady", () => {
  it("resolves when the server answers 200", async () => {
    await expect(waitForReady(await listen(), 2000)).resolves.toBeUndefined();
  });

  it("times out with the url in the message", async () => {
    const url = `http://127.0.0.1:${await freePort()}`;
    await expect(waitForReady(url, 1000)).rejects.toThrow(AppNotReadyError);
    await expect(waitForReady(url, 600)).rejects.toThrow(url);
  });
});

describe("startApp", () => {
  it("returns a no-op handle when no start command is set", async () => {
    const app = await startApp(config(await listen()));
    await expect(app.stop()).resolves.toBeUndefined();
  });

  it("includes the start command's output when it crashes", async () => {
    const url = `http://127.0.0.1:${await freePort()}`;
    const start = `node -e "console.log('boom-marker'); process.exit(1)"`;
    await expect(startApp(config(url, start), 3000)).rejects.toThrow(/boom-marker/);
  });

  it("starts a server and stop() kills its process tree", async () => {
    const port = await freePort();
    const url = `http://127.0.0.1:${port}`;
    const start = `node -e "require('http').createServer((q,s)=>s.end('ok')).listen(${port})"`;
    const app = await startApp(config(url, start), 10000);
    await app.stop();
    await expect(waitForReady(url, 600)).rejects.toThrow(AppNotReadyError);
  });
});

describe("startApp safety", () => {
  it("refuses to start when something already answers at the url", async () => {
    const url = await listen();
    await expect(startApp(config(url, "node -e 0"), 2000)).rejects.toThrow(/already running/);
  });

  it("stop() kills a server that ignores SIGTERM and waits until the port is free", async () => {
    const port = await freePort();
    const url = `http://127.0.0.1:${port}`;
    const start = `node -e "process.on('SIGTERM',()=>{}); require('http').createServer((q,s)=>s.end('ok')).listen(${port})"`;
    const app = await startApp(config(url, start), 10000);
    await app.stop();
    await expect(waitForReady(url, 400)).rejects.toThrow(AppNotReadyError);
  }, 20000);

  it("stopAllApps stops every running app (used on Ctrl-C)", async () => {
    const { stopAllApps } = await import("../src/app.js");
    const port = await freePort();
    const url = `http://127.0.0.1:${port}`;
    await startApp(config(url, `node -e "require('http').createServer((q,s)=>s.end('ok')).listen(${port})"`), 10000);
    await stopAllApps();
    await expect(waitForReady(url, 400)).rejects.toThrow(AppNotReadyError);
  });
});
