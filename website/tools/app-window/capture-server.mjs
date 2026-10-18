// Loopback-only scratch server: the fixture pages POST captured DOM/CSS here.
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
const dir = process.argv[2];
createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
  if (req.method === "OPTIONS") return res.end();
  const url = new URL(req.url, "http://x");
  const name = (url.searchParams.get("name") || "").replace(/[^a-z0-9.-]/gi, "");
  if (!name) return res.writeHead(400).end();
  if (req.method === "POST") {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    await writeFile(`${dir}/${name}`, Buffer.concat(chunks));
    return res.end("ok");
  }
  try { res.end(await readFile(`${dir}/${name}`)); } catch { res.writeHead(404).end(); }
}).listen(4199, "127.0.0.1");
