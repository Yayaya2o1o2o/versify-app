import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import RecordingPill from "./RecordingPill.jsx";
import { load, save, isElectron, uid, seedMeetings, seedNotes } from "./store.js";

const soft = { type: "spring", stiffness: 200, damping: 28, mass: 0.9 };

/* drag the frameless window by a titlebar region */
function useWindowDrag() {
  return useCallback((e) => {
    if (e.button !== 0 || e.target.closest("button") || e.target.closest("input")) return;
    const ox = e.clientX, oy = e.clientY;
    const onMove = (ev) => window.notify?.setPos(ev.screenX - ox, ev.screenY - oy);
    const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);
}

export default function App() {
  const [view, setView] = useState(null); // null(loading) | welcome | tour | app
  const [section, setSection] = useState("home"); // home | notes | settings
  const [notes, setNotes] = useState([]);
  const [meetings, setMeetings] = useState([]);
  const [settings, setSettings] = useState({ captureSystem: true });
  const [recording, setRecording] = useState(false);
  const [selected, setSelected] = useState(null);
  const [toast, setToast] = useState(null);

  // boot: load persisted state (or seed a fresh install)
  useEffect(() => {
    (async () => {
      const onboarded = await load("onboarded", false);
      const n = await load("notes", null);
      const m = await load("meetings", null);
      const s = await load("settings", null);
      setNotes(n || seedNotes());
      setMeetings(m || seedMeetings());
      if (s) setSettings(s);
      if (!n) save("notes", seedNotes());
      if (!m) save("meetings", seedMeetings());
      setView(onboarded ? "app" : "welcome");
    })();
  }, []);

  const flash = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2600); };

  const persistNotes = (next) => { setNotes(next); save("notes", next); };
  const persistMeetings = (next) => { setMeetings(next); save("meetings", next); };

  const finishTour = () => { save("onboarded", true); setView("app"); };

  /* ---------- recording lifecycle ---------- */
  const startRecording = () => { setRecording(true); window.notify?.setMode("hud"); };

  const handleDone = async (wav, meta, setProgress) => {
    let out;
    try {
      if (isElectron && window.notify?.processAudio) {
        const unsub = window.notify.onProgress?.((p) => setProgress(p.stage));
        out = await window.notify.processAudio(wav);
        unsub && unsub();
      } else {
        // browser/demo: fabricate a result so the flow is testable
        await new Promise((r) => setTimeout(r, 1400));
        out = demoResult();
      }
    } catch (e) {
      endRecording();
      flash("Couldn't write notes: " + (e?.message || e));
      return;
    }
    const note = {
      id: uid(),
      createdAt: new Date().toISOString(),
      durationSec: meta.durationSec || 0,
      sources: [meta.sources?.mic && "mic", meta.sources?.system && "system"].filter(Boolean),
      notes: out.notes,
      segments: out.segments || [],
      transcript: out.transcript || "",
    };
    const next = [note, ...notes];
    persistNotes(next);
    endRecording();
    setSection("notes");
    setSelected(note);
    flash("Notes saved · " + (note.notes?.title || "Untitled"));
  };

  const endRecording = () => { setRecording(false); window.notify?.setMode("home"); };
  const handleCancel = (msg) => { endRecording(); if (msg) flash(msg); };

  const deleteNote = (id) => {
    persistNotes(notes.filter((n) => n.id !== id));
    setSelected(null);
    flash("Note deleted");
  };

  if (view === null) return <div className="app boot" />;

  // While recording the OS window is small+transparent — render only the HUD.
  if (recording) {
    return (
      <AnimatePresence>
        <RecordingPill key="hud" onDone={handleDone} onCancel={handleCancel} />
      </AnimatePresence>
    );
  }

  if (view === "welcome") return <Welcome onStart={() => setView("tour")} />;
  if (view === "tour") return <Tour onDone={finishTour} />;

  return (
    <div className="app">
      <TitleBar />
      <div className="app-body">
        <Sidebar section={section} setSection={setSection} onRecord={startRecording} noteCount={notes.length} />
        <div className="content soft-scroll">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={section} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.22 }}>
              {section === "home" && (
                <Home
                  notes={notes} meetings={meetings}
                  onRecord={startRecording}
                  onOpen={(n) => { setSelected(n); }}
                  onAddMeeting={(mtg) => persistMeetings([...meetings, mtg].sort((a, b) => new Date(a.when) - new Date(b.when)))}
                  onSeeAll={() => setSection("notes")}
                />
              )}
              {section === "notes" && <Library notes={notes} onOpen={setSelected} onRecord={startRecording} />}
              {section === "settings" && <Settings settings={settings} setSettings={(s) => { setSettings(s); save("settings", s); }} onReplayTour={() => setView("tour")} count={notes.length} />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      <AnimatePresence>
        {selected && <NoteDetail key="detail" note={selected} onClose={() => setSelected(null)} onDelete={deleteNote} onCopy={() => { copyNotes(selected.notes, selected.segments); flash("Copied to clipboard"); }} />}
      </AnimatePresence>

      <AnimatePresence>
        {toast && (
          <motion.div className="toast" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }} transition={soft}>
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------ TITLE BAR ------------------------------ */
function TitleBar() {
  const drag = useWindowDrag();
  return (
    <div className="titlebar" onMouseDown={drag}>
      <div className="tb-lights">
        <button className="lit close" onClick={() => window.notify?.quit()} title="Close" />
        <button className="lit min" onClick={() => window.notify?.minimize()} title="Minimize" />
        <span className="lit dim" />
      </div>
      <span className="tb-title osw">MIRA</span>
      <div style={{ width: 54 }} />
    </div>
  );
}

/* ------------------------------ SIDEBAR ------------------------------ */
function Sidebar({ section, setSection, onRecord, noteCount }) {
  const items = [
    ["home", "Home", "◆"],
    ["notes", "Notes", "▤"],
    ["settings", "Settings", "✦"],
  ];
  return (
    <div className="sidebar">
      <div className="side-brand">
        <PixelMark size={26} />
        <span className="osw">MIRA</span>
      </div>
      <nav className="side-nav">
        {items.map(([k, label, ic]) => (
          <button key={k} className={"nav-item osw" + (section === k ? " active" : "")} onClick={() => setSection(k)}>
            <span className="nav-ic">{ic}</span>{label}
            {k === "notes" && noteCount ? <span className="nav-count">{noteCount}</span> : null}
          </button>
        ))}
      </nav>
      <div style={{ flex: 1 }} />
      <button className="record-btn osw" onClick={onRecord}>
        <span className="rec-dot on" /> Record
      </button>
      <div className="side-foot osw">{isElectron ? "ON-DEVICE · PRIVATE" : "WEB PREVIEW"}</div>
    </div>
  );
}

/* ------------------------------ HOME ------------------------------ */
function Home({ notes, meetings, onRecord, onOpen, onAddMeeting, onSeeAll }) {
  const upcoming = useMemo(() => meetings.filter((m) => new Date(m.when) > new Date(Date.now() - 30 * 60000)).slice(0, 4), [meetings]);
  const recent = notes.slice(0, 3);
  return (
    <div className="page">
      <div className="hello">
        <div className="eyebrow osw">// {greeting()}</div>
        <h1 className="osw">Ready when you are</h1>
        <p className="lead">Hit record and Mira listens to the room — both your mic and the people on the call — then writes the notes, action items and decisions. Everything runs on your Mac.</p>
        <button className="cta-green osw" onClick={onRecord}><span className="rec-dot on" /> Start recording</button>
      </div>

      <section className="block">
        <div className="block-head">
          <h2 className="osw">Upcoming</h2>
          <AddMeeting onAdd={onAddMeeting} />
        </div>
        {upcoming.length ? (
          <div className="mtg-list">
            {upcoming.map((m) => <MeetingRow key={m.id} m={m} onRecord={onRecord} />)}
          </div>
        ) : <Empty text="No upcoming meetings. Add one, or just hit record." />}
      </section>

      <section className="block">
        <div className="block-head">
          <h2 className="osw">Recent notes</h2>
          {notes.length > 3 && <button className="link osw" onClick={onSeeAll}>See all →</button>}
        </div>
        {recent.length ? (
          <div className="note-grid">{recent.map((n) => <NoteCard key={n.id} n={n} onOpen={onOpen} />)}</div>
        ) : <Empty text="No notes yet — your first recording lands here." />}
      </section>
    </div>
  );
}

function AddMeeting({ onAdd }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [mins, setMins] = useState(30);
  if (!open) return <button className="link osw" onClick={() => setOpen(true)}>+ Add</button>;
  return (
    <div className="add-mtg">
      <input value={title} placeholder="Meeting title" onChange={(e) => setTitle(e.target.value)} />
      <input type="number" value={mins} onChange={(e) => setMins(e.target.value)} style={{ width: 64 }} /><span className="mini">min</span>
      <button className="btn-green sm osw" onClick={() => { if (title.trim()) { onAdd({ id: uid(), title: title.trim(), when: new Date(Date.now() + (+mins || 30) * 60000).toISOString(), people: ["You"], source: "Manual" }); setTitle(""); setOpen(false); } }}>Add</button>
      <button className="link osw" onClick={() => setOpen(false)}>✕</button>
    </div>
  );
}

function MeetingRow({ m, onRecord }) {
  const soon = new Date(m.when) - Date.now() < 15 * 60000 && new Date(m.when) > Date.now();
  return (
    <div className={"mtg-row" + (soon ? " soon" : "")}>
      <div className="mtg-time osw">{clock(m.when)}<span>{dayTag(m.when)}</span></div>
      <div className="mtg-mid">
        <div className="mtg-title">{m.title}</div>
        <div className="mtg-meta">{m.source} · {m.people.join(", ")}</div>
      </div>
      {soon && <span className="soon-tag osw">SOON</span>}
      <button className="btn-green sm osw" onClick={onRecord}>Record</button>
    </div>
  );
}

/* ------------------------------ LIBRARY ------------------------------ */
function Library({ notes, onOpen, onRecord }) {
  const [q, setQ] = useState("");
  const filtered = notes.filter((n) => !q || JSON.stringify(n.notes).toLowerCase().includes(q.toLowerCase()));
  const groups = groupByDate(filtered);
  return (
    <div className="page">
      <div className="lib-head">
        <h1 className="osw">Notes</h1>
        <input className="search" placeholder="Search notes…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {filtered.length === 0 ? (
        <div className="empty-lib">
          <PixelMark size={44} />
          <p>{q ? "Nothing matches that search." : "No notes yet."}</p>
          {!q && <button className="cta-green osw" onClick={onRecord}><span className="rec-dot on" /> Start recording</button>}
        </div>
      ) : groups.map(([label, items]) => (
        <section key={label} className="block">
          <div className="date-label osw">{label}</div>
          <div className="note-grid">{items.map((n) => <NoteCard key={n.id} n={n} onOpen={onOpen} />)}</div>
        </section>
      ))}
    </div>
  );
}

