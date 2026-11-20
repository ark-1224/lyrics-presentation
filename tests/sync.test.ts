import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import type { ClientCommand, DisplayState, LiveInfo, Presence, Role, ServerMessage } from "../shared/types.js";
import { createApp, createServices } from "../server/app.js";
import { openDb } from "../server/db.js";
import { parseCommand } from "../server/ws.js";
import { startTestServer, testConfig } from "./helpers.js";

type Server = Awaited<ReturnType<typeof startTestServer>>;

/** A WebSocket test client that remembers every message and can wait for conditions. */
class Client {
  ws: WebSocket;
  messages: ServerMessage[] = [];
  constructor(url: string, role: Role, headers: Record<string, string> = {}) {
    this.ws = new WebSocket(`${url}?role=${role}`, { headers });
    this.ws.on("message", (d) => this.messages.push(JSON.parse(d.toString()) as ServerMessage));
  }
  get display(): DisplayState | undefined {
    const last = [...this.messages].reverse().find((m) => m.type === "display" || m.type === "live");
    return last?.type === "display" ? last.state : last?.type === "live" ? last.display : undefined;
  }
  get live(): { live: LiveInfo; presence: Presence } | undefined {
    const last = [...this.messages].reverse().find((m) => m.type === "live");
    return last?.type === "live" ? { live: last.live, presence: last.presence } : undefined;
  }
  send(cmd: ClientCommand | string) {
    this.ws.send(typeof cmd === "string" ? cmd : JSON.stringify(cmd));
  }
  async until(check: () => boolean, what: string) {
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      if (check()) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`Timed out waiting for: ${what}`);
  }
  async ready() {
    await this.until(() => this.messages.length > 0, "first message");
  }
  close() {
    this.ws.close();
  }
}

