import type http from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import type { ClientCommand, Presence, Role, ServerMessage } from "../shared/types.js";
import type { Auth } from "./auth.js";
import type { Live } from "./live.js";

const ROLES: Role[] = ["control", "main", "singers"];
const HEARTBEAT_MS = 15_000;

/** True when there is no Origin header (non-browser client) or it matches the Host we were reached on. */
function sameOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (!origin) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Parse and validate a control message. Anything unexpected returns undefined and is ignored. */
export function parseCommand(raw: string): ClientCommand | undefined {
  let msg: unknown;
  try {
    msg = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof msg !== "object" || msg === null) return undefined;
  const m = msg as Record<string, unknown>;
  const isId = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;
  switch (m.type) {
    case "next":
    case "prev":
      return { type: m.type };
    case "blank":
      return typeof m.value === "boolean" ? { type: "blank", value: m.value } : { type: "blank" };
    case "goto":
      return isId(m.slideId) ? { type: "goto", slideId: m.slideId } : undefined;
    case "show":
      if (!isId(m.presentationId)) return undefined;
      return isId(m.slideId)
        ? { type: "show", presentationId: m.presentationId, slideId: m.slideId }
        : { type: "show", presentationId: m.presentationId };
    default:
      return undefined;
  }
}

/**
 * Real-time sync over one WebSocket endpoint: /ws?role=control|main|singers
 *
 * - "main" / "singers" (the display windows) are read-only and need no login: they only
 *   receive what is on screen. They get the full state the moment they connect, so a display
 *   that refreshes or joins late is immediately correct.
 * - "control" must carry the login cookie (when APP_PASSWORD is set) and is the only role
 *   whose messages are acted on.
 */
export function attachWebSocket(server: http.Server, deps: { live: Live; auth: Auth }) {
  const { live, auth } = deps;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  const clients = new Map<WebSocket, Role>();
  const alive = new WeakSet<WebSocket>();

  const send = (ws: WebSocket, msg: ServerMessage) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };
  const each = (role: Role, fn: (ws: WebSocket) => void) => {
    for (const [ws, r] of clients) if (r === role) fn(ws);
  };

  function presence(): Presence {
    let main = 0;
    let singers = 0;
    for (const r of clients.values()) {
      if (r === "main") main++;
      if (r === "singers") singers++;
    }
    return { main, singers };
  }
  const pushControl = (ws: WebSocket) => send(ws, { type: "live", live: live.getInfo(), presence: presence(), display: live.getDisplay() });
  const pushAllControls = () => each("control", pushControl);

  live.onDisplay((state) => {
    each("main", (ws) => send(ws, { type: "display", state }));
    each("singers", (ws) => send(ws, { type: "display", state }));
  });
  live.onInfo(pushAllControls);

  server.on("upgrade", (req, socket, head) => {
    const reject = (status: string) => {
      socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`);
      socket.destroy();
    };
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/ws") return reject("404 Not Found");
    const role = url.searchParams.get("role") as Role | null;
    if (!role || !ROLES.includes(role)) return reject("400 Bad Request");
    if (role === "control") {
      if (!auth.isAuthenticated(req)) return reject("401 Unauthorized");
      // Block other websites from driving the control socket with the operator's cookie.
      if (!sameOrigin(req.headers.origin, req.headers.host)) return reject("403 Forbidden");
    }
    wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, role));
  });

  function onConnection(ws: WebSocket, role: Role) {
    clients.set(ws, role);
    alive.add(ws);
    ws.on("pong", () => alive.add(ws));

    if (role === "control") {
      pushControl(ws);
      ws.on("message", (data) => {
        const cmd = parseCommand(data.toString());
        if (cmd) live.command(cmd);
      });
    } else {
      send(ws, { type: "display", state: live.getDisplay() });
    }
    ws.on("close", () => {
      clients.delete(ws);
      if (role !== "control") pushAllControls(); // a display went away: update the status lights
    });
    ws.on("error", () => ws.terminate());
    if (role !== "control") pushAllControls(); // a display appeared
  }

  // Heartbeat: an app-level message (so browsers can notice silence) plus a protocol ping
  // (so we can drop connections that died without closing, e.g. laptop sleep, Wi-Fi loss).
  const timer = setInterval(() => {
    for (const ws of clients.keys()) {
      if (!alive.has(ws)) {
        ws.terminate();
        continue;
      }
      alive.delete(ws); // must answer this ping (pong) before the next round
      ws.ping();
      send(ws, { type: "hb" });
    }
  }, HEARTBEAT_MS);
  timer.unref();

  return {
    presence,
    close() {
      clearInterval(timer);
      for (const ws of clients.keys()) ws.terminate();
      wss.close();
    },
  };
}
