import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import process from "node:process";

import { ensureBuilt } from "./lib/ensure-built.mjs";

await ensureBuilt();

const { findListeningPortOwnerPid, stopProcess, waitForPortToClear } = await import("../dist/core/process-manager.js");

function isPidAlive(pid) {
  if (!pid) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function canConnect(port) {
  return await new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });

    const finish = (value) => {
      socket.destroy();
      resolve(value);
    };

    socket.setTimeout(250);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

async function waitForPortListening(port, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await canConnect(port)) {
      return;
    }
    await sleep(100);
  }

  throw new Error(`Timed out waiting for managed runtime port ${port} to start listening.`);
}

async function waitForPidExit(pid, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidAlive(pid)) {
      return;
    }
    await sleep(100);
  }

  throw new Error(`Timed out waiting for pid ${pid} to exit.`);
}

async function pickFreePort() {
  const net = await import("node:net");

  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Unable to resolve an ephemeral port for deterministic stopProcess verification.")));
        return;
      }

      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

let wrapper;
let runtimePort;

try {
  runtimePort = await pickFreePort();

  const childProgram = [
    "const http=require('node:http');",
    `const port=${runtimePort};`,
    "const server=http.createServer((_,res)=>{res.writeHead(200);res.end('managed');});",
    "server.listen(port,'127.0.0.1');",
    "setInterval(()=>{},1000);",
  ].join("");

  const wrapperProgram = [
    "const { spawn } = require('node:child_process');",
    "const child = spawn(process.execPath, ['-e', process.env.LIFELINE_CHILD_PROGRAM], { stdio: 'ignore' });",
    "child.unref();",
    "setInterval(()=>{},1000);",
  ].join("");

  wrapper = spawn(process.execPath, ["-e", wrapperProgram], {
    detached: process.platform !== "win32",
    stdio: ["ignore", "ignore", "pipe"],
    env: {
      ...process.env,
      LIFELINE_CHILD_PROGRAM: childProgram,
    },
  });

  let wrapperStderr = "";
  wrapper.stderr.on("data", (chunk) => {
    wrapperStderr += String(chunk);
  });

  if (!wrapper.pid) {
    throw new Error("Wrapper process did not report a pid.");
  }

  await waitForPortListening(runtimePort);

  await stopProcess(wrapper.pid);

  await waitForPidExit(wrapper.pid, 12_000);

  const portCleared = await waitForPortToClear(runtimePort, 12_000);
  if (!portCleared) {
    const ownerPid = await findListeningPortOwnerPid(runtimePort);
    throw new Error(
      `Expected stopProcess(${wrapper.pid}) to release managed runtime port ${runtimePort}, but it remained bound${ownerPid ? ` by pid ${ownerPid}` : ""}.`,
    );
  }

  if (await canConnect(runtimePort)) {
    throw new Error(`Expected port ${runtimePort} to reject new connections after stopProcess(${wrapper.pid}).`);
  }

  if (wrapperStderr.trim()) {
    throw new Error(`Wrapper emitted stderr during deterministic stopProcess verification:\n${wrapperStderr}`);
  }

  console.log("stopProcess deterministic process-tree verification passed.");
} finally {
  if (wrapper?.pid && isPidAlive(wrapper.pid)) {
    try {
      process.kill(process.platform === "win32" ? wrapper.pid : -wrapper.pid, "SIGKILL");
    } catch {
      try {
        process.kill(wrapper.pid, "SIGKILL");
      } catch {
        // best-effort cleanup
      }
    }
  }

  if (runtimePort) {
    const ownerPid = await findListeningPortOwnerPid(runtimePort).catch(() => undefined);
    if (ownerPid && isPidAlive(ownerPid)) {
      try {
        process.kill(ownerPid, "SIGKILL");
      } catch {
        // best-effort cleanup
      }
    }
  }
}
