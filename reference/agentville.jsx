import React, { useState, useEffect, useRef, useCallback } from "react";

// ────────────────────────────────────────────────────────────────
// AGENTVILLE v0 — a tiny persistent world of AI agents.
// Each agent is a real Claude call: its own persona, needs,
// private memories, and relationships. You watch them live.
// ────────────────────────────────────────────────────────────────

const LOCATIONS = [
  { id: "cafe", name: "The Kettle Café", emoji: "☕", kind: "food" },
  { id: "park", name: "Fountain Park", emoji: "🌳", kind: "social" },
  { id: "workshop", name: "The Workshop", emoji: "🔧", kind: "work" },
  { id: "maya_home", name: "Maya's Cottage", emoji: "🏠", kind: "home", owner: "maya" },
  { id: "reg_home", name: "Reg's House", emoji: "🏡", kind: "home", owner: "reg" },
  { id: "kit_home", name: "Kit's Loft", emoji: "🛋️", kind: "home", owner: "kit" },
];

const AGENT_DEFS = [
  {
    id: "maya",
    name: "Maya",
    emoji: "🎨",
    color: "#ff9e7d",
    home: "maya_home",
    persona:
      "a 29-year-old barista and painter. Warm, chatty, a little scattered. Her long-term goal is to organize a town art fair, and she is always trying to recruit help for it.",
    seedMemories: [
      "The art fair won't happen unless I actually ask people to help.",
      "Reg is handy — he could build booths. Kit could put it in the newsletter.",
    ],
  },
  {
    id: "reg",
    name: "Reg",
    emoji: "🔧",
    color: "#7db8ff",
    home: "reg_home",
    persona:
      "a 63-year-old retired controls engineer. Gruff but kind underneath. He is restoring an old shortwave radio at the Workshop and privately thinks most people talk too much.",
    seedMemories: [
      "The radio's filter capacitors still hum wrong. Need bench time at the Workshop.",
      "Quiet mornings are the good mornings.",
    ],
  },
  {
    id: "kit",
    name: "Kit",
    emoji: "📓",
    color: "#8fd6a4",
    home: "kit_home",
    persona:
      "a 21-year-old student who writes a small weekly newsletter about the town. Curious, nosy, collects everyone's stories. Deadline pressure follows them everywhere.",
    seedMemories: [
      "Newsletter deadline is Friday and I still don't have a lead story.",
      "There's always a story if you just go talk to people.",
    ],
  },
];

// ── helpers ─────────────────────────────────────────────────────
const clone = (o) => JSON.parse(JSON.stringify(o));
const clampN = (n) => Math.max(0, Math.min(100, Math.round(n)));
const rand = (n) => Math.floor(Math.random() * n);

function fmtTime(mins) {
  const h24 = Math.floor(mins / 60) % 24;
  const mm = mins % 60;
  const ap = h24 >= 12 ? "PM" : "AM";
  let h = h24 % 12;
  if (h === 0) h = 12;
  return `${h}:${String(mm).padStart(2, "0")} ${ap}`;
}

function skyEmoji(mins) {
  const h = Math.floor(mins / 60) % 24;
  if (h >= 6 && h < 17) return "☀️";
  if (h >= 17 && h < 20) return "🌇";
  return "🌙";
}

function relLabel(score) {
  if (score >= 60) return "close friend";
  if (score >= 30) return "friend";
  if (score >= 12) return "acquaintance";
  return "stranger";
}

const locById = (id) => LOCATIONS.find((l) => l.id === id) || LOCATIONS[0];

function findLocation(target) {
  if (!target) return null;
  const t = String(target).toLowerCase();
  return (
    LOCATIONS.find((l) => l.id === t) ||
    LOCATIONS.find(
      (l) => l.name.toLowerCase().includes(t) || t.includes(l.name.toLowerCase())
    ) ||
    null
  );
}