function NoteCard({ n, onOpen }) {
  const t = n.notes || {};
  return (
    <motion.button className="note-card" onClick={() => onOpen(n)} whileHover={{ y: -3 }} transition={soft}>
      <div className="nc-top">
        <span className="nc-time osw">{clock(n.createdAt)}</span>
        <span className="nc-dur osw">{fmtDur(n.durationSec)}</span>
      </div>
      <div className="nc-title display">{t.title || "Untitled note"}</div>
      <div className="nc-sum">{t.summary || "No summary."}</div>
      <div className="nc-foot">
        {(n.sources || []).map((s) => <span key={s} className="nc-src osw">{s === "system" ? "SPEAKER" : "MIC"}</span>)}
        {(t.actions || []).length ? <span className="nc-act osw">{t.actions.length} ACTION{t.actions.length > 1 ? "S" : ""}</span> : null}
      </div>
    </motion.button>
  );
}

/* ------------------------------ NOTE DETAIL ------------------------------ */
function NoteDetail({ note, onClose, onDelete, onCopy }) {
  const [tab, setTab] = useState("summary");
  const t = note.notes || {};
  const segments = note.segments || [];
  const actions = t.actions || [];
  const nav = [["summary", "Notes"], ["actions", `Actions`], ["agenda", "Agenda"], ["transcript", "Transcript"]];
  return (
    <motion.div className="detail-wrap" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div className="detail soft-scroll" initial={{ x: 60, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 60, opacity: 0 }} transition={soft}>
        <div className="detail-top">
          <button className="link osw" onClick={onClose}>← Back</button>
          <div className="detail-tools">
            <button className="btn-ghost sm osw" onClick={onCopy}>Copy</button>
            <button className="btn-ghost sm osw danger" onClick={() => onDelete(note.id)}>Delete</button>
          </div>
        </div>
        <h1 className="osw detail-title">{t.title || "Untitled note"}</h1>
        <div className="detail-meta osw">
          {longDate(note.createdAt)} · {clock(note.createdAt)} · {fmtDur(note.durationSec)} · {(note.sources || []).map((s) => s === "system" ? "speaker" : "mic").join(" + ") || "mic"}
        </div>
        <div className="tabs">
          {nav.map(([k, label]) => (
            <button key={k} className={"tab osw" + (tab === k ? " on" : "")} onClick={() => setTab(k)}>
              {label}{k === "actions" && actions.length ? <span className="tab-badge">{actions.length}</span> : null}
            </button>
          ))}
        </div>
        <div className="detail-body">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }}>
              {tab === "summary" && <SummaryTab notes={t} />}
              {tab === "actions" && <ActionsTab actions={actions} />}
              {tab === "agenda" && <AgendaTab agenda={t.agenda || []} />}
              {tab === "transcript" && <TranscriptTab segments={segments} />}
            </motion.div>
          </AnimatePresence>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ------------------------------ SETTINGS ------------------------------ */