let server: Server;
const open: Client[] = [];
const connect = async (role: Role, headers?: Record<string, string>) => {
  const c = new Client(server.wsUrl, role, headers);
  open.push(c);
  await c.ready();
  return c;
};
const api = async (method: string, url: string, body?: unknown) => {
  const res = await fetch(server.httpUrl + url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return res.status === 204 ? undefined : ((await res.json()) as any); // eslint-disable-line @typescript-eslint/no-explicit-any
};

/** Creates a presentation with the given slides and returns its id and slide ids. */
async function makePresentation(name: string, slides: { lyrics: string; notes?: string }[]) {
  const p = await api("POST", "/api/presentations", { name });
  const ids: number[] = [];
  for (const s of slides) ids.push((await api("POST", `/api/presentations/${p.id}/slides`, s)).id);
  return { id: p.id as number, slideIds: ids };
}

afterEach(async () => {
  for (const c of open.splice(0)) c.close();
  await server?.close();
});

describe("live sync", () => {
  it("shows the live slide on both displays and follows next/prev/goto/blank", async () => {
    server = await startTestServer();
    const song = await makePresentation("Song", [{ lyrics: "A" }, { lyrics: "B" }, { lyrics: "C" }]);
    const control = await connect("control");
    const main = await connect("main");
    const singers = await connect("singers");

    control.send({ type: "show", presentationId: song.id });
    await main.until(() => main.display?.lyrics === "A", "main shows A");
    await singers.until(() => singers.display?.lyrics === "A", "singers shows A");

    control.send({ type: "next" });
    await main.until(() => main.display?.lyrics === "B", "main shows B");
    await singers.until(() => singers.display?.lyrics === "B", "singers shows B");
    control.send({ type: "next" });
    control.send({ type: "next" }); // past the end: stays on the last slide
    await main.until(() => main.display?.lyrics === "C", "main shows C");
    await control.until(() => control.live?.live.slideIndex === 2, "control index 2");
    expect(control.live?.live.nextLyrics).toBeNull();

    control.send({ type: "prev" });
    await main.until(() => main.display?.lyrics === "B", "main back to B");

    control.send({ type: "goto", slideId: song.slideIds[0]! });
    await singers.until(() => singers.display?.lyrics === "A", "jump to A");

    control.send({ type: "blank" });
    await main.until(() => main.display?.blank === true, "main blank");
    await singers.until(() => singers.display?.blank === true, "singers blank");
    expect(main.display?.lyrics).toBe("A"); // text is still known, just hidden
    control.send({ type: "blank", value: false });
    await main.until(() => main.display?.blank === false, "unblank");
  });

  it("brings a late-joining or refreshed display up to date immediately", async () => {
    server = await startTestServer();
    const song = await makePresentation("Song", [{ lyrics: "A" }, { lyrics: "B" }]);
    const control = await connect("control");
    control.send({ type: "show", presentationId: song.id, slideId: song.slideIds[1]! });
    await control.until(() => control.live?.live.slideIndex === 1, "on slide 2");

    const late = await connect("main"); // connects after the fact
    expect(late.display?.lyrics).toBe("B"); // first message already has the right slide
    late.close();
    const refreshed = await connect("main");
    expect(refreshed.display?.lyrics).toBe("B");
  });

  it("never sends private notes to the displays", async () => {
    server = await startTestServer();
    const song = await makePresentation("Song", [{ lyrics: "Visible", notes: "SECRET-NOTE" }]);
    const control = await connect("control");
    const main = await connect("main");
    const singers = await connect("singers");
    control.send({ type: "show", presentationId: song.id });
    await main.until(() => main.display?.lyrics === "Visible", "shown");
    await singers.until(() => singers.display?.lyrics === "Visible", "shown");
    expect(JSON.stringify(main.messages)).not.toContain("SECRET-NOTE");
    expect(JSON.stringify(singers.messages)).not.toContain("SECRET-NOTE");
    await control.until(() => control.live?.live.notes === "SECRET-NOTE", "control sees notes");
  });

  it("reports which displays are connected", async () => {
    server = await startTestServer();
    const control = await connect("control");
    expect(control.live?.presence).toEqual({ main: 0, singers: 0 });
    const main = await connect("main");
    await control.until(() => control.live?.presence.main === 1, "main connected");
    const singers = await connect("singers");
    await control.until(() => control.live?.presence.singers === 1, "singers connected");
    main.close();
    await control.until(() => control.live?.presence.main === 0, "main disconnected");
    expect(control.live?.presence.singers).toBe(1);
    singers.close();
  });

  it("ignores commands from display sockets and malformed messages", async () => {
    server = await startTestServer();
    const song = await makePresentation("Song", [{ lyrics: "A" }, { lyrics: "B" }]);
    const control = await connect("control");
    const main = await connect("main");
    control.send({ type: "show", presentationId: song.id });
    await main.until(() => main.display?.lyrics === "A", "shown");

    main.send({ type: "next" }); // a display must not be able to drive the show
    control.send("not json at all");
    control.send(JSON.stringify({ type: "show", presentationId: 99999 })); // unknown presentation
    control.send(JSON.stringify({ type: "goto", slideId: "x" }));
    await new Promise((r) => setTimeout(r, 150));
    expect(main.display?.lyrics).toBe("A");
    expect(control.live?.live.presentationId).toBe(song.id);
  });

  it("updates the displays when the live slide is edited, reordered, deleted or restyled", async () => {
    server = await startTestServer();
    const song = await makePresentation("Song", [{ lyrics: "A" }, { lyrics: "B" }, { lyrics: "C" }]);
    const control = await connect("control");
    const main = await connect("main");
    control.send({ type: "show", presentationId: song.id, slideId: song.slideIds[1]! });
    await main.until(() => main.display?.lyrics === "B", "on B");

    await api("PATCH", `/api/slides/${song.slideIds[1]}`, { lyrics: "B edited" });
    await main.until(() => main.display?.lyrics === "B edited", "edit shows live");

    // Reordering must not change what is on screen: the same slide stays live.
    await api("PUT", `/api/presentations/${song.id}/slides/order`, { slideIds: [song.slideIds[1], song.slideIds[0], song.slideIds[2]] });
    await control.until(() => control.live?.live.slideIndex === 0, "live slide moved to position 0");
    expect(main.display?.lyrics).toBe("B edited");

    await api("PUT", `/api/presentations/${song.id}/settings`, { main: { fontSize: 12, color: "#ff0000" } });
    await main.until(() => main.display?.settings.main.fontSize === 12, "settings propagate");
    expect(main.display?.settings.main.color).toBe("#ff0000");

    // Deleting the live slide moves to its neighbour instead of leaving the screen empty.
    await api("DELETE", `/api/slides/${song.slideIds[1]}`);
    await main.until(() => main.display?.lyrics === "A", "neighbour shown after delete");

    // Deleting the live presentation clears the screens.
    await api("DELETE", `/api/presentations/${song.id}`);
    await main.until(() => main.display?.lyrics === "", "screen cleared");
    await control.until(() => control.live?.live.presentationId === null, "nothing live");
  });

  it("resumes on the same slide after a server restart", async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lyrics-restart-"));
    const config = testConfig({ dataDir, videosDir: path.join(dataDir, "videos") });
    const db1 = openDb(dataDir);
    const first = createServices(config, db1);
    const p = first.repo.createPresentation("Song");
    first.repo.addSlide(p.id, "A");
    const b = first.repo.addSlide(p.id, "B")!;
    first.live.command({ type: "show", presentationId: p.id, slideId: b.id });
    first.live.command({ type: "blank", value: true });
    db1.close();

    const db2 = openDb(dataDir);
    const second = createServices(config, db2);
    expect(second.live.getDisplay().lyrics).toBe("B");
    expect(second.live.getDisplay().blank).toBe(true);
    expect(second.live.getInfo().slideIndex).toBe(1);
    createApp(config, second); // app still builds on a restored state
    db2.close();
  });
});