function freshWorld() {
  const agents = {};
  AGENT_DEFS.forEach((d) => {
    agents[d.id] = {
      id: d.id,
      name: d.name,
      emoji: d.emoji,
      color: d.color,
      home: d.home,
      persona: d.persona,
      location: d.home,
      needs: {
        energy: 60 + rand(25),
        fullness: 55 + rand(25),
        social: 45 + rand(25),
      },
      memories: d.seedMemories.map((m) => `[Day 1, morning] ${m}`),
      relationships: Object.fromEntries(
        AGENT_DEFS.filter((o) => o.id !== d.id).map((o) => [o.id, 6])
      ),
      thought: "Just waking up.",
      lastAction: "idle",
    };
  });
  return {
    day: 1,
    minutes: 7 * 60,
    agents,
    nextLogId: 2,
    log: [
      {
        id: 1,
        day: 1,
        minutes: 7 * 60,
        kind: "system",
        text: "A quiet morning settles over Agentville.",
      },
    ],
  };
}

// ── Claude API ──────────────────────────────────────────────────
async function callClaude(prompt) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || "API error");
  return (data.content || [])
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("");
}

function extractJson(text) {
  const clean = String(text).replace(/```json|```/gi, "").trim();
  const s = clean.indexOf("{");
  const e = clean.lastIndexOf("}");
  if (s === -1 || e === -1) throw new Error("No JSON in response");
  return JSON.parse(clean.slice(s, e + 1));
}

function decisionPrompt(a, w) {
  const here = locById(a.location);
  const others = Object.values(w.agents).filter((o) => o.id !== a.id);
  const nearby = others.filter((o) => o.location === a.location).map((o) => o.name);
  const townsfolk = others.map((o) => o.name).join(", ");
  const places = LOCATIONS.filter((l) => l.id !== a.location)
    .map((l) => l.name)
    .join("; ");
  const mem = a.memories.slice(-8).map((m) => "- " + m).join("\n") || "- (nothing yet)";
  const n = a.needs;
  const hints = [];
  if (n.energy <= 15) hints.push("You are exhausted.");
  if (n.fullness <= 15) hints.push("You are very hungry.");
  if (n.social <= 15) hints.push("You feel lonely.");
  const h = Math.floor(w.minutes / 60) % 24;
  if (h >= 22 || h < 6) hints.push("It is late at night.");
  return `You are ${a.name}, ${a.persona}
It is Day ${w.day}, ${fmtTime(w.minutes)} in the small town of Agentville.
You are at ${here.name}. ${nearby.length ? "Also here: " + nearby.join(", ") + "." : "No one else is here."}
Other townsfolk: ${townsfolk}.
Your needs, 0 to 100 where low is bad — energy ${n.energy}, fullness ${n.fullness}, social ${n.social}.${hints.length ? " " + hints.join(" ") : ""}
Your recent memories, oldest first:
${mem}
Places you can walk to: ${places}.
Choose ONE action for the next 30 minutes. Stay true to your personality and long-term goal, and vary your day like a real person would. Reply with ONLY this JSON and nothing else:
{"action":"move|talk|eat|sleep|work|idle","target":"<place name if move, person name if talk, otherwise null>","thought":"<one short sentence of inner monologue>"}
Rules: talk only with someone at your location. sleep only at your own home (${locById(a.home).name}). eat only at The Kettle Café or your own home. work means pursuing your personal project wherever you are.`;
}

function conversationPrompt(w, a, b) {
  const here = locById(a.location);
  const rel = relLabel(a.relationships[b.id] || 0);
  const memA = a.memories.slice(-5).map((m) => "- " + m).join("\n");
  const memB = b.memories.slice(-5).map((m) => "- " + m).join("\n");
  return `Write a brief, natural conversation between two townsfolk at ${here.name}, ${fmtTime(w.minutes)} on Day ${w.day}. They are ${rel}s.
${a.name}: ${a.persona} Current thought: "${a.thought}"
${a.name}'s recent memories:
${memA}
${b.name}: ${b.persona}
${b.name}'s recent memories:
${memB}
2 to 4 lines total, each under 18 words, in their distinct voices. Let it move something forward or reveal something. Reply with ONLY this JSON and nothing else:
{"lines":[{"speaker":"${a.name}","text":"..."},{"speaker":"${b.name}","text":"..."}],"topic":"<3 to 6 word topic>"}`;
}

