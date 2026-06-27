// Persistence bridge: uses Electron IPC when available, else localStorage.
const V = typeof window !== "undefined" ? window.versify : null;

export async function load(key, fallback = null) {
  try {
    if (V?.load) {
      const v = await V.load(key);
      return v == null ? fallback : v;
    }
    const raw = localStorage.getItem("versify-" + key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export async function save(key, value) {
  try {
    if (V?.save) return await V.save(key, value);
    localStorage.setItem("versify-" + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const isElectron = !!(V && V.isElectron);

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
