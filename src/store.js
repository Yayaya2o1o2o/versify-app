// Persistence bridge: uses Electron IPC when available, else localStorage.
const N = typeof window !== "undefined" ? window.notify : null;

export async function load(key, fallback = null) {
  try {
    if (N?.load) {
      const v = await N.load(key);
      return v == null ? fallback : v;
    }
    const raw = localStorage.getItem("mira-" + key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export async function save(key, value) {
  try {
    if (N?.save) return await N.save(key, value);
    localStorage.setItem("mira-" + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const isElectron = !!(N && N.isElectron);

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/* ---------- seed data so a fresh install isn't empty ---------- */
export function seedMeetings() {
  const now = new Date();
  const at = (addMin) => new Date(now.getTime() + addMin * 60000).toISOString();
  return [
    { id: uid(), title: "Design sync", when: at(35), people: ["You", "Priya", "Marcus"], source: "Google Meet" },
    { id: uid(), title: "1:1 with Sam", when: at(140), people: ["You", "Sam"], source: "Zoom" },
    { id: uid(), title: "Weekly planning", when: at(60 * 22), people: ["You", "Team"], source: "Google Meet" },
  ];
}

/* ---------- demo note so the library shows something on first run ---------- */
export function seedNotes() {
  return [
    {
      id: uid(),
      createdAt: new Date(Date.now() - 86400000).toISOString(),
      durationSec: 1820,
      sources: ["mic", "system"],
      notes: {
        title: "Q3 roadmap kickoff",
        summary:
          "The team aligned on three pillars for Q3: speaker identification, a shared web library, and calendar auto-capture. Marcus owns the capture work; Priya drives design. Target demo is end of month.",
        notes: [
          "Speaker ID is the most requested feature from early testers",
          "Web library should sync notes across Mac and phone",
          "Calendar auto-capture starts recording when a meeting begins",
        ],
        actions: [
          { text: "Spike ScreenCaptureKit speaker separation", owner: "Marcus", due: "Fri" },
          { text: "Design the web library layout", owner: "Priya", due: "next week" },
        ],
        agenda: [
          { topic: "Q3 pillars", detail: "Speaker ID, web library, calendar capture" },
          { topic: "Timeline", detail: "Demo by end of month" },
        ],
        decisions: ["Ship speaker ID first", "Keep everything on-device by default"],
      },
      segments: [
        { speaker: 1, text: "Let's lock the three things we want to ship this quarter." },
        { speaker: 2, text: "Speaker identification is what everyone keeps asking for." },
        { speaker: 1, text: "Agreed. And the web library so notes follow you everywhere." },
      ],
      transcript: "",
    },
  ];
}
