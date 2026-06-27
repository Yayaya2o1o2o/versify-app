import React, { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";

const liquid = { type: "spring", stiffness: 260, damping: 24, mass: 0.9 };

/* Drag the floating HUD window by hand (so a click still works on buttons). */
function useWindowDrag() {
  return useCallback((e) => {
    if (e.button !== 0 || e.target.closest("button")) return;
    const offsetX = e.clientX, offsetY = e.clientY;
    const onMove = (ev) => window.versify?.setPos(ev.screenX - offsetX, ev.screenY - offsetY);
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);
}

/**
 * Floating recording HUD. Lives inside a FIXED transparent window — the pill
 * animates inside it (Framer only), so there is zero OS-window-resize jank.
 * onDone(wavArrayBuffer, { sources }) / onCancel().
 */
export default function RecordingPill({ onDone, onCancel }) {
  const [phase, setPhase] = useState("arming"); // arming | live | processing
  const [progress, setProgress] = useState("transcribing");
  const [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState(new Array(13).fill(0.18));
  const [sources, setSources] = useState({ mic: false, system: false });
  const refs = useRef({});
  const drag = useWindowDrag();

  useEffect(() => {
    let raf, started = Date.now(), stopped = false;
    (async () => {
      const got = { mic: false, system: false };
      let micStream = null, sysStream = null;
      try {
        if (window.versify?.micPermission) await window.versify.micPermission();
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        });
        got.mic = true;
      } catch (e) {
        onCancel("Microphone access was denied. Enable it in System Settings → Privacy → Microphone, then try again.");
        return;
      }
      // System / speaker audio via ScreenCaptureKit loopback (best-effort).
      try {
        sysStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        sysStream.getVideoTracks().forEach((t) => t.stop());
        got.system = sysStream.getAudioTracks().length > 0;
      } catch { /* no system audio — mic still works */ }

      setSources(got);
      setPhase("live");

      const ac = new (window.AudioContext || window.webkitAudioContext)();
      const mixer = ac.createGain();

      ac.createMediaStreamSource(micStream).connect(mixer);
      if (got.system) ac.createMediaStreamSource(sysStream).connect(mixer);

      const analyser = ac.createAnalyser();
      analyser.fftSize = 64;
      mixer.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);

      const proc = ac.createScriptProcessor(4096, 1, 1);
      const buffers = [];
      proc.onaudioprocess = (e) => buffers.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      const mute = ac.createGain();
      mute.gain.value = 0;
      mixer.connect(proc);
      proc.connect(mute);
      mute.connect(ac.destination);

      refs.current = { micStream, sysStream, ac, proc, buffers, sampleRate: ac.sampleRate };

      const tick = () => {
        if (stopped) return;
        setElapsed((Date.now() - started) / 1000);
        analyser.getByteFrequencyData(data);
        const bars = [];
        for (let i = 0; i < 13; i++) bars.push(0.14 + (data[i * 2] / 255) * 1.05);
        setLevels(bars);
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    })();

    return () => { stopped = true; cancelAnimationFrame(raf); };
  }, []);

  const stop = (deliver) => {
    const r = refs.current;
    if (!r || !r.micStream) { onCancel(); return; }
    try { r.proc.onaudioprocess = null; r.proc.disconnect(); } catch {}
    try { r.micStream.getTracks().forEach((t) => t.stop()); } catch {}
    try { r.sysStream?.getTracks().forEach((t) => t.stop()); } catch {}
    if (!deliver) { try { r.ac?.close(); } catch {} onCancel(); return; }

    const total = r.buffers.reduce((a, b) => a + b.length, 0);
    const merged = new Float32Array(total);
    let o = 0;
    for (const b of r.buffers) { merged.set(b, o); o += b.length; }
    try { r.ac?.close(); } catch {}

    const wav = encodeWav(merged, r.sampleRate);
    if (wav.byteLength < 4000) { onCancel("That recording was empty. Speak for a few seconds and try again."); return; }

    setPhase("processing");
    onDone(wav, { sources, durationSec: Math.round(elapsed) }, setProgress);
  };

  return (
    <div className="hud-stage" onMouseDown={drag}>
      <motion.div
        layout
        className="hud-pill"
        initial={{ scale: 0.55, opacity: 0, y: 30, filter: "blur(10px)" }}
        animate={{ scale: 1, opacity: 1, y: 0, filter: "blur(0px)" }}
        exit={{ scale: 0.6, opacity: 0, y: 30, filter: "blur(8px)" }}
        transition={liquid}
      >
        {phase === "processing" ? (
          <Processing progress={progress} />
        ) : (
          <>
            <div className="hud-top">
              <span className={"rec-dot" + (phase === "live" ? " on" : "")} />
              <span className="hud-label">{phase === "arming" ? "Starting…" : "Listening"}</span>
              <Wave levels={levels} />
              <span className="hud-time">{fmt(elapsed)}</span>
            </div>

            <div className="hud-sources">
              <Chip on={sources.mic} label="Mic" />
              <Chip on={sources.system} label="Speaker" />
            </div>

            <div className="hud-actions">
              <button className="btn-ghost no-drag" onClick={() => stop(false)}>Cancel</button>
              <motion.button
                className="btn-green no-drag"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => stop(true)}
                disabled={phase !== "live"}
                style={{ flex: 1.5, opacity: phase === "live" ? 1 : 0.6 }}
              >
                <span className="stop-sq" /> Stop &amp; write notes
              </motion.button>
            </div>
          </>
        )}
      </motion.div>
    </div>
  );
}

function Chip({ on, label }) {
  return (
    <span className={"src-chip" + (on ? " on" : "")}>
      <span className="src-led" />
      {label}{on ? "" : " · off"}
    </span>
  );
}

function Wave({ levels }) {
  return (
    <div className="hud-wave">
      {levels.map((v, i) => (
        <motion.span key={i} animate={{ height: 4 + v * 22 }} transition={{ type: "spring", stiffness: 480, damping: 28 }} />
      ))}
    </div>
  );
}

function Processing({ progress }) {
  const step = progress === "converting" ? 1 : progress === "transcribing" ? 2 : 3;
  const label = progress === "converting" ? "Preparing audio" : progress === "transcribing" ? "Transcribing & spotting speakers" : "Writing your notes";
  return (
    <div className="hud-proc">
      <div className="proc-bars">
        {[0, 1, 2, 3, 4].map((i) => (
          <motion.span key={i} animate={{ height: [10, 34, 10] }} transition={{ duration: 0.9, repeat: Infinity, ease: "easeInOut", delay: i * 0.11 }} />
        ))}
      </div>
      <div className="proc-label display">{label}…</div>
      <div className="proc-step">Step {step} of 3</div>
      <div className="proc-track"><motion.div animate={{ width: `${(step / 3) * 100}%` }} transition={{ type: "spring", stiffness: 120, damping: 20 }} /></div>
    </div>
  );
}

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

// Float32 PCM -> 16-bit mono WAV
export function encodeWav(samples, sampleRate) {
  const n = samples.length;
  const buffer = new ArrayBuffer(44 + n * 2);
  const view = new DataView(buffer);
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  writeStr(0, "RIFF"); view.setUint32(4, 36 + n * 2, true); writeStr(8, "WAVE"); writeStr(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); writeStr(36, "data"); view.setUint32(40, n * 2, true);
  let off = 44;
  for (let i = 0; i < n; i++) { const s = Math.max(-1, Math.min(1, samples[i])); view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true); off += 2; }
  return buffer;
}
