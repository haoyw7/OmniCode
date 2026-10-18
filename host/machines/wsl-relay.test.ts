import { randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { createServer, type Socket } from "node:net";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { WslConnection } from "./wsl";
import { WslLoopbackRelay } from "./wsl-relay";

const execute = promisify(execFile);
it.runIf(process.platform === "win32" && process.env.MONOCODE_TEST_WSL === "1")("reaches a Windows-only loopback server from a real Linux client over the mux", async () => {
  const distribution = process.env.MONOCODE_TEST_WSL_DISTRIBUTION ?? "Ubuntu-26.04";
  const node = process.env.MONOCODE_TEST_WSL_NODE!;
  if (!node) throw new Error("Set MONOCODE_TEST_WSL_NODE to the existing Linux Node runtime");
  const { stdout } = await execute("wsl.exe", ["--distribution", distribution, "--exec", "wslpath", "-a", "-u", `${process.cwd()}\\host\\wsl-exec.mjs`]);
  const entry = stdout.trim(), directory = `/tmp/monocode-relay-${randomUUID()}`, socket = `${directory}/exec.sock`;
  const args = ["--distribution", distribution, "--exec", node, entry];
  const sockets = new Set<Socket>();
  const target = createServer({ allowHalfOpen: true }, peer => {
    sockets.add(peer); peer.on("close", () => sockets.delete(peer)); peer.on("error", () => {});
    const chunks: Buffer[] = [];
    peer.on("data", chunk => chunks.push(chunk));
    peer.on("end", () => peer.end(Buffer.concat(chunks)));
  });
  await new Promise<void>(done => target.listen(0, "127.0.0.1", done));
  const address = target.address();
  await execute("wsl.exe", [...args, "prepare", directory, socket]);
  const connection = new WslConnection({ distribution, launch: () => spawn("wsl.exe", [...args, "bridge", directory, socket], { stdio: "pipe", windowsHide: true }) });
  const relay = new WslLoopbackRelay(connection);
  try {
    const environment = await relay.environment({ MONOCODE_CONTROL_ENDPOINT: `127.0.0.1:${typeof address === "object" ? address!.port : 0}` });
    const port = environment.MONOCODE_CONTROL_ENDPOINT.split(":")[1];
    const result = await connection.request<{ stdout: string; code: number }>("exec", { command: node,
      args: ["-e", "const net=require('net');const socket=net.connect(Number(process.argv[1]),'127.0.0.1');let size=0;socket.on('error',error=>{console.error(error);process.exitCode=1});socket.on('connect',()=>socket.end(Buffer.alloc(300000,97)));socket.on('data',b=>size+=b.length);socket.on('end',()=>console.log(size));", port], timeout: 10_000 });
    expect(result).toMatchObject({ stdout: "300000\n", code: 0 });
  } finally {
    await relay.close();
    await connection.request("service.shutdown").catch(() => {});
    await connection.close();
    for (const peer of sockets) peer.destroy();
    await new Promise<void>(done => target.close(() => done()));
    await execute("wsl.exe", ["--distribution", distribution, "--exec", node, "-e", "require('fs').rmSync(process.argv[1],{recursive:true,force:true})", directory]);
  }
}, 30_000);
