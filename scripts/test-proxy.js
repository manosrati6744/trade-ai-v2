#!/usr/bin/env node
/**
 * Minimal HTTP CONNECT proxy on 127.0.0.1:7890 — test fixture only.
 * Lets the app prove its undici-ProxyAgent path reaches api.telegram.org.
 */
const http = require("http");
const net = require("net");

const srv = http.createServer((req, res) => {
  res.writeHead(405).end("connect-only proxy");
});
srv.on("connect", (req, sock, head) => {
  const [host, port] = String(req.url).split(":");
  const up = net.connect(Number(port) || 443, host, () => {
    sock.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head && head.length) up.write(head);
    up.pipe(sock);
    sock.pipe(up);
  });
  up.on("error", () => sock.destroy());
  sock.on("error", () => up.destroy());
});
srv.listen(7890, "127.0.0.1", () => console.log("test proxy up on 18888"));
