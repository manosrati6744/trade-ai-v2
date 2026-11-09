import WebSocket from "ws";
const ws = new WebSocket("wss://data.tradingview.com/socket.io/websocket", { origin: "https://www.tradingview.com" });
const frame = (s) => `~m~${Buffer.byteLength(s)}~m~${s}`;
const send = (m, p) => ws.send(frame(JSON.stringify({ m, p })));
ws.on("open", () => {
  send("set_auth_token", ["unauthorized_user_token"]);
  send("chart_create_session", ["cs_badtest123", ""]);
  send("resolve_symbol", ["cs_badtest123", "sds_sym_1", '={"adjustment":"splits","symbol":"XXX:BADPAIR"}']);
  send("create_series", ["cs_badtest123", "sds_1", "s1", "sds_sym_1", "5", 300, ""]);
});
ws.on("message", (d) => {
  const raw = d.toString();
  const re = /~m~(\d+)~m~/g;
  let m;
  while ((m = re.exec(raw))) {
    const payload = raw.slice(m.index + m[0].length, m.index + m[0].length + parseInt(m[1]));
    if (payload.startsWith("~h~")) { ws.send(frame(payload)); continue; }
    try { const j = JSON.parse(payload); if (j.m) console.log(j.m, "->", JSON.stringify(j.p).slice(0, 200)); } catch {}
  }
});
ws.on("error", (e) => console.log("ERR", e.message));
setTimeout(() => process.exit(0), 6000);