describe("jumping between slides", () => {
  it("jumps freely in any order (1 -> 5 -> 2 -> last -> 1) on the control panel and both displays", async () => {
    server = await startTestServer();
    const song = await makePresentation(
      "Long song",
      Array.from({ length: 6 }, (_, i) => ({ lyrics: `Verse ${i + 1}\nsecond line` })),
    );
    const control = await connect("control");
    const main = await connect("main");
    const singers = await connect("singers");
    control.send({ type: "show", presentationId: song.id });
    await main.until(() => main.display?.lyrics.startsWith("Verse 1") === true, "starts on slide 1");

    // The control panel gets a list of every slide with its first line, to build the jump list.
    expect(control.live?.live.slides.map((x) => x.text)).toEqual(["Verse 1", "Verse 2", "Verse 3", "Verse 4", "Verse 5", "Verse 6"]);
    expect(control.live?.live.slides.map((x) => x.id)).toEqual(song.slideIds);

    // Straight from slide 1 to slide 5, skipping 2, 3 and 4.
    for (const [target, label] of [[4, "Verse 5"], [1, "Verse 2"], [5, "Verse 6"], [0, "Verse 1"]] as const) {
      control.send({ type: "goto", slideId: song.slideIds[target]! });
      await main.until(() => main.display?.lyrics.startsWith(label) === true, `main shows ${label}`);
      await singers.until(() => singers.display?.lyrics.startsWith(label) === true, `singers shows ${label}`);
      await control.until(() => control.live?.live.slideIndex === target, `control index ${target}`);
    }

    // Next/Previous continue from wherever the jump landed.
    control.send({ type: "goto", slideId: song.slideIds[3]! });
    await control.until(() => control.live?.live.slideIndex === 3, "on slide 4");
    control.send({ type: "next" });
    await main.until(() => main.display?.lyrics.startsWith("Verse 5") === true, "next goes to 5");
  });

  it("ignores a jump to a slide from a different presentation", async () => {
    server = await startTestServer();
    const a = await makePresentation("A", [{ lyrics: "A1" }, { lyrics: "A2" }]);
    const b = await makePresentation("B", [{ lyrics: "B1" }]);
    const control = await connect("control");
    control.send({ type: "show", presentationId: a.id });
    await control.until(() => control.live?.live.presentationId === a.id, "A is live");
    control.send({ type: "goto", slideId: b.slideIds[0]! });
    await new Promise((r) => setTimeout(r, 150));
    expect(control.live?.live.presentationId).toBe(a.id);
    expect(control.live?.live.slideIndex).toBe(0);
  });

  it("keeps the jump list up to date when slides are edited, added or removed", async () => {
    server = await startTestServer();
    const song = await makePresentation("Song", [{ lyrics: "One" }, { lyrics: "" }, { lyrics: "x".repeat(200) }]);
    const control = await connect("control");
    control.send({ type: "show", presentationId: song.id });
    await control.until(() => control.live?.live.slides.length === 3, "list loaded");
    expect(control.live?.live.slides[1]?.text).toBe(""); // an empty slide has no first line
    expect(control.live?.live.slides[2]?.text.length).toBe(70); // long lines are shortened
    expect(control.live?.live.slides[2]?.text.endsWith("…")).toBe(true);

    await api("PATCH", `/api/slides/${song.slideIds[1]}`, { lyrics: "\n\n  Second  \nmore" });
    await control.until(() => control.live?.live.slides[1]?.text === "Second", "edit appears in list");
    await api("POST", `/api/presentations/${song.id}/slides`, { lyrics: "Four" });
    await control.until(() => control.live?.live.slides.length === 4, "added slide appears");
    await api("DELETE", `/api/slides/${song.slideIds[0]}`);
    await control.until(() => control.live?.live.slides.length === 3 && control.live.live.slides[0]?.text === "Second", "removed slide disappears");
  });
});