// ── component ───────────────────────────────────────────────────
export default function Agentville() {
  const [world, setWorld] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [restored, setRestored] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [ticking, setTicking] = useState(false);
  const [thinkingId, setThinkingId] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [apiWarn, setApiWarn] = useState(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const worldRef = useRef(null);
  const tickingRef = useRef(false);
  const playingRef = useRef(false);

  // load persisted world (or start fresh)
  useEffect(() => {
    (async () => {
      let w = null;
      try {
        const r = await window.storage.get("agentville:world");
        if (r && r.value) {
          w = JSON.parse(r.value);
          setRestored(true);
        }
      } catch (e) {
        // no saved world — that's fine
      }
      if (!w) w = freshWorld();
      worldRef.current = w;
      setWorld(w);
      setLoaded(true);
    })();
    return () => {
      playingRef.current = false;
    };
  }, []);

  const commit = useCallback((w) => {
    const snap = clone(w);
    worldRef.current = snap;
    setWorld(snap);
  }, []);

  function addLog(w, kind, text, agent, lines, agentB) {
    w.log.unshift({
      id: w.nextLogId++,
      day: w.day,
      minutes: w.minutes,
      kind,
      text,
      color: agent ? agent.color : null,
      colorB: agentB ? agentB.color : null,
      lines: lines || null,
    });
    if (w.log.length > 60) w.log.length = 60;
  }

  function addMemory(a, w, text) {
    a.memories.push(`[Day ${w.day}, ${fmtTime(w.minutes)}] ${text}`);
    if (a.memories.length > 40) a.memories.splice(0, a.memories.length - 40);
  }

  async function runConversation(w, a, b) {
    const raw = await callClaude(conversationPrompt(w, a, b));
    const d = extractJson(raw);
    const lines = (d.lines || []).slice(0, 4).map((l) => ({
      speaker: String(l.speaker || "").slice(0, 20),
      text: String(l.text || "").slice(0, 160),
    }));
    const topic = String(d.topic || "small talk").slice(0, 60);
    a.lastAction = "talk";
    b.lastAction = "talk";
    a.needs.social = clampN(a.needs.social + 28);
    b.needs.social = clampN(b.needs.social + 28);
    a.relationships[b.id] = Math.min(100, (a.relationships[b.id] || 0) + 6);
    b.relationships[a.id] = Math.min(100, (b.relationships[a.id] || 0) + 6);
    addMemory(a, w, `Talked with ${b.name} about ${topic}.`);
    addMemory(b, w, `Talked with ${a.name} about ${topic}.`);
    addLog(w, "dialogue", `${a.name} & ${b.name} — ${topic}`, a, lines, b);
  }

  async function applyAction(w, a, d) {
    const action = String(d.action || "idle").toLowerCase();
    if (d.thought) a.thought = String(d.thought).slice(0, 180);
    const here = locById(a.location);

    if (action === "move") {
      const loc = findLocation(d.target);
      if (loc && loc.id !== a.location) {
        a.location = loc.id;
        a.lastAction = "move";
        a.needs.energy = clampN(a.needs.energy - 2);
        addMemory(a, w, `Walked to ${loc.name}.`);
        addLog(w, "action", `${a.emoji} ${a.name} walks to ${loc.name}.`, a);
      } else {
        a.lastAction = "idle";
        addLog(w, "action", `${a.emoji} ${a.name} lingers at ${here.name}.`, a);
      }
    } else if (action === "talk") {
      const other = Object.values(w.agents).find(
        (o) =>
          o.id !== a.id &&
          d.target &&
          o.name.toLowerCase() === String(d.target).toLowerCase().trim()
      );
      if (other && other.location === a.location) {
        await runConversation(w, a, other);
      } else {
        a.lastAction = "idle";
        const nm = other ? other.name : d.target || "someone";
        addMemory(a, w, `Wanted to talk to ${nm}, but they weren't around.`);
        addLog(w, "action", `${a.emoji} ${a.name} looks around for ${nm} — no luck.`, a);
      }
    } else if (action === "eat") {
      const ok = here.kind === "food" || here.owner === a.id;
      if (ok) {
        a.needs.fullness = clampN(a.needs.fullness + 38);
        a.lastAction = "eat";
        addMemory(a, w, `Ate at ${here.name}.`);
        addLog(w, "action", `${a.emoji} ${a.name} eats at ${here.name}.`, a);
      } else {
        const cafe = locById("cafe");
        a.location = cafe.id;
        a.lastAction = "move";
        addMemory(a, w, `Got hungry and headed to ${cafe.name}.`);
        addLog(w, "action", `${a.emoji} ${a.name} heads to ${cafe.name}, stomach growling.`, a);
      }
    } else if (action === "sleep") {
      if (here.owner === a.id) {
        a.needs.energy = clampN(a.needs.energy + 26);
        a.lastAction = "sleep";
        addMemory(a, w, `Slept at home.`);
        addLog(w, "action", `${a.emoji} ${a.name} sleeps. 💤`, a);
      } else {
        const home = locById(a.home);
        a.location = home.id;
        a.lastAction = "move";
        addMemory(a, w, `Got tired and went home.`);
        addLog(w, "action", `${a.emoji} ${a.name} heads home, yawning.`, a);
      }
    } else if (action === "work") {
      a.lastAction = "work";
      a.needs.energy = clampN(a.needs.energy - 3);
      addMemory(a, w, `Worked at ${here.name}: ${a.thought}`);
      addLog(w, "action", `${a.emoji} ${a.name} works away at ${here.name}.`, a);
    } else {
      a.lastAction = "idle";
      addLog(w, "action", `${a.emoji} ${a.name} takes a quiet moment at ${here.name}.`, a);
    }
  }

  const doTick = useCallback(async () => {
    if (tickingRef.current || !worldRef.current) return;
    tickingRef.current = true;
    setTicking(true);
    setApiWarn(null);

    const w = clone(worldRef.current);
    w.minutes += 30;
    if (w.minutes >= 1440) {
      w.minutes -= 1440;
      w.day += 1;
      addLog(w, "system", `Day ${w.day} begins.`);
    }
    Object.values(w.agents).forEach((a) => {
      a.needs.energy = clampN(a.needs.energy - 4);
      a.needs.fullness = clampN(a.needs.fullness - 5);
      a.needs.social = clampN(a.needs.social - 4);
    });
    commit(w);

    for (const id of Object.keys(w.agents)) {
      const a = w.agents[id];
      setThinkingId(id);
      try {
        const raw = await callClaude(decisionPrompt(a, w));
        const d = extractJson(raw);
        await applyAction(w, a, d);
      } catch (e) {
        a.thought = "…lost in thought.";
        a.lastAction = "idle";
        addLog(w, "system", `${a.name}'s mind wandered for a moment.`);
        setApiWarn("A thought didn't come through. The world keeps going.");
      }
      commit(w);
    }
    setThinkingId(null);

    try {
      await window.storage.set("agentville:world", JSON.stringify(worldRef.current));
    } catch (e) {
      // persistence is best-effort
    }
    tickingRef.current = false;
    setTicking(false);
  }, [commit]);

  const runLoop = useCallback(async () => {
    while (playingRef.current) {
      await doTick();
      await new Promise((r) => setTimeout(r, 2200));
    }
  }, [doTick]);

  function togglePlay() {
    playingRef.current = !playingRef.current;
    setPlaying(playingRef.current);
    if (playingRef.current) runLoop();
  }

  async function resetWorld() {
    if (!confirmReset) {
      setConfirmReset(true);
      setTimeout(() => setConfirmReset(false), 3500);
      return;
    }
    setConfirmReset(false);
    playingRef.current = false;
    setPlaying(false);
    const w = freshWorld();
    worldRef.current = w;
    setWorld(w);
    setSelectedId(null);
    setRestored(false);
    try {
      await window.storage.set("agentville:world", JSON.stringify(w));
    } catch (e) {}
  }

  // ── render ───────────────────────────────────────────────────
  if (!loaded || !world) {
    return (
      <div style={S.page}>
        <style>{CSS}</style>
        <div style={{ ...S.center, paddingTop: 120 }}>
          <div style={S.title}>Agentville</div>
          <div style={S.caption}>Waking the town…</div>
        </div>
      </div>
    );
  }

  const agents = world.agents;
  const selected = selectedId ? agents[selectedId] : null;
  const thinkingAgent = thinkingId ? agents[thinkingId] : null;

  return (
    <div style={S.page}>
      <style>{CSS}</style>

      {/* header */}
      <div style={S.header}>
        <div>
          <div style={S.title}>Agentville</div>
          <div style={S.clockRow}>
            <span style={S.clock}>
              {skyEmoji(world.minutes)} {fmtTime(world.minutes)}
            </span>
            <span style={S.dayBadge}>Day {world.day}</span>
          </div>
          {restored && (
            <div style={S.caption}>Your town picked up where it left off.</div>
          )}
        </div>
      </div>

      {/* controls */}
      <div style={S.controls}>
        <button className="av-btn av-primary" onClick={togglePlay}>
          {playing ? "Pause" : world.log.length <= 1 ? "Start the day" : "Play"}
        </button>
        <button
          className="av-btn"
          onClick={doTick}
          disabled={playing || ticking}
          style={playing || ticking ? S.btnDisabled : null}
        >
          Step 30 min
        </button>
        <button className="av-btn" onClick={resetWorld}>
          {confirmReset ? "Sure? Tap again" : "New town"}
        </button>
      </div>

      <div style={S.statusLine}>
        {thinkingAgent ? (
          <span style={{ color: thinkingAgent.color }}>
            {thinkingAgent.name} is thinking
            <span className="av-ellipsis">…</span>
          </span>
        ) : ticking ? (
          <span style={{ color: "#b9b2c9" }}>The town stirs…</span>
        ) : (
          <span style={{ color: "#8a8499" }}>
            Each step, every agent thinks with a real Claude call.
          </span>
        )}
      </div>

      {apiWarn && <div style={S.warn}>{apiWarn}</div>}

      {/* town map */}
      <div style={S.townGrid}>
        {LOCATIONS.map((loc) => {
          const residents = Object.values(agents).filter((a) => a.location === loc.id);
          return (
            <div key={loc.id} style={S.locCard}>
              <div style={S.locName}>
                <span style={{ marginRight: 6 }}>{loc.emoji}</span>
                {loc.name}
              </div>
              <div style={S.chipRow}>
                {residents.length === 0 && <span style={S.emptyLoc}>—</span>}
                {residents.map((a) => (
                  <button
                    key={a.id}
                    className={"av-chip" + (thinkingId === a.id ? " av-thinking" : "")}
                    onClick={() => setSelectedId(selectedId === a.id ? null : a.id)}
                    style={{
                      borderColor: a.color,
                      boxShadow:
                        selectedId === a.id ? `0 0 0 2px ${a.color}` : undefined,
                    }}
                  >
                    <span style={{ fontSize: 15 }}>{a.emoji}</span>
                    <span style={{ color: a.color, fontWeight: 600 }}>{a.name}</span>
                    {a.lastAction === "sleep" && <span>💤</span>}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* selected agent */}
      {selected && (
        <div style={{ ...S.agentPanel, borderColor: selected.color + "55" }}>
          <div style={S.agentHeader}>
            <span style={{ fontSize: 20 }}>{selected.emoji}</span>
            <span style={{ ...S.agentName, color: selected.color }}>
              {selected.name}
            </span>
            <span style={S.agentWhere}>at {locById(selected.location).name}</span>
          </div>

          <div style={S.thought}>“{selected.thought}”</div>

          <div style={S.needsRow}>
            {[
              ["energy", selected.needs.energy],
              ["fullness", selected.needs.fullness],
              ["social", selected.needs.social],
            ].map(([label, v]) => (
              <div key={label} style={S.needCol}>
                <div style={S.needLabel}>
                  {label} <span style={{ color: "#8a8499" }}>{v}</span>
                </div>
                <div style={S.barTrack}>
                  <div
                    style={{
                      ...S.barFill,
                      width: `${v}%`,
                      background:
                        v <= 20 ? "#d96c5f" : v <= 50 ? "#d9a05f" : "#8fbf8f",
                    }}
                  />
                </div>
              </div>
            ))}
          </div>

          <div style={S.subHead}>Relationships</div>
          {Object.entries(selected.relationships).map(([oid, score]) => (
            <div key={oid} style={S.relLine}>
              <span style={{ color: agents[oid].color }}>{agents[oid].name}</span>
              <span style={{ color: "#b9b2c9" }}>
                {" "}
                — {relLabel(score)} ({score})
              </span>
            </div>
          ))}

          <div style={S.subHead}>Recent memories</div>
          <div style={S.memList}>
            {selected.memories
              .slice(-8)
              .reverse()
              .map((m, i) => (
                <div key={i} style={S.memLine}>
                  {m}
                </div>
              ))}
          </div>
        </div>
      )}

      {/* town log */}
      <div style={S.logSection}>
        <div style={S.subHead}>Town log</div>
        {world.log.length <= 1 && (
          <div style={S.emptyLog}>Nothing has happened yet. Start the day.</div>
        )}
        <div style={S.logList}>
          {world.log.map((e) => (
            <div key={e.id} style={S.logEntry}>
              <div style={S.logMeta}>
                D{e.day} {fmtTime(e.minutes)}
              </div>
              {e.kind === "dialogue" ? (
                <div>
                  <div style={{ ...S.logText, color: "#e9c98a" }}>💬 {e.text}</div>
                  {(e.lines || []).map((l, i) => (
                    <div key={i} style={S.dlgLine}>
                      <span
                        style={{
                          color:
                            l.speaker &&
                            Object.values(agents).find((a) => a.name === l.speaker)
                              ? Object.values(agents).find(
                                  (a) => a.name === l.speaker
                                ).color
                              : "#ece6d8",
                          fontWeight: 600,
                        }}
                      >
                        {l.speaker}:
                      </span>{" "}
                      {l.text}
                    </div>
                  ))}
                </div>
              ) : (
                <div
                  style={{
                    ...S.logText,
                    color: e.kind === "system" ? "#8a8499" : "#ece6d8",
                    fontStyle: e.kind === "system" ? "italic" : "normal",
                  }}
                >
                  {e.text}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div style={S.footer}>
        Agentville v0 · every mind here is a live model call · the world saves itself
      </div>
    </div>
  );
}

// ── styles ──────────────────────────────────────────────────────
const S = {
  page: {
    minHeight: "100vh",
    background: "linear-gradient(180deg, #1a1e2c 0%, #171423 100%)",
    color: "#ece6d8",
    fontFamily: "'Instrument Sans', system-ui, sans-serif",
    padding: "18px 14px 30px",
    maxWidth: 560,
    margin: "0 auto",
  },
  center: { textAlign: "center" },
  header: { marginBottom: 12 },
  title: {
    fontFamily: "'Fraunces', Georgia, serif",
    fontSize: 30,
    fontWeight: 600,
    letterSpacing: "0.5px",
    color: "#f2d9a8",
  },
  clockRow: { display: "flex", alignItems: "baseline", gap: 10, marginTop: 2 },
  clock: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 15,
    color: "#ece6d8",
  },
  dayBadge: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 11,
    color: "#1a1e2c",
    background: "#e9c98a",
    borderRadius: 4,
    padding: "1px 6px",
  },
  caption: { fontSize: 12, color: "#8a8499", marginTop: 4 },
  controls: { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 },
  btnDisabled: { opacity: 0.4, cursor: "default" },
  statusLine: {
    fontSize: 12.5,
    fontFamily: "'IBM Plex Mono', monospace",
    minHeight: 18,
    marginBottom: 10,
  },
  warn: {
    fontSize: 12,
    color: "#d9a05f",
    background: "#d9a05f18",
    border: "1px solid #d9a05f44",
    borderRadius: 6,
    padding: "6px 9px",
    marginBottom: 10,
  },
  townGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 8,
    marginBottom: 14,
  },
  locCard: {
    background: "#232838",
    border: "1px solid #343b52",
    borderRadius: 10,
    padding: "9px 10px",
    minHeight: 68,
  },
  locName: { fontSize: 12.5, color: "#b9b2c9", marginBottom: 7, fontWeight: 600 },
  chipRow: { display: "flex", flexWrap: "wrap", gap: 6 },
  emptyLoc: { color: "#4a4560", fontSize: 12 },
  agentPanel: {
    background: "#232838",
    border: "1px solid",
    borderRadius: 12,
    padding: "12px 13px",
    marginBottom: 14,
  },
  agentHeader: { display: "flex", alignItems: "baseline", gap: 8 },
  agentName: {
    fontFamily: "'Fraunces', Georgia, serif",
    fontSize: 20,
    fontWeight: 600,
  },
  agentWhere: { fontSize: 12, color: "#8a8499" },
  thought: {
    fontStyle: "italic",
    fontSize: 14,
    color: "#e9c98a",
    margin: "8px 0 12px",
    lineHeight: 1.45,
  },
  needsRow: { display: "flex", gap: 10, marginBottom: 6 },
  needCol: { flex: 1 },
  needLabel: {
    fontSize: 10.5,
    textTransform: "uppercase",
    letterSpacing: "0.6px",
    color: "#b9b2c9",
    marginBottom: 3,
    fontFamily: "'IBM Plex Mono', monospace",
  },
  barTrack: {
    height: 6,
    background: "#171423",
    borderRadius: 3,
    overflow: "hidden",
  },
  barFill: { height: "100%", borderRadius: 3, transition: "width 0.6s ease" },
  subHead: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: "1px",
    color: "#8a8499",
    margin: "12px 0 5px",
    fontFamily: "'IBM Plex Mono', monospace",
  },
  relLine: { fontSize: 13.5, marginBottom: 2 },
  memList: { maxHeight: 150, overflowY: "auto" },
  memLine: {
    fontSize: 12,
    color: "#b9b2c9",
    lineHeight: 1.5,
    borderLeft: "2px solid #343b52",
    paddingLeft: 8,
    marginBottom: 4,
  },
  logSection: { marginBottom: 10 },
  emptyLog: { fontSize: 13, color: "#8a8499", fontStyle: "italic" },
  logList: { maxHeight: 340, overflowY: "auto", paddingRight: 2 },
  logEntry: {
    borderBottom: "1px solid #232838",
    padding: "7px 0",
  },
  logMeta: {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: 10.5,
    color: "#4a4560",
    marginBottom: 2,
  },
  logText: { fontSize: 13.5, lineHeight: 1.45 },
  dlgLine: {
    fontSize: 13.5,
    lineHeight: 1.5,
    paddingLeft: 12,
    marginTop: 3,
    color: "#ece6d8",
  },
  footer: {
    marginTop: 18,
    fontSize: 11,
    color: "#4a4560",
    textAlign: "center",
    fontFamily: "'IBM Plex Mono', monospace",
  },
};

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600&family=IBM+Plex+Mono:wght@400;500&family=Instrument+Sans:wght@400;500;600&display=swap');

.av-btn {
  background: #232838;
  color: #ece6d8;
  border: 1px solid #343b52;
  border-radius: 8px;
  padding: 9px 14px;
  font-size: 13.5px;
  font-family: 'Instrument Sans', system-ui, sans-serif;
  font-weight: 600;
  cursor: pointer;
}
.av-btn:focus-visible { outline: 2px solid #e9c98a; outline-offset: 2px; }
.av-primary { background: #e9c98a; color: #1a1e2c; border-color: #e9c98a; }

.av-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: #171423;
  border: 1.5px solid;
  border-radius: 999px;
  padding: 4px 10px 4px 6px;
  font-size: 12.5px;
  font-family: 'Instrument Sans', system-ui, sans-serif;
  color: #ece6d8;
  cursor: pointer;
}
.av-chip:focus-visible { outline: 2px solid #e9c98a; outline-offset: 2px; }

@media (prefers-reduced-motion: no-preference) {
  .av-thinking { animation: av-breathe 1.4s ease-in-out infinite; }
  .av-ellipsis { animation: av-blink 1.2s steps(1) infinite; }
}
@keyframes av-breathe {
  0%, 100% { box-shadow: 0 0 0 0 rgba(233, 201, 138, 0.0); }
  50% { box-shadow: 0 0 14px 3px rgba(233, 201, 138, 0.55); }
}
@keyframes av-blink { 50% { opacity: 0.2; } }
`;