function Settings({ settings, setSettings, onReplayTour, count }) {
  return (
    <div className="page">
      <h1 className="osw">Settings</h1>
      <section className="block">
        <Row label="Capture speaker audio" sub="Record the other side of the call (system audio) alongside your mic, via ScreenCaptureKit.">
          <Toggle on={settings.captureSystem} onToggle={() => setSettings({ ...settings, captureSystem: !settings.captureSystem })} />
        </Row>
        <Row label="Replay the tour" sub="Walk through the app again.">
          <button className="btn-ghost sm osw" onClick={onReplayTour}>Start tour</button>
        </Row>
        <Row label="Storage" sub={`${count} note${count === 1 ? "" : "s"} saved on this Mac.`}>
          <span className="osw mini">{isElectron ? "LOCAL" : "BROWSER"}</span>
        </Row>
      </section>
      <div className="about osw">MIRA · THE NOTEPAD THAT LISTENS · v0.1.0 · ON-DEVICE &amp; PRIVATE</div>
    </div>
  );
}
function Row({ label, sub, children }) {
  return (
    <div className="set-row">
      <div><div className="set-label">{label}</div><div className="set-sub">{sub}</div></div>
      {children}
    </div>
  );
}
function Toggle({ on, onToggle }) {
  return <button className={"toggle" + (on ? " on" : "")} onClick={onToggle}><span /></button>;
}