describe("jumping to a section", () => {
  it("moves the control panel and both displays when a section button is pressed", async () => {
    server = await startTestServer();
    const song = await makePresentation("Song", [{ lyrics: "Verse 1" }, { lyrics: "Chorus" }, { lyrics: "Verse 2" }, { lyrics: "Bridge" }]);
    // Label the slides (this is what the dropdown on each slide card does).
    const labels = ["verse", "chorus", "verse", "bridge"];
    for (const [i, section] of labels.entries()) await api("PATCH", `/api/slides/${song.slideIds[i]}`, { section });

    const control = await connect("control");
    const main = await connect("main");
    const singers = await connect("singers");
    control.send({ type: "show", presentationId: song.id });
    await main.until(() => main.display?.lyrics === "Verse 1", "starts on verse 1");
    expect(control.live?.live.slides.map((s) => s.section)).toEqual(labels);

    control.send({ type: "section", section: "bridge" });
    await main.until(() => main.display?.lyrics === "Bridge", "main jumps to the bridge");
    await singers.until(() => singers.display?.lyrics === "Bridge", "singers jump to the bridge");
    await control.until(() => control.live?.live.slideIndex === 3, "control sees index 3");

    control.send({ type: "section", section: "chorus" });
    await main.until(() => main.display?.lyrics === "Chorus", "then back to the chorus");

    control.send({ type: "section", section: "verse" }); // the next verse after the chorus
    await main.until(() => main.display?.lyrics === "Verse 2", "next verse is verse 2");

    // A display can't press buttons, and a section nobody used does nothing.
    main.send({ type: "section", section: "bridge" });
    control.send({ type: "section", section: "outro" });
    await new Promise((r) => setTimeout(r, 150));
    expect(main.display?.lyrics).toBe("Verse 2");
  });
});

describe("WebSocket access control", () => {
  it("lets displays connect without a password but not the control role", async () => {
    server = await startTestServer({ appPassword: "secret" });
    const main = await connect("main"); // open, read-only
    expect(main.display).toBeDefined();

    const rejected = await new Promise<number>((resolve) => {
      const ws = new WebSocket(`${server.wsUrl}?role=control`);
      ws.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
      ws.on("error", () => {});
    });
    expect(rejected).toBe(401);

    // With the login cookie, control is accepted.
    const login = await fetch(`${server.httpUrl}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "secret" }),
    });
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const control = await connect("control", { Cookie: cookie });
    expect(control.live).toBeDefined();
  });

  it("refuses a control connection from another website's origin", async () => {
    server = await startTestServer();
    const status = await new Promise<number>((resolve) => {
      const ws = new WebSocket(`${server.wsUrl}?role=control`, { headers: { Origin: "https://evil.example" } });
      ws.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
      ws.on("error", () => {});
    });
    expect(status).toBe(403);
  });

  it("rejects unknown roles and paths", async () => {
    server = await startTestServer();
    const cases: [string, number][] = [
      [`${server.wsUrl}?role=admin`, 400],
      [`${server.wsUrl}`, 400],
      [`ws://127.0.0.1:${server.port}/other?role=main`, 404],
    ];
    for (const [url, expected] of cases) {
      const status = await new Promise<number>((resolve) => {
        const ws = new WebSocket(url);
        ws.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0));
        ws.on("error", () => {});
      });
      expect(status, url).toBe(expected);
    }
  });
});

describe("parseCommand", () => {
  it("accepts valid commands", () => {
    expect(parseCommand('{"type":"next"}')).toEqual({ type: "next" });
    expect(parseCommand('{"type":"prev"}')).toEqual({ type: "prev" });
    expect(parseCommand('{"type":"blank"}')).toEqual({ type: "blank" });
    expect(parseCommand('{"type":"blank","value":true}')).toEqual({ type: "blank", value: true });
    expect(parseCommand('{"type":"goto","slideId":4}')).toEqual({ type: "goto", slideId: 4 });
    expect(parseCommand('{"type":"show","presentationId":2}')).toEqual({ type: "show", presentationId: 2 });
    expect(parseCommand('{"type":"show","presentationId":2,"slideId":9}')).toEqual({ type: "show", presentationId: 2, slideId: 9 });
  });
  it("rejects everything else", () => {
    for (const bad of ["", "null", "[]", "{", '{"type":"explode"}', '{"type":"goto"}', '{"type":"goto","slideId":-1}', '{"type":"show","presentationId":"1"}']) {
      expect(parseCommand(bad)).toBeUndefined();
    }
  });
});
