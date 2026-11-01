// engine.js - placeholder until the procedural sound engine lands.
export function createAudio() {
  const noop = () => {};
  return { supported: false, unlock: () => Promise.resolve(false), setEnabled: noop, setVolume: noop, update: noop, setTier: noop, suspend: noop, resume: noop, ui: noop };
}