/* ------------------------------ WELCOME ------------------------------ */
function Welcome({ onStart }) {
  const drag = useWindowDrag();
  return (
    <div className="welcome" onMouseDown={drag}>
      <PixelField />
      <motion.div className="welcome-card" initial={{ opacity: 0, y: 18, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={soft}>
        <PixelMark size={64} glow />
        <h1 className="osw">MIRA</h1>
        <div className="welcome-sub osw">// THE NOTEPAD THAT LISTENS</div>
        <p>An AI meeting notepad that turns messy conversations into clean notes, action items and decisions — capturing both your mic and the people on the call. Private by default. Nothing leaves your Mac.</p>
        <button className="cta-green big osw no-drag" onClick={onStart}>Get started ↘</button>
        <div className="welcome-foot osw">NO ACCOUNT NEEDED · FREE · ON-DEVICE</div>
      </motion.div>
    </div>
  );
}

/* ------------------------------ TOUR ------------------------------ */
const TOUR = [
  { ic: "◆", t: "This is home base", d: "Your day at a glance — upcoming meetings up top, your latest notes below. Start a recording from anywhere with one click." },
  { ic: "●", t: "Record in one tap", d: "Hit Record and a small pill floats over whatever you're doing. It listens to your mic AND the other side of the call, fully on-device." },
  { ic: "▤", t: "Every note, by date", d: "When you stop, Mira writes a title, summary, key points, action items and a speaker-by-speaker transcript — filed neatly by day." },
  { ic: "✦", t: "Yours, and private", d: "No account, no cloud, no subscription. Speaker capture and transcription all run locally. You're ready — let's go." },
];
function Tour({ onDone }) {
  const [i, setI] = useState(0);
  const step = TOUR[i];
  const last = i === TOUR.length - 1;
  return (
    <div className="welcome">
      <PixelField />
      <motion.div className="tour-card" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={soft}>
        <div className="tour-ic osw">{step.ic}</div>
        <AnimatePresence mode="wait">
          <motion.div key={i} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.25 }}>
            <h2 className="osw">{step.t}</h2>
            <p>{step.d}</p>
          </motion.div>
        </AnimatePresence>
        <div className="tour-dots">{TOUR.map((_, k) => <span key={k} className={k === i ? "on" : ""} />)}</div>
        <div className="tour-actions">
          {i > 0 ? <button className="link osw" onClick={() => setI(i - 1)}>Back</button> : <button className="link osw" onClick={onDone}>Skip</button>}
          <button className="cta-green osw" onClick={() => (last ? onDone() : setI(i + 1))}>{last ? "Enter Mira ↘" : "Next"}</button>
        </div>
      </motion.div>
    </div>
  );
}

/* ------------------------------ NOTE TABS ------------------------------ */
function SummaryTab({ notes }) {
  if (!notes.summary && !(notes.notes || []).length) return <Empty text="No summary was produced." />;
  return (
    <div>
      {notes.summary && <p className="sum-text">{notes.summary}</p>}
      {(notes.notes || []).length > 0 && <>
        <Label>Key points</Label>
        <ul className="keypoints">
          {notes.notes.map((n, i) => (
            <motion.li key={i} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.04 * i, ...soft }}>
              <span className="kp-mark">—</span>{n}
            </motion.li>
          ))}
        </ul>
      </>}
      {(notes.decisions || []).length > 0 && <>
        <Label>Decisions</Label>
        <div className="decisions">{notes.decisions.map((d, i) => <div key={i} className="decision">{d}</div>)}</div>
      </>}
    </div>
  );
}
function ActionsTab({ actions }) {
  if (!actions.length) return <Empty text="No action items were found." />;
  return <div className="actions">{actions.map((a, i) => <ActionRow key={i} a={a} i={i} />)}</div>;
}
function ActionRow({ a, i }) {
  const [done, setDone] = useState(false);
  return (
    <motion.div className="action-row" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 * i, ...soft }}>
      <button className={"check" + (done ? " on" : "")} onClick={() => setDone((d) => !d)}>{done ? "✓" : ""}</button>
      <div className="action-mid">
        <div className={"action-text" + (done ? " done" : "")}>{a.text}</div>
        {(a.owner || a.due) && (
          <div className="action-meta">
            {a.owner && <span className="owner osw">{a.owner}</span>}
            {a.due && <span className="due osw">{a.due}</span>}
          </div>
        )}
      </div>
    </motion.div>
  );
}
function AgendaTab({ agenda }) {
  if (!agenda.length) return <Empty text="No agenda was detected." />;
  return (
    <div className="agenda">
      {agenda.map((a, i) => (
        <motion.div key={i} className="agenda-row" initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.05 * i, ...soft }}>
          <div className="agenda-rail"><span className="dot" />{i < agenda.length - 1 && <span className="line" />}</div>
          <div><div className="agenda-topic">{a.topic}</div><div className="agenda-detail">{a.detail}</div></div>
        </motion.div>
      ))}
    </div>
  );
}
function TranscriptTab({ segments }) {
  if (!segments.length) return <Empty text="No transcript." />;
  return (
    <div className="transcript">
      {segments.map((s, i) => (
        <div key={i} className="seg">
          <Avatar n={s.speaker} />
          <div><div className="seg-spk osw" style={{ color: speakerColor(s.speaker) }}>Speaker {s.speaker}</div><div className="seg-text">{s.text}</div></div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------ PRIMITIVES ------------------------------ */
function PixelMark({ size = 28, glow }) {
  const ref = useRef(null);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = size * dpr; cv.height = size * dpr;
    const x = cv.getContext("2d"); const n = (size * dpr) / 4;
    const m = ["g..g", "gg.g", "g.gg", "g..g"];
    m.forEach((r, ri) => { for (let i = 0; i < 4; i++) if (r[i] === "g") { x.fillStyle = i % 2 ? "#88FF63" : "#B6FF8C"; x.fillRect(i * n, ri * n, n, n); } });
  }, [size]);
  return <canvas ref={ref} className={"pixel-mark" + (glow ? " glow" : "")} style={{ width: size, height: size }} />;
}
function Avatar({ n }) {
  const c = speakerColor(n);
  return <span className="avatar" style={{ background: `${c}1f`, color: c, border: `1px solid ${c}44` }}>S{n}</span>;
}
function Label({ children }) { return <div className="field-label osw">{children}</div>; }
function Empty({ text }) { return <div className="empty">{text}</div>; }

/* ------------------------------ pixel field bg ------------------------------ */
function PixelField() {
  const ref = useRef(null);
  useEffect(() => {
    const cv = ref.current; if (!cv) return; const x = cv.getContext("2d");
    let W, H, cells = [], raf; const PX = 12;
    const build = () => {
      W = cv.width = cv.offsetWidth; H = cv.height = cv.offsetHeight; cells = [];
      const c = Math.floor((W * H) / (PX * PX * 60));
      for (let i = 0; i < c; i++) cells.push({ x: Math.floor(Math.random() * (W / PX)) * PX, y: Math.floor(Math.random() * (H / PX)) * PX, p: Math.random() * 6.28, sp: 0.4 + Math.random() * 1.1, col: Math.random() < 0.18 ? "#88FF63" : (Math.random() < 0.1 ? "#FFB36B" : "#ffffff") });
    };
    build(); window.addEventListener("resize", build);
    let t = 0;
    const draw = () => { t += 0.016; x.clearRect(0, 0, W, H); for (const c of cells) { x.globalAlpha = Math.min(0.5, (0.12 + 0.5 * (0.5 + 0.5 * Math.sin(t * c.sp + c.p))) * 0.5); x.fillStyle = c.col; x.fillRect(c.x, c.y, PX - 1, PX - 1); } x.globalAlpha = 1; raf = requestAnimationFrame(draw); };
    draw();
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", build); };
  }, []);
  return <canvas ref={ref} className="pixel-field" />;
}

/* ------------------------------ helpers ------------------------------ */
const SPEAKER_COLORS = ["#88FF63", "#FFB36B", "#7FB2FF", "#C8A6FF", "#FF7FB0"];
function speakerColor(n) { return SPEAKER_COLORS[(n - 1) % SPEAKER_COLORS.length]; }
function greeting() { const h = new Date().getHours(); return h < 12 ? "GOOD MORNING" : h < 18 ? "GOOD AFTERNOON" : "GOOD EVENING"; }
function clock(iso) { return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }
function longDate(iso) { return new Date(iso).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" }); }
function dayTag(iso) { const d = new Date(iso), n = new Date(); const same = d.toDateString() === n.toDateString(); const tmr = new Date(n.getTime() + 86400000).toDateString() === d.toDateString(); return same ? "TODAY" : tmr ? "TMR" : d.toLocaleDateString([], { month: "short", day: "numeric" }).toUpperCase(); }
function fmtDur(s) { if (!s) return "—"; const m = Math.round(s / 60); return m < 1 ? `${s}s` : `${m} min`; }
function groupByDate(notes) {
  const map = new Map();
  for (const n of notes) {
    const d = new Date(n.createdAt); const today = new Date(); const yest = new Date(Date.now() - 86400000);
    const label = d.toDateString() === today.toDateString() ? "Today" : d.toDateString() === yest.toDateString() ? "Yesterday" : d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
    if (!map.has(label)) map.set(label, []);
    map.get(label).push(n);
  }
  return [...map.entries()];
}
function copyNotes(notes, segments) {
  const L = []; const t = notes || {};
  L.push(t.title || "Meeting notes", "");
  if (t.summary) L.push(t.summary, "");
  if ((t.notes || []).length) { L.push("KEY POINTS"); t.notes.forEach((n) => L.push("- " + n)); L.push(""); }
  if ((t.actions || []).length) { L.push("ACTION ITEMS"); t.actions.forEach((a) => L.push(`- ${a.text}${a.owner ? ` (@${a.owner})` : ""}${a.due ? ` [${a.due}]` : ""}`)); L.push(""); }
  if ((t.decisions || []).length) { L.push("DECISIONS"); t.decisions.forEach((d) => L.push("- " + d)); }
  navigator.clipboard?.writeText(L.join("\n"));
}
function demoResult() {
  return {
    notes: {
      title: "Untitled recording",
      summary: "This is a web-preview recording. In the desktop app, Mira transcribes your audio on-device and writes real notes, action items and decisions here.",
      notes: ["Mic and speaker audio were captured", "Notes are generated locally with whisper + a local LLM"],
      actions: [{ text: "Try the desktop build for real transcription", owner: "You", due: "" }],
      agenda: [{ topic: "Preview", detail: "Demo note from the web preview" }],
      decisions: [],
    },
    segments: [{ speaker: 1, text: "This is a preview transcript segment." }, { speaker: 2, text: "In the app this would be your real conversation." }],
    transcript: "",
  };
}
