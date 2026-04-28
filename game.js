// ================================================================
// CLARITY // Neon City
// A memory-as-inventory immersive sim.
// ================================================================
//
// TABLE OF CONTENTS (search any banner to jump, e.g. "==== VENDORS ====")
//
//   UTILITY ................... $/$$, rand, uid
//   CONSTANTS ................. emotions, factions, save keys
//   AUDIO LAYER ............... global mute, BGM, ambient, SFX, voice, duck
//   TITLE FX .................. matrix rain
//   TERMINAL + TYPEWRITER ..... prompt host map + scene text reveal
//   STATE ..................... freshState, migrateSave
//   MEMORY MODEL .............. makeMemory, seeds, hook images, add/remove
//   AUGMENTS .................. 5 augments + helpers
//   LOGGING ................... terminal log lines
//   RENDER .................... HUD, memory stack, rep, augs, case board
//   TOOLTIPS .................. tag/faction/emotion tips
//   SCENE ..................... setScene, guessCommand, glitchScene
//   SAFEHOUSE ................. enterSafehouse + action menu
//   CONTRACT BOARD ............ CONTRACTS, board, gate reasons, follow-ups
//   ARCS ...................... 11 contract arcs (one per contract)
//   COMPLIANCE + AUDIT ........ complianceTick, auditTier, runAuditIfDue
//   THE SIGHT ................. persistent overlay toggle
//   END OF DAY ................ endDay + PENDING_EVENTS cascades
//   MEMORY MODAL .............. encrypt / re-live / burn
//   VENDORS ................... Ripperdoc, Mnemonic, Shadow, Grey, Purity
//   ENDGAME ................... starter reveal, 3 endings, banners
//   SAVE / LOAD ............... slots, versioning, autosave
//   NG+ + ARCHIVE MODE ........ carry-over modes + archive roguelite
//   PIRATE RADIO .............. 5 stations + dynamic NOW PLAYING
//   TITLE SCREEN .............. splash + slot pickers
//   DAILY EVENTS .............. 5 safehouse encounters + cascades
//   CHROME-JAWS WAR ARC ....... long-burn faction event
//   BOOT + INTRO + GLOSSARY ... startup, intro cinematic, help modal
//
// ================================================================

// ================================================================
// ==== UTILITY ====
// Tiny helpers used across the codebase.
// ================================================================
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
const uid = (() => { let i = 0; return () => `m${Date.now().toString(36)}${(i++).toString(36)}`; })();

// ================================================================
// ==== CONSTANTS ====
// Save keys, emotions, factions. Change SAVE_VERSION to force migration.
// ================================================================
const EMOTIONS = ["Joy", "Fear", "Rage", "Awe", "Grief"];

const FACTIONS = [
  { key: "shadow",   label: "THE SHADOW",    max: 10 },
  { key: "mnemonic", label: "MNEMONIC",      max: 10 },
  { key: "grey",     label: "GREY FREQ",     max: 10 },
  { key: "purity",   label: "PURITY",        max: 10 },
  { key: "omni",     label: "OMNI-CORP",     max: 10 }
];

const SAVE_VERSION = 2;
const SAVE_KEY = "clarity.save";              // legacy single-slot (auto-migrates)
const SAVE_SLOT_KEYS = ["clarity.save.s1", "clarity.save.s2", "clarity.save.s3"];
const ACTIVE_SLOT_KEY = "clarity.activeSlot"; // 0..2
const NGPLUS_KEY = "clarity.ngplus";
const INTRO_SEEN_KEY = "clarity.introSeen";
const MUTE_KEY = "clarity.muted";             // persist across sessions

// ================================================================
// ==== AUDIO LAYER ====
// Global mute state (persisted) applied to BGM, ambient, SFX,
// voice, radio, and title theme. One flag, one source of truth.
// ================================================================
// All channels respect a single muted flag that persists across sessions.
// When muted, volume is set to 0 on every element (not `el.muted=true`) so
// that it works uniformly for dynamically-created SFX instances too.
const AudioLayer = {
  muted: (() => {
    try { return localStorage.getItem(MUTE_KEY) === "1"; } catch (_) { return false; }
  })(),
  sfxInstances: new Set(),
  setMuted(m) {
    this.muted = !!m;
    try { localStorage.setItem(MUTE_KEY, this.muted ? "1" : "0"); } catch (_) {}
    if (_bgmEl) _bgmEl.volume = this.muted ? 0 : (parseFloat(_bgmEl.dataset.baseVolume) || 0.45);
    if (_ambientEl) _ambientEl.volume = this.muted ? 0 : (parseFloat(_ambientEl.dataset.baseVolume) || 0.22);
    const ra = document.getElementById("radio-audio");
    if (ra) ra.volume = this.muted ? 0 : (parseFloat(ra.dataset.baseVolume) || 0.55);
    const ta = document.getElementById("title-audio");
    if (ta) ta.volume = this.muted ? 0 : 0.7;
    if (_voiceEl) _voiceEl.volume = this.muted ? 0 : (parseFloat(_voiceEl.dataset.baseVolume) || 0.9);
    this.sfxInstances.forEach(el => { try { el.volume = this.muted ? 0 : (parseFloat(el.dataset.baseVolume) || 0.5); } catch (_) {} });
    // Reflect in any UI mute buttons
    const lbl = this.muted ? "♪ UNMUTE" : "♪ MUTE";
    document.querySelectorAll("#title-mute, #hud-mute").forEach(b => { if (b) b.textContent = lbl; });
  },
  toggle() { this.setMuted(!this.muted); }
};

const _bgmEl = (() => {
  const el = document.createElement("audio");
  el.loop = true;
  el.volume = 0.45;
  el.dataset.baseVolume = "0.45";
  el.preload = "auto";
  document.addEventListener("DOMContentLoaded", () => document.body.appendChild(el));
  return el;
})();

let _bgmCurrent = null;
function playBGM(file) {
  if (_bgmCurrent === file) return;
  _bgmCurrent = file;
  _bgmEl.src = `assets/audio/${file}`;
  _bgmEl.volume = AudioLayer.muted ? 0 : 0.45;
  _bgmEl.dataset.baseVolume = "0.45";
  _bgmEl.play().catch(() => {/* autoplay blocked — will start after first user click */});
}
function stopBGM() { _bgmCurrent = null; _bgmEl.pause(); _bgmEl.src = ""; }

// Independent ambient layer (rain, etc.) — loops quietly alongside BGM
const _ambientEl = (() => {
  const el = document.createElement("audio");
  el.loop = true;
  el.volume = 0.2;
  el.dataset.baseVolume = "0.2";
  el.preload = "auto";
  document.addEventListener("DOMContentLoaded", () => document.body.appendChild(el));
  return el;
})();
let _ambientCurrent = null;
function playAmbient(file, volume = 0.22) {
  if (_ambientCurrent === file) { _ambientEl.volume = AudioLayer.muted ? 0 : volume; return; }
  _ambientCurrent = file;
  _ambientEl.src = `assets/audio/${file}`;
  _ambientEl.dataset.baseVolume = String(volume);
  _ambientEl.volume = AudioLayer.muted ? 0 : volume;
  _ambientEl.play().catch(() => {});
}
function stopAmbient() { _ambientCurrent = null; _ambientEl.pause(); }

function playSFX(file, vol = 0.55) {
  try {
    const el = new Audio(`assets/audio/${file}`);
    el.dataset.baseVolume = String(vol);
    el.volume = AudioLayer.muted ? 0 : vol;
    AudioLayer.sfxInstances.add(el);
    const cleanup = () => { AudioLayer.sfxInstances.delete(el); };
    el.addEventListener("ended", cleanup);
    el.addEventListener("error", cleanup);
    el.play().catch(() => {});
  } catch (_) {}
}

// ================================================================
// ==== TITLE FX ====
// Katakana matrix rain — title screen only. Stops when game starts.
// ================================================================
let _matrixRaf = null;
function initMatrixRain() {
  const canvas = document.getElementById("matrix-rain");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const CHARS = "アァカサタナハマヤャラワガザダバパイィキシチニヒミリヰギジヂビピウゥクスツヌフムユュルグズヅブプエェケセテネヘメレヱゲゼデベペオォコソトノホモヨョロヲゴゾドボポヴッン0123456789ABCDEF*+-=/%$#@!<>[]{}";
  let cols, drops, fontSize;

  function resize() {
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    fontSize = Math.max(14, Math.round(canvas.width / 80));
    cols = Math.ceil(canvas.width / fontSize);
    drops = new Array(cols).fill(0).map(() => Math.random() * -50);
  }
  resize();
  window.addEventListener("resize", resize);

  let last = 0;
  const frameMs = 55; // ~18fps, low CPU and proper trail feel

  function tick(now) {
    _matrixRaf = requestAnimationFrame(tick);
    if (now - last < frameMs) return;
    last = now;
    // Fade previous frame — alpha-blend over the canvas for trails
    ctx.fillStyle = "rgba(0, 7, 0, 0.12)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.font = `${fontSize}px "Courier New", monospace`;

    for (let i = 0; i < cols; i++) {
      const ch = CHARS[Math.floor(Math.random() * CHARS.length)];
      const x = i * fontSize;
      const y = drops[i] * fontSize;
      // Head of the trail is bright / greener-white, body is primary green
      if (Math.random() < 0.04) ctx.fillStyle = "#a0ffa0";
      else ctx.fillStyle = "#00ff41";
      ctx.fillText(ch, x, y);
      if (y > canvas.height && Math.random() > 0.975) drops[i] = 0;
      drops[i] += 1;
    }
  }
  _matrixRaf = requestAnimationFrame(tick);
}

function stopMatrixRain() {
  if (_matrixRaf) { cancelAnimationFrame(_matrixRaf); _matrixRaf = null; }
}

// ================================================================
// ==== TERMINAL + TYPEWRITER ====
// Per-location bash-ish prompt host, plus the character-by-character
// reveal used for scene body text.
// ================================================================
const PROMPT_HOSTS = {
  safehouse: { user: "root",      host: "gutter-9",     cwd: "~" },
  run:       { user: "operative", host: "field",        cwd: "/run" },
  shadow:    { user: "archivist", host: "shadow-arc",   cwd: "/archive" },
  mnemonic:  { user: "buyer",     host: "mnemonic",     cwd: "/vault" },
  grey:      { user: "you",       host: "grey-freq",    cwd: "/lattice" },
  ripperdoc: { user: "client",    host: "back-alley",   cwd: "/chrome" },
  purity:    { user: "pilgrim",   host: "old-cathedral",cwd: "/temple" },
  archive:   { user: "ghost",     host: "the-shadow",   cwd: "/archive" }
};
function promptFor(loc) {
  const p = PROMPT_HOSTS[loc] || PROMPT_HOSTS.safehouse;
  return `<span class="ps1">${p.user}@${p.host}</span>:<span class="path">${p.cwd}</span>$ `;
}

// ---- Typewriter reveal ----
let _typewriterCancel = null;
// Honor the OS "reduce motion" setting — skip the char-by-char reveal entirely.
const _prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;
function typewriterReveal(nodes, speed = 14) {
  // Walk through given element list, revealing each text-bearing <p> char-by-char.
  // Returns a cancel function. Clicking anywhere skips to end.
  if (_typewriterCancel) _typewriterCancel();
  // Reduced-motion users see all text immediately.
  if (_prefersReducedMotion()) return () => {};
  let cancelled = false;
  const done = () => {};

  const texts = nodes.map(n => ({ el: n, html: n.innerHTML }));
  texts.forEach(t => { t.el.innerHTML = ""; });

  const skip = () => {
    cancelled = true;
    texts.forEach(t => { t.el.innerHTML = t.html; });
    document.removeEventListener("click", skip, true);
    document.removeEventListener("keydown", skip, true);
  };
  document.addEventListener("click", skip, true);
  document.addEventListener("keydown", skip, true);
  _typewriterCancel = skip;

  (async () => {
    for (const t of texts) {
      if (cancelled) return;
      // Reveal char by char, but preserve HTML tags as atomic chunks
      let html = "";
      const src = t.html;
      let i = 0;
      while (i < src.length && !cancelled) {
        if (src[i] === "<") {
          // Swallow the entire tag
          const end = src.indexOf(">", i);
          if (end === -1) break;
          html += src.slice(i, end + 1);
          i = end + 1;
          t.el.innerHTML = html;
        } else {
          html += src[i++];
          t.el.innerHTML = html;
          await new Promise(r => setTimeout(r, speed));
        }
      }
      if (!cancelled) t.el.innerHTML = src;
    }
    document.removeEventListener("click", skip, true);
    document.removeEventListener("keydown", skip, true);
  })();
  return skip;
}

// Ducking: lower radio + BGM volume while a voice line is playing
let _duckActive = false;
function duckMusic(duckTo = 0.12) {
  if (_duckActive) return;
  _duckActive = true;
  const ra = document.getElementById("radio-audio");
  if (ra) ra.dataset.preduckVolume = ra.volume;
  if (ra) ra.volume = duckTo;
  _bgmEl.dataset.preduckVolume = _bgmEl.volume;
  _bgmEl.volume = duckTo;
}
function unduckMusic() {
  if (!_duckActive) return;
  _duckActive = false;
  const ra = document.getElementById("radio-audio");
  if (ra && ra.dataset.preduckVolume) { ra.volume = parseFloat(ra.dataset.preduckVolume); }
  if (_bgmEl.dataset.preduckVolume) { _bgmEl.volume = parseFloat(_bgmEl.dataset.preduckVolume); }
}

// ================================================================
// ==== STATE ====
// freshState() is the single source of truth for schema shape.
// migrateSave() deep-merges loaded saves into this default so new
// fields auto-fill without breaking old saves. When you add a new
// flag, bump SAVE_VERSION only if it needs a real data transform —
// the deep-merge handles additive changes for free.
// ================================================================
let state = freshState();

function freshState() {
  return {
    version: SAVE_VERSION,
    day: 1,
    location: "safehouse",
    capacity: 8,
    compliance: 0,
    auditPending: false,
    auditTier: 0,          // 0 none, 1 Watcher, 2 Auditor, 3 Enforcement
    sightActive: false,
    sightToggled: false,   // Sight mode kept on by player (consumes meditate slot)
    memories: [],
    augments: [],          // array of augment ids
    augCharges: {},        // per-augment charge counter (spark uses this)
    reputation: { shadow: 0, mnemonic: 0, grey: 0, purity: 0, omni: 0 },
    meditatesToday: 0,
    flags: {
      starterSeen: false,
      endgameTriggered: false,
      endingAchieved: null,
      ngMode: null,           // "archive" | "erase" | "merge" | null
      droidBoyRank: 0,        // 0 = nobody, 3 = Captain
      // Chrome-Jaws war arc (triggered by high Mnemonic rep)
      chromeWarActive: false,
      chromeWarResolved: null,// null | "killed" | "tribute" | "allied"
      warTribute: false,
      warVictor: false,
      warAllied: false,
      // Prophet Kael investigation
      kaelSuspect: false,
      // Daily-event throttle — last calendar day an event fired
      lastEventDay: 0,
      // Pending event that MUST fire next safehouse (set by prior day's cascades)
      pendingEvent: null,
      // New contract flags
      latticeOffered: false, latticeCompleted: false,
      spyRingUnlocked: false, spyRingCompleted: false,
      omniSabotageOffered: false, omniSabotageCompleted: false,
      // Contract chaining: follow-up contracts spawn from prior choices
      followUps: [],        // array of contract ids to unlock this week
      // Vendor trust: number of trades per vendor (drives barter tiers)
      vendorTrust: { ripperdoc: 0, mnemonic: 0, shadow: 0, grey: 0, purity: 0 },
      // Radio news ticker index, rotates each sleep
      newsCycle: 0,
      // NG+ Archive roguelite progression
      archiveRun: 0,
      archiveEchoes: [],     // unlocked extended vignettes
      // Tutorial/nudge flags
      soldStolen: 0,
      backdoorsTriggered: 0,
      tutorialStep: 0,
      consequences: [],
      runHistory: [],
      stats: {
        contracts: 0,
        memoriesGained: 0,
        memoriesLost: 0,
        audits: 0,
        vendorTrades: 0,
        highestCompliance: 0
      },
      // Completed contract ids (for tracking + chaining)
      contractLog: []
    },
    runsCompleted: 0,
    operative: {
      name: "JANE DOE",
      origin: "BASELINE",
      path: "GUTTER-SYNDICATE RUNNER"
    }
  };
}

// ---- Save migration ----
// Normalize any loaded save into the current SAVE_VERSION shape. New fields
// added over time get filled from freshState() defaults; legacy fields are
// preserved. Returns the migrated state.
function migrateSave(raw) {
  const fresh = freshState();
  if (!raw || typeof raw !== "object") return fresh;
  // Deep-merge: top-level scalars override, nested objects merge
  const merged = Object.assign({}, fresh, raw);
  merged.flags = Object.assign({}, fresh.flags, raw.flags || {});
  merged.reputation = Object.assign({}, fresh.reputation, raw.reputation || {});
  merged.augCharges = Object.assign({}, fresh.augCharges, raw.augCharges || {});
  merged.operative = Object.assign({}, fresh.operative, raw.operative || {});
  if (!merged.flags.vendorTrust) merged.flags.vendorTrust = fresh.flags.vendorTrust;
  else merged.flags.vendorTrust = Object.assign({}, fresh.flags.vendorTrust, merged.flags.vendorTrust);
  if (!Array.isArray(merged.flags.followUps)) merged.flags.followUps = [];
  if (!Array.isArray(merged.flags.contractLog)) merged.flags.contractLog = [];
  if (!Array.isArray(merged.flags.archiveEchoes)) merged.flags.archiveEchoes = [];
  if (!Array.isArray(merged.flags.consequences)) merged.flags.consequences = [];
  if (!Array.isArray(merged.flags.runHistory)) merged.flags.runHistory = [];
  merged.flags.stats = Object.assign({}, fresh.flags.stats, merged.flags.stats || {});
  merged.version = SAVE_VERSION;
  return merged;
}

// ================================================================
// ==== MEMORY MODEL ====
// Every memory is an inventory item: hook + emotion + clarity + source.
// Memories can also be synthetic (half-value, decays faster) or
// backdoored (Omni-PING — audit target #1).
// ================================================================
function makeMemory({ hook, emotion, clarity = 3, source = "Yours", synthetic = false, backdoor = false, tags = [] }) {
  return {
    id: uid(),
    hook,
    emotion,
    clarity: Math.max(1, Math.min(5, clarity)),
    source,
    synthetic: source === "Synthetic" || synthetic,
    encrypted: false,
    backdoor,
    day: state.day,
    image: hookImage(hook, emotion),
    tags: normalizeMemoryTags(tags.length ? tags : inferMemoryTags(hook, emotion, source, { synthetic, backdoor }))
  };
}

const MEMORY_SEED_HOOKS = {
  Joy: [
    "A neon sunrise over the arcology spires",
    "A stranger's laugh in a karaoke booth",
    "Warm synth-noodles on a cold rooftop",
    "Your first clean handshake with the grid",
    "A child's hologram birthday cake"
  ],
  Fear: [
    "Synth-Hound eyes in the alley mist",
    "The moment your deck went dark",
    "Compliance footsteps in the stairwell",
    "A chrome smile that never closed",
    "The hum of a monowire warming up"
  ],
  Rage: [
    "The day they gutted the Gutter-9 clinic",
    "A Corp-Sec boot on your mother's door",
    "Watching a friend's eyes go glass",
    "The tax man who took your deck",
    "A Purity sermon as your clinic burned"
  ],
  Awe: [
    "First dive into raw data — ocean of light",
    "Lattice speaking its first moral refusal",
    "Reso's Sight unfolding over a billboard",
    "An undocumented signal from the Black Wall",
    "The silence inside an empty arcology"
  ],
  Grief: [
    "The last real song your brother wrote",
    "An apartment you can't afford to visit",
    "Rain on a funeral you were late to",
    "Your original face in a cracked mirror",
    "A name you keep forgetting on purpose"
  ]
};

// Hook -> polaroid image filename. Built once from the seed hooks; non-seed
// hooks (custom plot memories, [COPY] prefixes from sellMemory) fall back to
// an emotion-level default.
const MEMORY_HOOK_IMAGES = (() => {
  const map = {};
  for (const emo of EMOTIONS) {
    (MEMORY_SEED_HOOKS[emo] || []).forEach((hook, i) => {
      map[hook] = `memory_${emo.toLowerCase()}_${i + 1}.png`;
    });
  }
  return map;
})();

function hookImage(hook, emotion) {
  const base = "assets/images/memories/";
  const copyStripped = typeof hook === "string" && hook.startsWith("[COPY] ")
    ? hook.slice(7)
    : hook;
  if (MEMORY_HOOK_IMAGES[copyStripped]) return base + MEMORY_HOOK_IMAGES[copyStripped];
  const e = (emotion || "Awe").toLowerCase();
  return `${base}memory_${e}_default.png`;
}

function randomMemory({ emotion, clarity, source } = {}) {
  const e = emotion || rand(EMOTIONS);
  const hook = rand(MEMORY_SEED_HOOKS[e]);
  const c = clarity != null ? clarity : 2 + Math.floor(Math.random() * 3);
  return makeMemory({ hook, emotion: e, clarity: c, source: source || "Yours" });
}

const MEMORY_TAGS = ["Corporate", "Childhood", "Violent", "Blackmail", "Love", "Faith", "Machine", "Street", "Archive", "Dream"];

function normalizeMemoryTags(tags) {
  const out = [];
  (tags || []).forEach(t => {
    const clean = String(t || "").trim();
    if (clean && !out.includes(clean)) out.push(clean);
  });
  return out.slice(0, 3);
}

function inferMemoryTags(hook = "", emotion = "", source = "", flags = {}) {
  const h = String(hook).toLowerCase();
  const tags = [];
  const add = t => { if (!tags.includes(t)) tags.push(t); };
  if (/omni|corp|compliance|auditor|arcology|board|clinic|refinery|vault|packet/.test(h) || flags.backdoor) add("Corporate");
  if (/child|birthday|mother|brother|first|raised|noodles|cake/.test(h)) add("Childhood");
  if (/boot|burn|fire|fight|punch|chrome|monowire|duel|blood|rage|smoke|cut/.test(h) || emotion === "Rage") add("Violent");
  if (/secret|spy|hypocr|kael|blackmail|ledger|confession|deleted/.test(h)) add("Blackmail");
  if (/laugh|song|love|handshake|sunrise|wedding|mother|friend/.test(h) || emotion === "Joy") add("Love");
  if (/purity|prophet|sermon|temple|prayer|holy|sanctum/.test(h)) add("Faith");
  if (/grid|data|lattice|machine|synthetic|chrome|deck|signal/.test(h) || flags.synthetic || source === "Synthetic") add("Machine");
  if (/gutter|alley|rooftop|canal|street|karaoke|noodle/.test(h)) add("Street");
  if (/archive|shadow|record|tape|catalog|memory core/.test(h)) add("Archive");
  if (/dream|echo|awe|silence|window|does not exist/.test(h) || emotion === "Awe") add("Dream");
  if (!tags.length) add(emotion === "Grief" ? "Archive" : "Street");
  return normalizeMemoryTags(tags);
}

function memoryHasTags(m, tags) {
  const owned = new Set(m.tags && m.tags.length ? m.tags : inferMemoryTags(m.hook, m.emotion, m.source, m));
  return (tags || []).every(t => owned.has(t));
}

function memoryTagText(m) {
  return normalizeMemoryTags(m.tags || inferMemoryTags(m.hook, m.emotion, m.source, m)).join(" / ");
}

function addMemory(mem) {
  mem.tags = normalizeMemoryTags(mem.tags && mem.tags.length ? mem.tags : inferMemoryTags(mem.hook, mem.emotion, mem.source, mem));
  if (state.memories.length >= state.capacity) {
    log(`// OVERCAP: "${mem.hook}" slipped through. Cyber-psychosis ticks up.`, "bad");
    state.compliance = Math.min(100, state.compliance + 5);
    trackStat("highestCompliance", state.compliance, "max");
    recordConsequence("OVERFLOW", `${shortHook(mem.hook)} slipped through. Compliance +5.`, "bad");
    glitchScene();
    return false;
  }
  state.memories.push(mem);
  log(`+ MEMORY ACQUIRED: "${mem.hook}" [${mem.emotion}·${mem.clarity}]`, "ok");
  trackStat("memoriesGained", 1);
  recordConsequence("MEMORY", `Gained ${mem.emotion} ${mem.clarity}: ${shortHook(mem.hook)}.`, "ok");
  sensoryFlash("memory");
  playSFX("sfx_memory_chime.mp3", 0.5);
  // NG+ Merge carry-over: every memory you gather also feeds the hive
  if (state.flags.ngMode === "merge") {
    state.reputation.omni = Math.min(10, state.reputation.omni + 1);
    log("// The Project hums. Your memory becomes everyone's.", "lore");
  }
  render();
  return true;
}

function removeMemory(id) {
  const idx = state.memories.findIndex(m => m.id === id);
  if (idx >= 0) {
    const [m] = state.memories.splice(idx, 1);
    trackStat("memoriesLost", 1);
    recordConsequence("MEMORY LOST", `${shortHook(m.hook)} left your stack.`, "warn");
    applyMemoryRelationshipEffects(m);
    render();
    return m;
  }
  return null;
}

// ================================================================
// ==== AUGMENTS ====
// 5 chrome upgrades. Each has a real gameplay effect, not just flavor.
// Installing any augment drops Purity rep and locks out the Sanctum.
// ================================================================
const AUGMENTS = [
  { id: "reflex",  name: "Chrome-Jaw Reflex",          cost: { emotion: "Rage",  clarity: 4 }, effect: "Avoid one run-fail outcome per day" },
  { id: "ice",     name: "Grid Architect ICE-piercer", cost: { emotion: "Awe",   clarity: 4 }, effect: "+1 memory yield on data runs" },
  { id: "cloak",   name: "Runner's Cloak",             cost: { emotion: "Fear",  clarity: 3 }, effect: "Compliance gain reduced 25%" },
  { id: "empathy", name: "Empathy Dampener",           cost: { emotion: "Grief", clarity: 3 }, effect: "Stolen memories resist decay" },
  { id: "spark",   name: "Circuit Shaman Spark",       cost: { emotion: "Joy",   clarity: 5 }, effect: "Absorb one audit (one-time)" }
];

function hasAug(id) { return state.augments.includes(id); }
function augDef(id) { return AUGMENTS.find(a => a.id === id); }

// ================================================================
// ==== LOGGING ====
// Terminal lines at the bottom of the CRT. cls = "ok" | "warn" | "bad" | "lore".
// ================================================================
function log(text, cls = "") {
  const entry = document.createElement("div");
  entry.className = `entry ${cls}`;
  entry.textContent = text;
  const logEl = $("#log");
  if (!logEl) return;
  logEl.appendChild(entry);
  logEl.scrollTop = logEl.scrollHeight;
  while (logEl.children.length > 80) logEl.removeChild(logEl.firstChild);
}

function trackStat(key, amount = 1, mode = "add") {
  state.flags.stats = Object.assign({}, freshState().flags.stats, state.flags.stats || {});
  if (mode === "max") state.flags.stats[key] = Math.max(state.flags.stats[key] || 0, amount);
  else state.flags.stats[key] = (state.flags.stats[key] || 0) + amount;
}

function recordConsequence(kind, text, tone = "") {
  state.flags.consequences = state.flags.consequences || [];
  state.flags.consequences.unshift({ day: state.day, kind, text, tone });
  state.flags.consequences = state.flags.consequences.slice(0, 8);
}

function sensoryFlash(kind) {
  const crt = document.getElementById("crt");
  if (!crt) return;
  crt.classList.remove("flash-memory", "flash-choice", "flash-audit");
  void crt.offsetWidth;
  crt.classList.add(`flash-${kind}`);
  setTimeout(() => crt.classList.remove(`flash-${kind}`), 700);
}

function applyMemoryRelationshipEffects(removed) {
  if (!removed || !state.memories.length) return;
  const tags = new Set(removed.tags || []);
  if (removed.starter) tags.add("Childhood");
  const linked = state.memories.filter(m =>
    !m.encrypted &&
    m.clarity > 1 &&
    (m.emotion === removed.emotion || (m.tags || []).some(t => tags.has(t)))
  );
  if (!linked.length || Math.random() > 0.38) return;
  const target = rand(linked);
  target.clarity = Math.max(1, target.clarity - 1);
  recordConsequence("ECHO DAMAGE", `${shortHook(target.hook)} lost 1 Clarity after a related memory vanished.`, "warn");
  log(`// ECHO DAMAGE: "${target.hook}" destabilized after a related memory vanished.`, "warn");
}

// ================================================================
// ==== RENDER ====
// render() repaints HUD + memory stack + rep + augs from state.
// Call after any state mutation the player should see.
// ================================================================
function render() {
  // HUD
  $("#name-readout").textContent = `— ${state.operative.name} —`;
  $("#origin-readout").textContent = `${state.operative.origin} // ${state.operative.path}`;
  $("#day-readout").textContent = String(state.day).padStart(2, "0");
  $("#location-readout").textContent = locationLabel(state.location);

  const capPct = (state.memories.length / state.capacity) * 100;
  $("#capacity-bar .fill").style.width = capPct + "%";
  $("#capacity-readout").textContent = `${state.memories.length} / ${state.capacity}`;

  $("#compliance-bar .fill").style.width = state.compliance + "%";
  $("#compliance-readout").textContent = `${state.compliance} %`;
  // HUD audit tier indicator
  const tierEl = document.getElementById("audit-tier-readout");
  if (tierEl) {
    const tier = state.auditTier || 0;
    const label = tier === 0 ? ""
                : tier === 1 ? "WATCHER"
                : tier === 2 ? "AUDITOR DISPATCHED"
                : "ENFORCEMENT ACTIVE";
    tierEl.textContent = label;
    tierEl.className = "sub audit-tier tier-" + tier;
  }
  // Danger pulse at 90%+ capacity
  const capBar = document.getElementById("capacity-bar");
  if (capBar) capBar.classList.toggle("danger", (state.memories.length / state.capacity) >= 0.9);

  // Memories
  const ml = $("#memory-list");
  ml.innerHTML = "";
  if (state.memories.length === 0) {
    ml.innerHTML = `<div class="hint" style="color:var(--dim);font-size:12px;">Stack empty. Run a contract.</div>`;
  }
  state.memories.forEach(m => {
    const el = document.createElement("div");
    el.className = `memory ${m.encrypted ? "encrypted" : ""} ${m.synthetic ? "synthetic" : ""}`;
    const imgSrc = m.image || hookImage(m.hook, m.emotion);
    el.innerHTML = `
      <img class="polaroid-img" src="${imgSrc}" alt="" onerror="this.onerror=null;this.src='data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';this.dataset.missing='1';">
      <div class="hook" data-tip="Click for memory actions — encrypt, re-live, burn.">${escapeHtml(m.hook)}${m.backdoor ? ' <span style="color:var(--audit);" data-tip="Omni-Corp has a tracking ping on this memory. Auditors will find it.">•PING</span>' : ''}</div>
      <div class="meta">
        <span class="emotion ${m.emotion}" data-tip="${escapeHtml(EMOTION_TIPS[m.emotion] || "")}">${m.emotion.toUpperCase()}</span>
        <span class="clarity-pips" data-tip="Clarity ${m.clarity}/5. Decays 1 per night unless encrypted. Higher Clarity is valuable \u2014 and targeted first by Auditors.">${"▮".repeat(m.clarity)}${"▯".repeat(5 - m.clarity)}</span>
        <span data-tip="${m.source === 'Yours' ? 'Your own memory. Unchanged.' : m.source === 'Stolen' ? 'Extracted from someone else. Has a moral cost.' : 'Synthetic copy. Half-clarity and sometimes backdoored.'}">${m.source.toUpperCase()}</span>
        <span class="mem-tags" data-tip="Memory tags unlock vendor recipes and link related memories.">${escapeHtml(memoryTagText(m))}</span>
      </div>
    `;
    el.addEventListener("click", () => openMemoryModal(m));
    ml.appendChild(el);
  });

  // Reputation
  renderRep();

  // Augments
  renderAugs();

  // Case board
  renderCaseBoard();
}

function renderRep() {
  const el = $("#rep-list");
  if (!el) return;
  el.innerHTML = "";
  FACTIONS.forEach(f => {
    const v = state.reputation[f.key];
    const pct = Math.min(100, Math.abs(v) / f.max * 50);
    const row = document.createElement("div");
    row.className = `rep-row ${f.key}`;
    row.setAttribute("data-tip", FACTION_TIPS[f.key] || "");
    row.innerHTML = `
      <span class="rep-name">${f.label}</span>
      <div class="rep-bar ${v < 0 ? 'neg' : ''}">
        <div class="fill" style="
          ${v >= 0 ? `left:50%; width:${pct}%;` : `left:${50 - pct}%; width:${pct}%;`}
        "></div>
      </div>
      <span class="rep-val">${v > 0 ? '+' : ''}${v}</span>
    `;
    el.appendChild(row);
  });
}

function renderAugs() {
  const el = $("#aug-list");
  if (!el) return;
  if (state.augments.length === 0) {
    el.innerHTML = `<span class="hint">No augments installed.</span>`;
    return;
  }
  el.innerHTML = "";
  state.augments.forEach(id => {
    const a = augDef(id);
    if (!a) return;
    const chip = document.createElement("span");
    let cls = "aug-chip";
    if (id === "spark") {
      const spent = state.augCharges.spark === 0;
      if (spent) cls += " spent"; else cls += " charged";
    }
    chip.className = cls;
    chip.textContent = a.name;
    chip.setAttribute("data-tip", `${a.name} \u2014 ${a.effect}`);
    el.appendChild(chip);
  });
}

function renderCaseBoard() {
  const el = $("#lead-list");
  if (!el) return;
  const leads = caseBoardLeads().slice(0, 5);
  if (!leads.length) {
    el.innerHTML = `<div class="hint" style="font-size:11px;">No active leads. Run a contract and make someone nervous.</div>`;
    return;
  }
  el.innerHTML = leads.map(lead => `
    <div class="lead-item ${lead.tone || ""}"${lead.tip ? ` data-tip="${escapeHtml(lead.tip)}"` : ""}>
      <span class="lead-kind">${escapeHtml(lead.kind)}</span>
      <span class="lead-text">${escapeHtml(lead.text)}</span>
    </div>
  `).join("");
}

function caseBoardLeads() {
  const leads = [];
  const trust = state.flags.vendorTrust || {};
  const rep = state.reputation || {};
  const memories = state.memories || [];
  const consequences = (state.flags.consequences || []).slice(0, 2);

  consequences.forEach(c => leads.push({
    kind: c.kind,
    tone: c.tone === "bad" ? "risk" : c.tone === "ok" ? "unlock" : "goal",
    text: `Day ${String(c.day).padStart(2, "0")}: ${c.text}`
  }));

  const tutorial = tutorialLead();
  if (tutorial) leads.push(tutorial);

  if (state.flags.ngMode === "archive") {
    const archived = readNGPlus().finalMemories || [];
    const reached = new Set(state.flags.archiveEchoes || []);
    leads.push({
      kind: "ARCHIVE",
      tone: "unlock",
      text: `${reached.size}/${archived.length || memories.length} echoes delivered. Re-live memories to broadcast them.`
    });
    return leads;
  }

  if (state.auditPending || state.auditTier > 0) {
    const tier = state.auditTier || computeAuditTier(state.compliance);
    const victims = auditPriority(memories.filter(m => !m.encrypted));
    const lossCount = tier >= 3 ? Math.max(1, Math.ceil(victims.length / 2))
                    : tier === 2 ? Math.min(2, victims.length)
                    : Math.min(1, victims.length);
    leads.push({
      kind: tier >= 3 ? "ENFORCEMENT" : tier === 2 ? "AUDITOR" : "WATCHER",
      tone: "risk",
      text: victims.length
        ? `Sleep strips ${lossCount} memory${lossCount === 1 ? "" : "ies"}. First target: ${shortHook(victims[0].hook)}.`
        : "Audit pending, but the whole stack is encrypted."
    });
  } else if (state.compliance >= 35) {
    leads.push({
      kind: "HEAT",
      tone: "risk",
      text: `Compliance is ${state.compliance}%. Watcher dispatches at 40%.`
    });
  }

  const pinged = memories.find(m => m.backdoor && !m.encrypted);
  if (pinged) {
    leads.push({
      kind: "PING",
      tone: "risk",
      text: `Omni can trace ${shortHook(pinged.hook)}. Encrypt, burn, or use it for sabotage.`
    });
  }

  const nextContract = nextLockedContractLead();
  if (nextContract) leads.push(nextContract);

  const vendorLead = nextVendorTrustLead(trust);
  if (vendorLead) leads.push(vendorLead);

  const memoryLead = nextMemoryGoalLead();
  if (memoryLead) leads.push(memoryLead);

  const starter = memories.find(m => m.starter === true || (m.hook && m.hook.includes("woman who raised you")));
  if (starter && state.runsCompleted >= 3 && !state.flags.starterSeen) {
    leads.push({
      kind: "SEAMS",
      tone: "unlock",
      text: "Inspect your starter memory. Its edges are too clean."
    });
  } else if (!state.flags.endgameTriggered && state.runsCompleted >= 4) {
    const bestRep = Math.max(...Object.values(rep).map(Math.abs));
    leads.push({
      kind: "ENDGAME",
      tone: "unlock",
      text: `Any faction at +/-8 after 5 runs opens the three doors. Best signal: ${bestRep}.`
    });
  }

  if (state.flags.chromeWarActive && !state.flags.chromeWarResolved) {
    leads.unshift({
      kind: "CHROME WAR",
      tone: "risk",
      text: "Ripperdoc and Chrome-Jaw runs are sealed until Duchess Rend is answered."
    });
  }

  return dedupeLeads(leads);
}

function tutorialLead() {
  const step = state.flags.tutorialStep || 0;
  if (state.runsCompleted === 0) return { kind: "FIRST RUN", tone: "goal", text: "Take a contract, then read the run report." };
  if (step < 1 && state.memories.length > 1) return { kind: "MEMORY", tone: "goal", text: "Click a memory. Re-live, encrypt, or burn it." };
  if (step < 2 && state.memories.some(m => !m.encrypted && m.clarity <= 2)) return { kind: "ENCRYPT", tone: "goal", text: "At the safehouse, encrypt one important memory using low-Clarity cover." };
  if (step < 3 && state.day === 1) return { kind: "SLEEP", tone: "goal", text: "Sleep advances the city. Unencrypted memories can decay." };
  if (step < 4 && state.runsCompleted >= 1) return { kind: "VENDOR", tone: "goal", text: "Visit a vendor. Tags can unlock better recipes." };
  return null;
}

function nextLockedContractLead() {
  const all = typeof CONTRACTS === "undefined" ? [] : CONTRACTS;
  const locked = all.find(c => !c.gate() && gateReason(c));
  if (!locked) return null;
  return {
    kind: "CONTRACT",
    tone: "unlock",
    text: `${contractTitle(locked)}: ${gateReason(locked)}.`
  };
}

function nextVendorTrustLead(trust) {
  const goals = [
    { key: "shadow", label: "Shadow", at: 3, text: "Shadow trust 3 unlocks off-book memory storage." },
    { key: "grey", label: "Grey", at: 3, text: "Grey trust 3 reveals the Purity spy-ring lead." },
    { key: "ripperdoc", label: "Ripperdoc", at: 3, text: "Ripperdoc trust 3 unlocks synthetic barter." },
    { key: "mnemonic", label: "Mnemonic", at: 3, text: "Mnemonic trust 3 unlocks commissioned extractions." },
    { key: "purity", label: "Purity", at: 3, text: "Purity trust 3 unlocks confession scrubs." }
  ];
  const goal = goals.find(g => (trust[g.key] || 0) > 0 && (trust[g.key] || 0) < g.at);
  if (!goal) return null;
  return {
    kind: "TRUST",
    tone: "unlock",
    text: `${goal.text} Current: ${trust[goal.key] || 0}/${goal.at}.`
  };
}

function nextMemoryGoalLead() {
  if (!hasAug("cloak")) return memoryCostLead("Fear", 3, "Runner's Cloak slows every Compliance gain.");
  if (!hasAug("ice")) return memoryCostLead("Awe", 4, "ICE-piercer adds bonus yield on data runs.");
  if (!hasAug("spark")) return memoryCostLead("Joy", 5, "Circuit Shaman Spark absorbs one audit.");
  if (state.runsCompleted >= 4 && state.reputation.shadow >= 2) return memoryCostLead("Fear", 5, "Fear 5 can bluff the Compliance Heist.");
  if ((state.flags.droidBoyRank || 0) === 2) return memoryCostLead("Awe", 5, "Awe 5 can win the Captain Trial without blood.");
  return null;
}

function memoryCostLead(emotion, clarity, payoff) {
  const hasMatch = state.memories.some(m => !m.encrypted && m.emotion === emotion && m.clarity >= clarity);
  return {
    kind: "MEMORY",
    tone: hasMatch ? "unlock" : "goal",
    text: hasMatch
      ? `${emotion} ${clarity}+ is in your stack. ${payoff}`
      : `Find or refresh ${emotion} ${clarity}+. ${payoff}`
  };
}

function contractTitle(c) {
  return typeof c.title === "function" ? c.title() : c.title;
}

function shortHook(hook, n = 42) {
  if (!hook) return "unknown memory";
  return hook.length > n ? `${hook.slice(0, n - 3)}...` : hook;
}

function dedupeLeads(leads) {
  const seen = new Set();
  return leads.filter(lead => {
    const key = `${lead.kind}:${lead.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function locationLabel(loc) {
  switch (loc) {
    case "safehouse": return "SAFEHOUSE // GUTTER-9";
    case "run": return "IN THE FIELD";
    case "shadow": return "THE SHADOW ARCHIVE";
    case "mnemonic": return "MNEMONIC LAB // NEON-7";
    case "grey": return "THE GREY FREQUENCY";
    case "ripperdoc": return "RIPPERDOC // BACK ALLEY";
    case "purity": return "PURITY TEMPLE // OLD CATHEDRAL";
    default: return loc.toUpperCase();
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---- Voice (Chatterbox TTS one-shots) ----
let _voiceEl = null;
function playVoice(file, volume = 0.9) {
  if (!file) return;
  try {
    if (_voiceEl) { _voiceEl.pause(); _voiceEl = null; unduckMusic(); }
    _voiceEl = new Audio(`assets/audio/${file}`);
    _voiceEl.dataset.baseVolume = String(volume);
    _voiceEl.volume = AudioLayer.muted ? 0 : Math.max(0, Math.min(1, volume));
    _voiceEl.onerror = () => { unduckMusic(); };
    _voiceEl.onended = () => { unduckMusic(); };
    duckMusic();
    _voiceEl.play().catch(() => { unduckMusic(); });
  } catch (_) { unduckMusic(); }
}

// ================================================================
// ==== TOOLTIPS ====
// Any element with a [data-tip] attribute gets a hovering tip.
// Predefined dictionaries for tags, factions, and emotions.
// ================================================================
// Any element with a data-tip="..." attribute gets a styled tooltip on hover.
const _tooltipEl = (() => {
  const el = document.createElement("div");
  el.id = "tooltip";
  el.style.display = "none";
  document.addEventListener("DOMContentLoaded", () => document.body.appendChild(el));
  return el;
})();

function initTooltips() {
  const show = (target) => {
    const text = target.getAttribute("data-tip");
    if (!text) return;
    _tooltipEl.textContent = text;
    _tooltipEl.style.display = "block";
  };
  const hide = () => { _tooltipEl.style.display = "none"; };
  const move = (e) => {
    // Position below-right of the cursor, flipping at viewport edges
    const t = _tooltipEl;
    const px = e.clientX + 14;
    const py = e.clientY + 18;
    t.style.left = "0px"; t.style.top = "0px";
    // Measure after positioning
    const tw = t.offsetWidth, th = t.offsetHeight;
    const x = Math.min(px, window.innerWidth - tw - 10);
    const y = py + th > window.innerHeight - 10 ? e.clientY - th - 14 : py;
    t.style.left = x + "px";
    t.style.top  = y + "px";
  };

  document.addEventListener("mouseover", (e) => {
    const tipEl = e.target.closest && e.target.closest("[data-tip]");
    if (tipEl) show(tipEl);
  });
  document.addEventListener("mouseout", (e) => {
    const tipEl = e.target.closest && e.target.closest("[data-tip]");
    if (tipEl && !tipEl.contains(e.relatedTarget)) hide();
  });
  document.addEventListener("mousemove", move);
}

// Legends for scene-choice tags, shown when hovering the tag pill.
const TAG_TIPS = {
  "RUN":        "Take on a contract — leave the safehouse on a mission.",
  "SPEND":      "Vendor. Costs a specific Emotion + Clarity memory as payment.",
  "TRADE":      "Sell a memory. You get a half-clarity synthetic copy back.",
  "INFO":       "Grey Frequency. Trade Awe memories for Compliance scrubs + rumors.",
  "FAITH":      "Purity Temple. Only usable if you have no augments installed.",
  "END DAY":    "Sleep. Advances the day. Decays memories by 1 clarity. Pending Audits fire.",
  "RISK":       "Higher reward, higher Compliance cost. Usually a moral gray line.",
  "RESO":       "Tune Reso's pirate overlay — reveals hidden memory echoes for bonus loot.",
  "SAFE":       "No payout, no heat. Walk away.",
  "LORE":       "Donate to the Shadow. No credits, but rep and cooldown.",
  "MERCY":      "Peaceful resolution. Usually swaps faction rep (gentler + different payoff).",
  "ETHICS":     "Moral line. The factions that care will care.",
  "GREEDY":     "Take more than the job called for. Bigger pile, more bad dreams.",
  "HEIST":      "All-in smash-and-grab.",
  "CONFIDENCE": "Bluff your way through. Costs a high-Fear memory as your 'uniform'.",
  "TORCH":      "Burn it down. Irreversible rep hit with Omni. The Shadow approves.",
  "BETRAYAL":   "Reveal a secret. Rep consequences all around.",
  "CHROME":     "Install an augment — permanent until removed. Purity hates it.",
  "OUT":        "Back out. Small rep hit from whoever offered the contract.",
  "FIGHT":      "Physical confrontation. Needs Reflex augment or a Rage·5 memory.",
  "SUBMIT":     "Pay what they demand. Lose your highest-clarity unsecured memory.",
  "ALLY":       "Call in a faction for help. They will remember you owed them.",
  "INVESTIGATE":"Dig deeper. Unlocks lore + future choices.",
  "ENDGAME":    "Trigger the endgame. Three doors open.",
  "EXIT":       "Leave this mode and return to the world.",
  "BEGIN":      "Step into Neon City. The game starts now.",
  "TAGS":       "Requires a memory with specific tags. Open a memory to inspect its tags.",
  "RAGE":       "Requires a Rage memory as cost or wager.",
  "FEAR":       "Requires a Fear memory as cost.",
  "AWE":        "Requires an Awe memory as cost.",
  "JOY":        "Requires a Joy memory as cost.",
  "GRIEF":      "Requires a Grief memory as cost."
};

function tipForTag(tagText) {
  if (!tagText) return null;
  // Match like "C+25" (contract compliance)
  if (/^C\+\d+/.test(tagText)) return "Compliance this contract will add. Watch the bar.";
  // Match "RAGE·3+" / "AWE·5" etc
  const em = tagText.match(/^(JOY|FEAR|RAGE|AWE|GRIEF)[·xX]?(\d+)?\+?/);
  if (em) return `Requires a ${em[1].toLowerCase()} memory${em[2] ? ` at clarity ≥ ${em[2]}` : ""}.`;
  return TAG_TIPS[tagText.toUpperCase().trim()] || null;
}

const FACTION_TIPS = {
  shadow:   "THE SHADOW — the resistance archive. Donate memories to raise rep. They'll remember.",
  mnemonic: "MNEMONIC COLLECTIVE — memory black market. Sell memories to them for synthetic copies.",
  grey:     "GREY FREQUENCY — Lattice, the neutral AI broker. Trade Awe memories for Compliance scrubs.",
  purity:   "PURITY — anti-augmentation cult. Installing any chrome tanks rep here.",
  omni:     "OMNI-CORP — the Project. Corporate contracts pay well but plant backdoor 'pings'.",
};

const EMOTION_TIPS = {
  Joy:    "JOY — currency for bribes, wedding-vow memories, childhood. Bright but soft.",
  Fear:   "FEAR — currency for the Cloak augment. Your nervous-system memories.",
  Rage:   "RAGE — currency for Chrome-Jaw reflex + duels. High-intensity combat memory.",
  Awe:    "AWE — currency for ICE-piercer + Grey Frequency. Transcendent, irreplaceable.",
  Grief:  "GRIEF — currency for Empathy Dampener. Losses, absences, faces you've forgotten.",
};

// ================================================================
// ==== SCENE ====
// Every "screen" — safehouse menu, vendor, contract arc — is a scene.
// setScene({ title, body, choices, portrait, faction, voice, cmd })
// owns the feed panel and choice buttons. Choices support { disabled,
// tag, risk } for gating and styling.
// ================================================================
function setScene({ title, body, choices, portrait, faction, voice, cmd }) {
  // Update the terminal prompt line above the scene
  const promptEl = $("#scene-prompt");
  if (promptEl) {
    const command = cmd || guessCommand(title, state.location);
    promptEl.innerHTML = `${promptFor(state.location)}<span class="cmd">${command}</span><span class="typer-caret"></span>`;
  }

  const sceneBody = $("#scene-body");
  sceneBody.innerHTML = "";
  if (portrait) {
    const img = document.createElement("img");
    img.className = "portrait" + (faction ? ` faction-${faction}` : "");
    img.src = `assets/images/${portrait}`;
    img.alt = "";
    sceneBody.appendChild(img);
  }
  if (voice) playVoice(voice);

  const typerTargets = [];
  if (title) {
    const h = document.createElement("p");
    h.className = "glitch";
    h.textContent = title;
    sceneBody.appendChild(h);
    typerTargets.push(h);
  }
  (Array.isArray(body) ? body : [body]).forEach(p => {
    const el = document.createElement("p");
    el.innerHTML = p;
    sceneBody.appendChild(el);
    typerTargets.push(el);
  });

  const cc = $("#scene-choices");
  cc.innerHTML = "";
  (choices || []).forEach(c => {
    const btn = document.createElement("button");
    btn.className = "choice" + (c.risk ? " risk" : "");
    const tagTip = c.tag ? tipForTag(c.tag) : null;
    btn.innerHTML = `${c.label}${c.tag ? `<span class="tag"${tagTip ? ` data-tip="${escapeHtml(tagTip)}"` : ""}>${c.tag}</span>` : ""}`;
    const isDisabled = typeof c.disabled === "function" ? c.disabled() : !!c.disabled;
    btn.addEventListener("click", () => {
      if (isDisabled) { if (typeof c.action === "function") c.action(); return; }
      c.action();
    });
    if (isDisabled) {
      btn.classList.add("disabled");
      btn.style.opacity = 0.5;
      btn.style.cursor = "not-allowed";
      if (c.tip) btn.setAttribute("data-tip", c.tip);
    }
    cc.appendChild(btn);
  });

  // Typewriter reveal of the story text — click/tap anywhere to skip.
  if (typerTargets.length) typewriterReveal(typerTargets, 12);
}

// Infer a bash-ish "command" from the scene title / location for the prompt line.
function guessCommand(title, location) {
  const t = (title || "").toLowerCase();
  if (location === "run") {
    if (t.includes("tunnel")) return "ssh tunnel --target=memory-core";
    if (t.includes("plaza") || t.includes("courier")) return "deliver --packet /dev/unknown";
    if (t.includes("drophouse")) return "extract --target=vex --mode=mnemonic";
    if (t.includes("smuggle") || t.includes("customs")) return "move --crate chrome_jaw.bin";
    if (t.includes("cleanse") || t.includes("clinic")) return "ignite --target brightline.clinic";
    if (t.includes("duel") || t.includes("arena")) return "duel --captain droidboy";
    if (t.includes("vault")) return "heist --vault compliance";
    if (t.includes("initiate") || t.includes("mid") || t.includes("rank") || t.includes("captain trial")) return "climb --rank droidboy";
    return "run contract";
  }
  if (location === "shadow")    return "cat /archive/tapes.log";
  if (location === "mnemonic")  return "trade --memory";
  if (location === "grey")      return "ping lattice";
  if (location === "ripperdoc") return "install chrome";
  if (location === "purity")    return "kneel";
  if (location === "archive")   return "play /records/all";
  // safehouse default
  if (t.includes("welcome")) return "clarity --firstboot";
  if (t.includes("exfiltration")) return "exfil --home";
  if (t.includes("safehouse")) return "cat today.log";
  if (t.includes("knock") || t.includes("compliance")) return "netstat | grep AUDITOR";
  return "tail -f feed.log";
}

function glitchScene() {
  $("#crt").classList.add("auditing");
  setTimeout(() => $("#crt").classList.remove("auditing"), 1500);
}

// ================================================================
// ==== SAFEHOUSE ====
// Home base. Gutter-9 apartment. Entry point to every other screen.
// Daily events roll here probabilistically after day 2.
// ================================================================
function enterSafehouse() {
  state.location = "safehouse";
  playBGM("safehouse_ambient.mp3");
  playAmbient("sfx_rain_loop.mp3", 0.18);
  render();

  // Endgame trigger: happens at high Shadow rep + at least 5 runs, or on the starter memory re-inspection
  maybeTriggerEndgame();

  // Chrome-Jaws war trigger: high Mnemonic rep brings Duchess Rend to your door
  if (!state.flags.chromeWarActive && state.reputation.mnemonic >= 6 && state.runsCompleted >= 3) {
    state.flags.chromeWarActive = true;
    setTimeout(triggerChromeWarIntro, 500);
    return;
  }

  // Daily event — fires once per calendar day
  if (state.flags.lastEventDay !== state.day && Math.random() < 0.55) {
    state.flags.lastEventDay = state.day;
    const ev = pickDailyEvent();
    if (ev) { ev(); return; }
  }

  const hasMemories = state.memories.length > 0;
  setScene({
    title: `DAY ${String(state.day).padStart(2,"0")} // SAFEHOUSE`,
    body: [
      "Rain drums on the corrugated roof. A dozen tiny red LEDs blink from the deck on your workbench.",
      "Gutter-9 is quiet. For now."
    ],
    choices: [
      {
        label: "Check the contract board",
        tag: "RUN",
        action: openContractBoard
      },
      {
        label: "Visit the Ripperdoc",
        tag: "SPEND",
        action: openRipperdoc,
        disabled: () => !hasMemories || (state.flags.chromeWarActive && !state.flags.chromeWarResolved)
      },
      {
        label: "Route through Mnemonic Lab",
        tag: "TRADE",
        action: openMnemonic,
        disabled: () => !hasMemories
      },
      {
        label: "Drop off at The Shadow Archive",
        tag: "LORE",
        action: openShadow,
        disabled: () => !hasMemories
      },
      {
        label: "Ping the Grey Frequency",
        tag: "INFO",
        action: openGrey,
        disabled: () => state.reputation.grey < 2 && !hasAug("ice")
      },
      {
        label: "Visit the Purity Temple",
        tag: "FAITH",
        action: openPurity,
        disabled: () => state.reputation.purity < 1 && state.day < 2
      },
      {
        label: "Tune the deck and sleep",
        tag: "END DAY",
        action: endDay
      }
    ]
  });
}

// ================================================================
// ==== CONTRACT BOARD ====
// Available contracts filtered by gate(). Locked contracts surface
// with a gateReason() explaining the unlock condition.
// processFollowUps() consumes state.flags.followUps queued during
// arcs to unlock future postings.
// ================================================================
const CONTRACTS = [
  {
    id: "gutter_salvage",
    title: "GUTTER SALVAGE",
    issuer: "The Shadow",
    brief: "Recover a memory core from a flooded maintenance tunnel.",
    compliance: 5,
    arc: "gutterSalvage",
    gate: () => true
  },
  {
    id: "corporate_courier",
    title: "CORPORATE COURIER",
    issuer: "Omni-Corp (cutout)",
    brief: "Deliver a sealed neural packet across the arcology plaza.",
    compliance: 20,
    arc: "corporateCourier",
    gate: () => true
  },
  {
    id: "drophouse_break",
    title: "DROPHOUSE BREAK",
    issuer: "Mnemonic Collective",
    brief: "Extract a stranger's memory from a Chrome-Jaw drophouse.",
    compliance: 12,
    arc: "drophouse",
    gate: () => !(state.flags.chromeWarActive && !state.flags.chromeWarResolved)
  },
  {
    id: "chromejaw_run",
    title: "CHROME-JAW SMUGGLE",
    issuer: "Chrome-Jaws",
    brief: "Move a crate of illegal monowire through Tier-2 customs.",
    compliance: 15,
    arc: "chromejawRun",
    gate: () => state.runsCompleted >= 1 && !(state.flags.chromeWarActive && !state.flags.chromeWarResolved)
  },
  {
    id: "purity_cleanse",
    title: "PURITY CLEANSE",
    issuer: "Purity",
    brief: "Sabotage a Chrome clinic. No augments permitted during run.",
    compliance: 8,
    arc: "purityCleanse",
    gate: () => state.runsCompleted >= 2
  },
  {
    id: "droidboy_duel",
    title: "DROID-BOY DUEL",
    issuer: "Droid Boys",
    brief: "Settle a rank dispute with a Droid Boy captain. Rage test.",
    compliance: 10,
    arc: "droidBoyDuel",
    gate: () => state.runsCompleted >= 3
  },
  {
    id: "compliance_heist",
    title: "COMPLIANCE HEIST",
    issuer: "The Shadow",
    brief: "Five minutes in the memory vault. Do not be caught humming.",
    compliance: 25,
    arc: "complianceHeist",
    gate: () => state.runsCompleted >= 4 && state.reputation.shadow >= 2
  },
  {
    id: "droidboy_rankclimb",
    title: () => {
      const r = state.flags.droidBoyRank || 0;
      return r === 0 ? "DROID BOY \u2014 INITIATE"
           : r === 1 ? "DROID BOY \u2014 MID"
           : r === 2 ? "DROID BOY \u2014 CAPTAIN TRIAL"
           : "DROID BOY \u2014 NO MORE RUNGS";
    },
    issuer: "Droid Boys",
    brief: "Climb the chrome ladder. Three ranks, three prices.",
    compliance: 8,
    arc: "droidBoyRankClimb",
    gate: () => state.runsCompleted >= 3 && (state.flags.droidBoyRank || 0) < 3 && !(state.flags.chromeWarActive && !state.flags.chromeWarResolved)
  },
  {
    id: "lattice_data_theft",
    title: "LATTICE QUIET LINE",
    issuer: "Grey Frequency",
    brief: "Lattice wants an Omni datum it can't legally buy. Pull it without triggering the AI's kill-switch.",
    compliance: 18,
    arc: "latticeDataTheft",
    gate: () => state.flags.latticeOffered && !state.flags.latticeCompleted
  },
  {
    id: "purity_spy_ring",
    title: "COUNCIL SPY RING",
    issuer: "Purity",
    brief: "Identify and out the Purity spy embedded in the Gutter-9 council. No chrome on the run.",
    compliance: 10,
    arc: "puritySpyRing",
    gate: () => state.flags.spyRingUnlocked && !state.flags.spyRingCompleted
  },
  {
    id: "omni_sabotage",
    title: "OMNI SABOTAGE",
    issuer: "The Shadow",
    brief: "Plant a ghost-loop in an Omni memory refinery. Burn a backdoor to do it.",
    compliance: 28,
    arc: "omniSabotage",
    gate: () => state.flags.omniSabotageOffered && !state.flags.omniSabotageCompleted
  }
];

const CONTRACT_INTEL = {
  gutter_salvage: {
    reward: "Fear/Grief, Sight can pull Awe 4",
    shifts: "Low heat, neutral factions",
    risks: "Small Compliance bump",
    helps: "ICE-piercer adds a bonus memory"
  },
  corporate_courier: {
    reward: "Joy 4 with Omni PING, or Awe 5 synthetic if cracked",
    shifts: "Omni path or Shadow/Grey pivot",
    risks: "Backdoor trace, high heat if betrayed",
    unlocks: "Good source for a pinged key later"
  },
  drophouse_break: {
    reward: "Rage 4 stolen, greedy route adds Grief/Joy",
    shifts: "Mnemonic up, Shadow may sour",
    risks: "Stolen memories audit harder",
    helps: "Feeds Mnemonic trust and synthetic economy"
  },
  chromejaw_run: {
    reward: "Rage/Fear from customs pressure",
    shifts: "Mnemonic up, Omni down",
    risks: "Bad roll spikes Compliance",
    helps: "Joy 3 bribe or Reflex makes this cleaner"
  },
  purity_cleanse: {
    reward: "Awe 4 or Grief 3",
    shifts: "Purity/Shadow/Grey fork",
    risks: "Augments anger Purity",
    unlocks: "Investigate can expose Kael"
  },
  droidboy_duel: {
    reward: "Rage 5 on win, Grief 4 on loss",
    shifts: "Mnemonic or Shadow/Grey",
    risks: "Rage 4 wager can be lost",
    helps: "Reflex improves the duel"
  },
  compliance_heist: {
    reward: "Multiple stolen high-clarity files",
    shifts: "Big Shadow gain, Omni crash",
    risks: "Major heat, vault burn is extreme",
    helps: "Fear 5 enables clean bluff"
  },
  droidboy_rankclimb: {
    reward: () => {
      const r = state.flags.droidBoyRank || 0;
      return r === 0 ? "Spend Rage 3, earn Rage 4"
           : r === 1 ? "Spend synthetic, may gain free Cloak"
           : "Spend Rage 5 or Awe 5 to become Captain";
    },
    shifts: "Chrome identity, Purity loss",
    risks: "Requires real memory costs",
    helps: "Builds toward Droid Boy Captain"
  },
  lattice_data_theft: {
    reward: "Awe 4 stolen datum",
    shifts: "Grey +3 if clean",
    risks: "Violence voids Lattice's contract",
    unlocks: "Clean run opens Omni Sabotage"
  },
  purity_spy_ring: {
    reward: "Awe 4 clean-read memory",
    shifts: "Purity +4 or Omni betrayal",
    risks: "No chrome allowed for clean path",
    helps: "Awe 3 required to identify the spy"
  },
  omni_sabotage: {
    reward: "Awe 5 refinery collapse",
    shifts: "Shadow surge, Omni -10",
    risks: "Needs unencrypted Omni PING or loud heat",
    helps: "Burns a backdoor into a victory"
  }
};

const CONTRACT_MODIFIERS = [
  {
    id: "omni_sweep",
    label: "OMNI SWEEP",
    chip: "MOD: +HEAT",
    text: "Omni sweep active. Compliance gain is higher today.",
    compliance: 6
  },
  {
    id: "rain_blackout",
    label: "RAIN BLACKOUT",
    chip: "MOD: LOW VIS",
    text: "Rain blackout. Heat drops, but memory decay risk rises tonight.",
    compliance: -4,
    flag: "rainBlackout"
  },
  {
    id: "mnemonic_buyer",
    label: "MNEMONIC BUYER",
    chip: "MOD: BUYER",
    text: "A Mnemonic buyer is waiting. Stolen memories gain extra market value.",
    flag: "mnemonicBuyer"
  },
  {
    id: "purity_informant",
    label: "PURITY INFORMANT",
    chip: "MOD: INFORMANT",
    text: "A Purity informant is nearby. Chrome use will sour the Temple faster.",
    flag: "purityInformant"
  }
];

function dailyContractModifier(contractId = "") {
  const idx = (state.day + contractId.length + state.runsCompleted) % CONTRACT_MODIFIERS.length;
  return CONTRACT_MODIFIERS[idx];
}

function openContractBoard() {
  state.location = "safehouse";
  processFollowUps();
  render();
  if (state.flags.boardLockedDay && state.flags.boardLockedDay >= state.day) {
    setScene({
      title: "// CONTRACT BOARD // LOCKED",
      body: [
        "The board is dark. Auditors have frozen grey-market postings.",
        "Sleep through the night. The board wakes when the heat drops."
      ],
      choices: [{ label: "Back", action: enterSafehouse }]
    });
    return;
  }
  const available = CONTRACTS.filter(c => c.gate());
  const locked = CONTRACTS.filter(c => !c.gate() && gateReason(c)).slice(0, 5);
  const todayMod = dailyContractModifier("board");
  setScene({
    title: "// CONTRACT BOARD",
    body: [
      `${available.length} posting${available.length === 1 ? "" : "s"} pulse on the grey-market board.`,
      `<span class="hint">${todayMod.label}: ${todayMod.text}</span>`,
      locked.length ? `<span class="hint">${locked.length} other posting${locked.length === 1 ? "" : "s"} are dim — unlock conditions listed below.</span>` : ''
    ].filter(Boolean),
    choices: [
      ...available.map(c => ({
        label: contractBoardLabel(c),
        tag: `C+${effectiveCompliance(c.compliance, c)}`,
        action: () => startContract(c)
      })),
      ...locked.map(c => ({
        label: contractBoardLabel(c, gateReason(c)),
        tag: "LOCKED",
        disabled: true,
        action: () => log(`// ${gateReason(c)}`, "warn")
      })),
      { label: "Back", action: enterSafehouse }
    ]
  });
}

function contractBoardLabel(c, lockReason = "") {
  const title = contractTitle(c);
  const mod = dailyContractModifier(c.id);
  const chips = contractIntel(c).map(i =>
    `<span class="intel-chip ${i.tone}">${escapeHtml(i.kind)}: ${escapeHtml(i.text)}</span>`
  ).join("");
  return `
    <span class="contract-title">${escapeHtml(title)} - ${escapeHtml(c.issuer)}</span>
    <span class="contract-brief">${escapeHtml(c.brief)}</span>
    ${lockReason ? `<span class="contract-lock">LOCKED: ${escapeHtml(lockReason)}</span>` : ""}
    <span class="contract-intel"><span class="intel-chip mod">${escapeHtml(mod.chip)}</span>${chips}</span>
  `;
}

function contractIntel(c) {
  const raw = CONTRACT_INTEL[c.id] || {};
  return [
    { key: "reward", kind: "MEM", tone: "reward" },
    { key: "shifts", kind: "REP", tone: "shift" },
    { key: "risks", kind: "RISK", tone: "risk" },
    { key: "helps", kind: "TOOLS", tone: "help" },
    { key: "unlocks", kind: "LEAD", tone: "unlock" }
  ].map(row => {
    const val = raw[row.key];
    const text = typeof val === "function" ? val() : val;
    return text ? { kind: row.kind, tone: row.tone, text } : null;
  }).filter(Boolean);
}

function gateReason(c) {
  switch (c.id) {
    case "drophouse_break":
    case "chromejaw_run":
    case "droidboy_rankclimb":
      if (state.flags.chromeWarActive && !state.flags.chromeWarResolved) return "chrome war active";
      if (c.id === "chromejaw_run") return "needs 1 run completed";
      return "";
    case "purity_cleanse": return "needs 2 runs completed";
    case "droidboy_duel": return "needs 3 runs completed";
    case "compliance_heist":
      if (state.runsCompleted < 4) return "needs 4 runs completed";
      if (state.reputation.shadow < 2) return "needs Shadow rep ≥ 2";
      return "";
    case "lattice_data_theft":
      if (!state.flags.latticeOffered) return "earn Grey trust ≥ 3 (Lattice hasn't offered yet)";
      if (state.flags.latticeCompleted) return "already completed";
      return "";
    case "purity_spy_ring":
      if (!state.flags.spyRingUnlocked) return "needs Lattice trust ≥ 3";
      if (state.flags.spyRingCompleted) return "already completed";
      return "";
    case "omni_sabotage":
      if (!state.flags.omniSabotageOffered) return "earn Shadow trust ≥ 5 or complete Lattice run";
      if (state.flags.omniSabotageCompleted) return "already completed";
      return "";
    default: return "";
  }
}

function processFollowUps() {
  const q = state.flags.followUps || [];
  if (!q.length) return;
  state.flags.followUps = [];
  for (const id of q) {
    if (id === "omni_sabotage_unlock" && !state.flags.omniSabotageOffered) {
      state.flags.omniSabotageOffered = true;
      log("// NEW CONTRACT: The Shadow wants an Omni refinery sabotaged.", "lore");
    }
  }
}

function effectiveCompliance(base, c = null) {
  let mult = 1;
  if (hasAug("cloak")) mult *= 0.75;
  if (state.flags.puritySanctum) mult *= 0.85;
  const mod = c ? dailyContractModifier(c.id) : null;
  const adjusted = Math.max(0, base + (mod?.compliance || 0));
  return Math.ceil(adjusted * mult);
}

let _runSnapshot = null;

function startContract(c) {
  const mod = dailyContractModifier(c.id);
  c = Object.assign({}, c, {
    modifier: mod,
    baseCompliance: c.compliance,
    compliance: Math.max(0, c.compliance + (mod.compliance || 0))
  });
  state.location = "run";
  playBGM("contract_tension.mp3");
  stopAmbient();  // no rain layer when you're out in the field
  const title = typeof c.title === "function" ? c.title() : c.title;
  _runSnapshot = snapshotRunState(c, title);
  recordConsequence("CONTRACT", `${title} started under ${mod.label}.`, "warn");
  log(`// CONTRACT START: ${title} // ${mod.label}`, "warn");
  ARCS[c.arc](c);
}

function snapshotRunState(c, title) {
  return {
    id: c.id,
    title,
    compliance: state.compliance,
    reputation: Object.assign({}, state.reputation),
    memoryIds: new Set(state.memories.map(m => m.id)),
    memories: state.memories.map(m => ({
      id: m.id,
      hook: m.hook,
      emotion: m.emotion,
      clarity: m.clarity,
      source: m.source,
      backdoor: !!m.backdoor,
      encrypted: !!m.encrypted,
      tags: (m.tags || []).slice()
    })),
    flags: snapshotReportFlags()
  };
}

function snapshotReportFlags() {
  const f = state.flags || {};
  return {
    latticeOffered: !!f.latticeOffered,
    latticeCompleted: !!f.latticeCompleted,
    spyRingUnlocked: !!f.spyRingUnlocked,
    spyRingCompleted: !!f.spyRingCompleted,
    omniSabotageOffered: !!f.omniSabotageOffered,
    omniSabotageCompleted: !!f.omniSabotageCompleted,
    kaelSuspect: !!f.kaelSuspect,
    endgameTriggered: !!f.endgameTriggered,
    starterSeen: !!f.starterSeen,
    chromeWarActive: !!f.chromeWarActive,
    chromeWarResolved: f.chromeWarResolved || null,
    droidBoyRank: f.droidBoyRank || 0,
    followUps: Array.isArray(f.followUps) ? f.followUps.slice() : []
  };
}

// ================================================================
// ==== ARCS ====
// Each contract has a single arc function keyed by id. Arcs own
// their scene tree and call endRun(c, text) to exit. Compliance
// gain flows through complianceTick so augments + sanctum modify it.
// ================================================================
const ARCS = {
  gutterSalvage(c) {
    setScene({
      portrait: "hound.jpg",
      title: "FLOODED TUNNEL // SUBLEVEL 3",
      body: [
        "Green pilot lights bounce off oily water. A memory core pings in an abandoned diagnostic cradle.",
        "You can hear scuttling. Maybe a rat. Maybe a Synth-Hound running cold."
      ],
      choices: [
        {
          label: "Wade straight to the core",
          action: () => {
            const m = randomMemory({ emotion: rand(["Fear", "Grief"]), clarity: 3 });
            addMemory(m);
            if (hasAug("ice")) {
              const bonus = randomMemory({ emotion: "Awe", clarity: 2 });
              bonus.hook = "A fragment of the tunnel's own memory of being built";
              addMemory(bonus);
              log("// ICE-PIERCER: bonus memory extracted.", "ok");
            }
            complianceTick(c.compliance);
            endRun(c, "You grab the core and slosh back out.");
          }
        },
        {
          label: "Tune The Sight and scan for echoes first",
          tag: "RESO",
          action: () => {
            state.sightActive = true;
            document.body.classList.add("sight-active");
            setTimeout(() => { state.sightActive = false; document.body.classList.remove("sight-active"); }, 3000);
            log("// Reso's overlay unfolds. Hidden echoes bleed through the walls.", "lore");
            const echo = randomMemory({ emotion: "Awe", clarity: 4 });
            echo.hook = "An echo of a drowned technician — their last morning";
            addMemory(echo);
            const m = randomMemory({ emotion: "Fear", clarity: 3 });
            addMemory(m);
            complianceTick(c.compliance + 2);
            endRun(c, "The tunnel remembers you back. You surface shaking.");
          }
        },
        {
          label: "Retreat — something is down here with you",
          tag: "SAFE",
          action: () => {
            log("// Contract aborted. No payout.", "warn");
            enterSafehouse();
          }
        }
      ]
    });
  },

  corporateCourier(c) {
    setScene({
      portrait: "auditor.jpg",
      faction: "omni",
      title: "ARCOLOGY PLAZA // TIER 4",
      body: [
        "Glass towers reflect your face badly. Corp-Sec drones trace lazy figure-eights overhead.",
        "The packet is warm against your ribs. It should not be warm."
      ],
      choices: [
        {
          label: "Walk it clean and cash out",
          action: () => {
            const m = randomMemory({ emotion: "Joy", clarity: 4 });
            m.hook = "A sanctioned bonus — the taste of complicity";
            m.backdoor = true;
            addMemory(m);
            state.reputation.omni += 1;
            complianceTick(c.compliance);
            log("// Omni-Corp ping installed on your latest memory.", "bad");
            endRun(c, "Payment cleared. You feel briefly, unsettlingly good.");
          }
        },
        {
          label: "Peek inside the packet",
          tag: "RISK",
          risk: true,
          action: () => {
            log("// You crack the seal. Hot white noise. Something looks back.", "bad");
            const synth = randomMemory({ emotion: "Awe", clarity: 5, source: "Synthetic" });
            synth.hook = "A minute from someone who does not exist yet";
            addMemory(synth);
            complianceTick(c.compliance + 10);
            state.reputation.grey += 1;
            state.reputation.omni -= 2;
            endRun(c, "You reseal it with trembling hands. Lattice flagged the bleed.");
          }
        },
        {
          label: "Hand it to The Shadow instead",
          tag: "LORE",
          action: () => {
            state.reputation.shadow += 2;
            state.reputation.omni -= 3;
            log("// The Shadow accepts the packet. Omni-Corp will not forget.", "lore");
            complianceTick(c.compliance + 15);
            const m = randomMemory({ emotion: "Rage", clarity: 4 });
            m.hook = "Handing the packet to a nameless archivist";
            addMemory(m);
            endRun(c, "No pay. No regret. The Shadow owes you.");
          }
        }
      ]
    });
  },

  drophouse(c) {
    setScene({
      portrait: "vex.jpg",
      faction: "chromejaw",
      title: "CHROME-JAW DROPHOUSE // 2 A.M.",
      body: [
        "Monowire humming somewhere down the hallway. The target — a fixer named Vex — is unconscious in a chair.",
        "The Mnemonic extractor clamps cold to his temple."
      ],
      choices: [
        {
          label: "Pull only what the contract named",
          action: () => {
            const m = randomMemory({ emotion: "Rage", clarity: 4, source: "Stolen" });
            m.hook = "Vex watching his sister walk into Compliance";
            addMemory(m);
            state.reputation.mnemonic += 2;
            complianceTick(c.compliance);
            endRun(c, "Clean pull. Vex won't remember you or his sister.");
          }
        },
        {
          label: "Strip him for everything — sell wide",
          tag: "GREEDY",
          risk: true,
          action: () => {
            const a = randomMemory({ emotion: "Rage",  clarity: 4, source: "Stolen" });
            const b = randomMemory({ emotion: "Grief", clarity: 3, source: "Stolen" });
            const cM = randomMemory({ emotion: "Joy",   clarity: 2, source: "Stolen" });
            [a, b, cM].forEach(addMemory);
            state.reputation.mnemonic += 1;
            state.reputation.shadow -= 1;
            complianceTick(c.compliance + 15);
            endRun(c, "You left him hollow. You'll dream this next week.");
          }
        },
        {
          label: "Wake him. Offer a deal.",
          tag: "MERCY",
          action: () => {
            state.reputation.mnemonic -= 1;
            state.reputation.shadow += 1;
            log("// Vex owes you now. Mnemonic will hear.", "lore");
            complianceTick(c.compliance + 5);
            endRun(c, "You walk out with nothing in the stack and something in your spine.");
          }
        }
      ]
    });
  },

  chromejawRun(c) {
    setScene({
      portrait: "duchess_rend.jpg",
      faction: "chromejaw",
      title: "CHROME-JAW SMUGGLE // TIER 2 CUSTOMS",
      body: [
        "The crate hums with unlicensed monowire — Duchess Rend's personal pattern.",
        "A customs scanner blinks amber. A bored inspector looks up, then back down."
      ],
      choices: [
        {
          label: "Roll with the Chrome-Jaw pattern — confidence play",
          action: () => {
            const rollOk = hasAug("reflex") || Math.random() > 0.4;
            if (rollOk) {
              const m = randomMemory({ emotion: "Rage", clarity: 4 });
              m.hook = "Walking past a Corp-Sec scanner with a monowire in your coat";
              addMemory(m);
              state.reputation.mnemonic += 1;
              state.reputation.omni -= 1;
              complianceTick(c.compliance);
              if (hasAug("reflex")) log("// REFLEX engaged. Inspector looked away at the right second.", "ok");
              endRun(c, "You walk through like you own the air.");
            } else {
              log("// Inspector froze. Alarms. You cut and run.", "bad");
              complianceTick(c.compliance + 25);
              const m = randomMemory({ emotion: "Fear", clarity: 4 });
              m.hook = "Running with a hot crate through Tier-2 arcade light";
              addMemory(m);
              endRun(c, "You escaped. Barely. The heat follows you home.");
            }
          }
        },
        {
          label: "Bribe the inspector — requires Joy·3",
          tag: "JOY",
          action: () => {
            const bribe = state.memories.find(m => !m.encrypted && m.emotion === "Joy" && m.clarity >= 3);
            if (!bribe) {
              log("// No Joy·3 memory to offer. Choose another approach.", "warn");
              return;
            }
            removeMemory(bribe.id);
            log(`// Bribed with "${bribe.hook}". The inspector smiles like a child.`, "ok");
            const m = randomMemory({ emotion: "Rage", clarity: 3 });
            addMemory(m);
            complianceTick(Math.ceil(c.compliance / 2));
            state.reputation.mnemonic += 2;
            endRun(c, "Clean pass. The inspector will remember the sunrise you gave him.");
          }
        },
        {
          label: "Dump the crate in the canal",
          tag: "ETHICS",
          action: () => {
            state.reputation.shadow += 1;
            state.reputation.mnemonic -= 3;
            log("// You dumped a Chrome-Jaw crate. Duchess Rend will hear.", "bad");
            complianceTick(4);
            endRun(c, "The canal swallows it. You walk away lighter and more haunted.");
          }
        }
      ]
    });
  },

  purityCleanse(c) {
    setScene({
      title: "PURITY CLEANSE // BRIGHTLINE CLINIC",
      body: [
        "A Chrome clinic, after hours. Cherubic holograms blink over empty surgical chairs.",
        "Prophet Kael's followers asked you to burn it clean. 'The Body is Sacred,' they whispered."
      ],
      choices: [
        {
          label: "Burn it — torch the chrome",
          action: () => {
            state.reputation.purity += 3;
            state.reputation.mnemonic -= 1;
            // Purity expects no augment use, penalizes if any installed
            if (state.augments.length > 0) {
              log("// Purity notices your chrome. Some of their trust burns with the clinic.", "warn");
              state.reputation.purity -= 2;
            }
            const m = randomMemory({ emotion: "Awe", clarity: 4 });
            m.hook = "Chrome melting like snow under your lighter";
            addMemory(m);
            complianceTick(c.compliance);
            endRun(c, "The fire looks almost holy.");
          }
        },
        {
          label: "Spare the clinic — tip off the doctors",
          tag: "MERCY",
          action: () => {
            state.reputation.purity -= 3;
            state.reputation.shadow += 2;
            log("// Purity will consider you a liar. Someone else will burn this place.", "warn");
            const m = randomMemory({ emotion: "Grief", clarity: 3 });
            m.hook = "A Ripperdoc's hands shaking as she packed her tools";
            addMemory(m);
            complianceTick(Math.ceil(c.compliance / 2));
            endRun(c, "You chose the quiet route. It cost you the Prophet.");
          }
        },
        {
          label: "Ask Kael why — dig for his secret",
          tag: "INVESTIGATE",
          action: () => {
            state.flags.kaelSuspect = true;
            state.reputation.purity -= 1;
            state.reputation.grey += 2;
            log("// Lattice pings you. 'Prophet Kael is 34% chrome beneath the skin.' You pocket the fact.", "lore");
            const m = randomMemory({ emotion: "Awe", clarity: 4 });
            m.hook = "Kael's sermon playing while your brain lists his hidden augments";
            addMemory(m);
            complianceTick(c.compliance);
            endRun(c, "You didn't burn anything. You kept a blade for later.");
          }
        }
      ]
    });
  },

  complianceHeist(c) {
    setScene({
      portrait: "compliance_vault.jpg",
      faction: "omni",
      title: "// COMPLIANCE VAULT // TIER-3 SUBLEVEL",
      body: [
        "The Shadow passed you a cracked badge and a five-minute window. Past the glass wall: the memory vault — forty years of Clarity-session confessions, filed by zip code.",
        "Two Auditors inside. One is humming. The other is not."
      ],
      choices: [
        {
          label: "Smash-and-grab — take three files and run",
          tag: "HEIST",
          risk: true,
          action: () => {
            const a = randomMemory({ emotion: "Grief", clarity: 4, source: "Stolen" });
            a.hook = "A father's last apology, scrubbed from the record";
            const b = randomMemory({ emotion: "Rage", clarity: 4, source: "Stolen" });
            b.hook = "A protest chant the Board of Nine deleted in real time";
            const d = randomMemory({ emotion: "Awe", clarity: 3, source: "Stolen" });
            d.hook = "A lullaby no living parent remembers singing";
            [a, b, d].forEach(addMemory);
            state.reputation.shadow += 3;
            state.reputation.omni -= 5;
            complianceTick(c.compliance);
            endRun(c, "You walked out with other people's truths in your jacket. The Shadow will cry when they read them.");
          }
        },
        {
          label: "Bluff as an Auditor — requires Fear·5 memory",
          tag: "CONFIDENCE",
          action: () => {
            const costume = state.memories.find(m => !m.encrypted && m.emotion === "Fear" && m.clarity >= 5);
            if (!costume) {
              log("// No Fear·5 memory to wear as confidence. They smell you before you smile.", "warn");
              return;
            }
            removeMemory(costume.id);
            log(`// You wore "${costume.hook}" like a uniform. They nodded you through.`, "ok");
            const gift = randomMemory({ emotion: "Awe", clarity: 5, source: "Synthetic" });
            gift.hook = "An entire afternoon, untouched — someone else's clean Tuesday";
            addMemory(gift);
            state.reputation.shadow += 1;
            state.reputation.omni -= 1;
            complianceTick(Math.ceil(c.compliance / 2));
            endRun(c, "Clean walk. You'll dream their briefings for a week.");
          }
        },
        {
          label: "Burn the vault — no payout, no forgiveness",
          tag: "TORCH",
          risk: true,
          action: () => {
            state.reputation.omni = -10;
            state.reputation.shadow += 4;
            state.reputation.grey += 2;
            complianceTick(c.compliance + 20);
            const scar = randomMemory({ emotion: "Rage", clarity: 5 });
            scar.hook = "Forty years of other people's confessions catching fire";
            addMemory(scar);
            log("// The vault dies as you watch. Omni will never forgive you. Nobody else ever will either.", "lore");
            endRun(c, "You left the city lighter and marked.");
          }
        },
        {
          label: "Abort — pull out, no contract",
          tag: "SAFE",
          action: () => {
            log("// You walked away. The Shadow is disappointed.", "warn");
            state.reputation.shadow -= 1;
            enterSafehouse();
          }
        }
      ]
    });
  },

  droidBoyRankClimb(c) {
    const rank = state.flags.droidBoyRank || 0;
    if (rank === 0) {
      // Stage 1 — Initiate
      setScene({
        portrait: "circuit_shaman.jpg",
        title: "// DROID BOY INITIATE // 41% CHROME BAR",
        body: [
          "The bouncer at the door is 41% chrome. He checks your arm, snorts. 'Flesh walks in at the bottom.'",
          "You're asked to prove you have rage worth rewarding. Wager a Rage memory to the pit."
        ],
        choices: [
          {
            label: "Wager Rage·3+ — spar the initiate",
            tag: "RAGE",
            action: () => {
              const bet = state.memories.find(m => !m.encrypted && m.emotion === "Rage" && m.clarity >= 3);
              if (!bet) { log("// No Rage·3+ memory to offer. The bouncer laughs.", "warn"); return; }
              removeMemory(bet.id);
              state.flags.droidBoyRank = 1;
              log("// Rank raised. You are now DROID BOY 17%.", "ok");
              const m = randomMemory({ emotion: "Rage", clarity: 4 });
              m.hook = "The scrap of your first Droid Boy punch";
              addMemory(m);
              complianceTick(c.compliance);
              endRun(c, "You climbed the ladder a rung. Come back to keep climbing.");
            }
          },
          {
            label: "Refuse the climb",
            tag: "OUT",
            action: () => {
              log("// Not for you. Not today.", "warn");
              enterSafehouse();
            }
          }
        ]
      });
    } else if (rank === 1) {
      // Stage 2 — Mid-tier: install or earn chrome
      setScene({
        portrait: "duchess_rend.jpg",
        faction: "chromejaw",
        title: "// DROID BOY MID // THE WELDING ROOM",
        body: [
          "A back room with a chair bolted to the floor. Rank 2 means you wear some of the machine.",
          "You can install an augment on the house — or spend a synthetic memory as proof you've consumed chrome."
        ],
        choices: [
          {
            label: "Install an augment here — pay a synthetic memory",
            tag: "CHROME",
            action: () => {
              const synth = state.memories.find(m => !m.encrypted && m.synthetic);
              if (!synth) { log("// No synthetic memory to sacrifice. Buy a copy at Mnemonic first.", "warn"); return; }
              removeMemory(synth.id);
              state.flags.droidBoyRank = 2;
              log("// Rank raised. You are now DROID BOY 49%.", "ok");
              if (!hasAug("cloak")) {
                state.augments.push("cloak");
                log("// Free CLOAK installed as Droid-Boy welcome gift.", "ok");
              }
              state.reputation.purity -= 2;
              complianceTick(c.compliance);
              endRun(c, "Something under your skin hums now. You are more, and less.");
            }
          },
          {
            label: "Back down — stay at 17%",
            action: () => {
              log("// You keep your flesh. The Droid Boys note the retreat.", "warn");
              enterSafehouse();
            }
          }
        ]
      });
    } else if (rank === 2) {
      // Stage 3 — Captain's challenge
      setScene({
        portrait: "circuit_shaman.jpg",
        title: "// DROID BOY CAPTAIN TRIAL // ROOFTOP",
        body: [
          "The current Captain is 82% machine. Rain hits her plating like static on a radio.",
          "Rank 3 is hers to give. She wants a duel or a memory she cannot match."
        ],
        choices: [
          {
            label: "Duel — requires Reflex or Rage·5",
            tag: "FIGHT",
            action: () => {
              const rage5 = state.memories.find(m => !m.encrypted && m.emotion === "Rage" && m.clarity >= 5);
              const canFight = hasAug("reflex") || !!rage5;
              if (!canFight) { log("// She disarms you in 0.4 seconds. Try another way.", "bad"); return; }
              if (rage5) removeMemory(rage5.id);
              state.flags.droidBoyRank = 3;
              log("// YOU ARE THE CAPTAIN. 71% chrome by her pronouncement.", "ok");
              state.reputation.mnemonic += 3;
              state.reputation.omni -= 3;
              complianceTick(c.compliance + 10);
              endRun(c, "The old Captain bows. The crew pours you synthetic rain.");
            }
          },
          {
            label: "Offer a memory she cannot match — Awe·5",
            tag: "AWE",
            action: () => {
              const awe5 = state.memories.find(m => !m.encrypted && m.emotion === "Awe" && m.clarity >= 5);
              if (!awe5) { log("// No Awe·5 in your stack. She looks disappointed.", "warn"); return; }
              removeMemory(awe5.id);
              state.flags.droidBoyRank = 3;
              log("// She reads the memory and weeps oil. 'That's enough. You're the Captain.'", "lore");
              state.reputation.shadow += 2;
              state.reputation.grey += 1;
              complianceTick(Math.ceil(c.compliance / 2));
              endRun(c, "You climbed with a ghost instead of a fist.");
            }
          },
          {
            label: "Decline the throne",
            action: () => {
              log("// She respects the refusal. The crew does not.", "warn");
              enterSafehouse();
            }
          }
        ]
      });
    } else {
      // Already Captain
      setScene({
        title: "// DROID BOY CAPTAIN // NO MORE RUNGS",
        body: ["You are the Captain. There is no rank above you — only the grief of anyone who tries to climb."],
        choices: [{ label: "Return to safehouse", action: enterSafehouse }]
      });
    }
  },

  droidBoyDuel(c) {
    setScene({
      portrait: "circuit_shaman.jpg",
      title: "DROID-BOY DUEL // SCRAP ARENA",
      body: [
        "A Droid Boy captain — 71% machine — stands across a pit of industrial slag.",
        "Rank is chrome. He wants yours. Yours is, technically, a mood."
      ],
      choices: [
        {
          label: "Duel with Rage·4+ — bet a memory",
          tag: "RAGE",
          action: () => {
            const bet = state.memories.find(m => !m.encrypted && m.emotion === "Rage" && m.clarity >= 4);
            if (!bet) {
              log("// No Rage·4+ memory to wager. The captain laughs.", "warn");
              return;
            }
            removeMemory(bet.id);
            const win = hasAug("reflex") || Math.random() > 0.35;
            if (win) {
              log(`// You paid "${bet.hook}" into the arena. You won.`, "ok");
              const m = randomMemory({ emotion: "Rage", clarity: 5 });
              m.hook = "The crunch of chrome fingers giving way";
              addMemory(m);
              state.reputation.mnemonic += 1;
              state.reputation.omni -= 1;
              complianceTick(c.compliance);
              endRun(c, "The captain's internal fans whine. He bows. You walked out taller.");
            } else {
              log("// You lost. He took the memory and a tooth.", "bad");
              complianceTick(c.compliance + 10);
              const m = randomMemory({ emotion: "Grief", clarity: 4 });
              m.hook = "Tasting copper in an arena full of cheering machines";
              addMemory(m);
              endRun(c, "You walked out shorter, emptier. The Droid Boys still know your name.");
            }
          }
        },
        {
          label: "Refuse the duel — talk him down",
          tag: "AWE·3",
          action: () => {
            const awe = state.memories.find(m => !m.encrypted && m.emotion === "Awe" && m.clarity >= 3);
            if (!awe) {
              log("// No Awe·3 memory to share. He expected nothing, got nothing.", "warn");
              return;
            }
            removeMemory(awe.id);
            log(`// You shared "${awe.hook}" with him instead. His chrome shoulders drop.`, "lore");
            state.reputation.shadow += 2;
            state.reputation.grey += 1;
            complianceTick(2);
            endRun(c, "He lets you walk. You left him a memory too big for his rank.");
          }
        },
        {
          label: "Walk away",
          action: () => {
            state.reputation.mnemonic -= 1;
            log("// The captain spits. Droid Boys will remember.", "warn");
            enterSafehouse();
          }
        }
      ]
    });
  },

  latticeDataTheft(c) {
    setScene({
      portrait: "lattice.jpg",
      faction: "grey",
      title: "// LATTICE QUIET LINE // COLD DATUM",
      body: [
        "Lattice's voice is thinner than usual, as if routed through too many floors.",
        "'I need a datum Omni Compliance keeps in a ledger they pretend does not exist. Do not let them see the hand that takes it. If anyone dies, I void the contract.'"
      ],
      choices: [
        {
          label: "Slip in clean — bluff past the ledger clerk",
          tag: "QUIET",
          action: () => {
            const m = randomMemory({ emotion: "Awe", clarity: 4, source: "Stolen" });
            m.hook = "A column of names Omni claims no memory of";
            addMemory(m);
            state.reputation.grey += 3;
            state.reputation.omni -= 2;
            complianceTick(c.compliance);
            state.flags.latticeCompleted = true;
            state.flags.followUps = state.flags.followUps || [];
            state.flags.followUps.push("omni_sabotage_unlock");
            log("// Lattice logs your hand as nameless. Your rep climbs quietly.", "ok");
            endRun(c, "No alarms. No bodies. Lattice is pleased.");
          }
        },
        {
          label: "Torch the ledger — louder, colder",
          tag: "BURN",
          risk: true,
          action: () => {
            log("// A clerk sees you. Your hand shakes. The ledger dies anyway.", "bad");
            state.reputation.grey -= 2;
            state.reputation.shadow += 2;
            state.reputation.omni -= 4;
            complianceTick(c.compliance + 12);
            const scar = randomMemory({ emotion: "Rage", clarity: 5 });
            scar.hook = "A clerk's last sentence, cut off by smoke";
            addMemory(scar);
            state.flags.latticeCompleted = true;
            log("// Lattice voids the contract. 'I told you no bodies.' The line goes quiet.", "warn");
            endRun(c, "You made it out. Grey Freq goes dark for a cycle.");
          }
        },
        {
          label: "Abort — Lattice is watching",
          tag: "SAFE",
          action: () => {
            log("// You left the datum. Lattice says nothing. That is its own answer.", "warn");
            state.reputation.grey -= 1;
            enterSafehouse();
          }
        }
      ]
    });
  },

  puritySpyRing(c) {
    setScene({
      portrait: "kael.jpg",
      faction: "purity",
      title: "// COUNCIL SPY RING // GUTTER-9 HALL",
      body: [
        "Three councillors. One of them wears a seam above the ear like Kael does.",
        "Prophet Kael's brief: identify the spy. No chrome on this run. No augments allowed."
      ],
      choices: [
        {
          label: "Run it clean — Awe·3 cold-read, no chrome",
          tag: "FLESH",
          action: () => {
            if (state.augments.length > 0) {
              log("// You are wearing machine. The council smells it. Spy walks free.", "bad");
              state.reputation.purity -= 3;
              enterSafehouse();
              return;
            }
            const tell = state.memories.find(m => !m.encrypted && m.emotion === "Awe" && m.clarity >= 3);
            if (!tell) { log("// No Awe·3 memory to read the room with. Cold leaves cold.", "warn"); return; }
            removeMemory(tell.id);
            state.reputation.purity += 4;
            state.reputation.shadow += 1;
            complianceTick(c.compliance);
            state.flags.spyRingCompleted = true;
            const m = randomMemory({ emotion: "Awe", clarity: 4 });
            m.hook = "A councillor's micro-flinch as their name was spoken";
            addMemory(m);
            log("// You named the spy. Kael kneels in gratitude.", "ok");
            endRun(c, "The council strips the spy's robes in the street. You walk home clean.");
          }
        },
        {
          label: "Feed the spy a fake name — sell Purity out to Omni",
          tag: "BETRAY",
          risk: true,
          action: () => {
            state.reputation.purity = -6;
            state.reputation.omni += 3;
            complianceTick(c.compliance + 8);
            const m = randomMemory({ emotion: "Grief", clarity: 5, source: "Stolen" });
            m.hook = "An innocent councillor being dragged out at dawn";
            addMemory(m);
            state.flags.spyRingCompleted = true;
            log("// You named the wrong one. Omni pays. Purity will know.", "bad");
            endRun(c, "You cashed in belief for clearance. It cost.");
          }
        },
        {
          label: "Walk — this is not your temple",
          action: () => {
            state.reputation.purity -= 2;
            log("// You left the council humming. Kael takes it as refusal.", "warn");
            enterSafehouse();
          }
        }
      ]
    });
  },

  omniSabotage(c) {
    const hasPinged = state.memories.some(m => !m.encrypted && m.backdoor);
    setScene({
      portrait: "compliance_vault.jpg",
      faction: "shadow",
      title: "// OMNI SABOTAGE // MEMORY REFINERY 7",
      body: [
        "The Shadow handed you a ghost-loop — a self-eating memory designed to chew through an Omni refinery's catalog.",
        "To plant it, you need an Omni-PING backdoor to open the door from the inside.",
        hasPinged ? '<span class="hint">A pinged memory in your stack will do the job.</span>' : '<span class="glitch">You have no pinged memory. This run needs an Omni backdoor.</span>'
      ].filter(Boolean),
      choices: [
        {
          label: "Burn a pinged memory as your key",
          tag: "SACRIFICE",
          action: () => {
            const ping = state.memories.find(m => !m.encrypted && m.backdoor);
            if (!ping) { log("// No pinged memory. Door stays shut.", "warn"); return; }
            removeMemory(ping.id);
            state.reputation.shadow += 4;
            state.reputation.omni = -10;
            state.reputation.grey += 2;
            complianceTick(c.compliance);
            state.flags.omniSabotageCompleted = true;
            const m = randomMemory({ emotion: "Awe", clarity: 5 });
            m.hook = "A refinery's catalog eating itself in fluorescent silence";
            addMemory(m);
            log(`// You burned "${ping.hook}" as your key. The refinery is a corpse.`, "lore");
            playSFX("sfx_project_sting.mp3", 0.7);
            endRun(c, "The Shadow will tell this story for a decade. Omni will hunt you for two.");
          }
        },
        {
          label: "Force the door — no key, just noise",
          tag: "LOUD",
          risk: true,
          action: () => {
            state.reputation.shadow += 1;
            state.reputation.omni -= 3;
            complianceTick(c.compliance + 20);
            state.flags.omniSabotageCompleted = true;
            const scar = randomMemory({ emotion: "Rage", clarity: 4 });
            scar.hook = "The refinery door buckling inward under pure noise";
            addMemory(scar);
            log("// You kicked the door in. The loop seeded, but you're bleeding heat.", "warn");
            endRun(c, "The refinery is half-dead. Enforcement is a day behind you.");
          }
        },
        {
          label: "Abort — not yet",
          action: () => {
            log("// You walked. The Shadow keeps the loop for another runner.", "warn");
            enterSafehouse();
          }
        }
      ]
    });
  }
};

function endRun(c, text) {
  const report = buildRunReport(_runSnapshot, c);
  _runSnapshot = null;
  state.runsCompleted += 1;
  trackStat("contracts", 1);
  state.flags.tutorialStep = Math.max(state.flags.tutorialStep || 0, 1);
  pushRunHistory(report, c);
  log("// CONTRACT END.", "ok");
  recordConsequence("RUN REPORT", `${report.title}: ${memoryDeltaText(report.gained, report.lost)} Compliance ${complianceReportText(report.complianceDelta, report.complianceNow).split(".")[0]}.`, "ok");
  setScene({
    title: "// EXFILTRATION // RUN REPORT",
    body: [
      text,
      renderRunReport(report),
      "You return to the safehouse as the rain gets louder."
    ],
    choices: [{ label: "Return to safehouse", action: enterSafehouse }]
  });
}

function pushRunHistory(report, c) {
  state.flags.runHistory = state.flags.runHistory || [];
  state.flags.runHistory.unshift({
    day: state.day,
    title: report.title,
    modifier: c?.modifier?.label || null,
    gained: report.gained.length,
    lost: report.lost.length,
    complianceDelta: report.complianceDelta,
    complianceNow: report.complianceNow,
    rep: report.repDelta.map(r => `${r.label} ${r.delta > 0 ? "+" : ""}${r.delta}`)
  });
  state.flags.runHistory = state.flags.runHistory.slice(0, 25);
}

function buildRunReport(before, c) {
  const prior = before || snapshotRunState(c, contractTitle(c));
  const beforeIds = prior.memoryIds || new Set();
  const afterIds = new Set(state.memories.map(m => m.id));
  const gained = state.memories.filter(m => !beforeIds.has(m.id));
  const lost = prior.memories.filter(m => !afterIds.has(m.id));
  const repDelta = FACTIONS.map(f => {
    const prev = prior.reputation[f.key] || 0;
    const now = state.reputation[f.key] || 0;
    return { label: f.label, delta: now - prev, now };
  }).filter(r => r.delta !== 0);
  const complianceDelta = state.compliance - prior.compliance;
  const unlocks = reportUnlocks(prior.flags, snapshotReportFlags());
  const next = nextRunRecommendation();
  return {
    title: prior.title || contractTitle(c),
    gained,
    lost,
    repDelta,
    complianceDelta,
    complianceNow: state.compliance,
    unlocks,
    next
  };
}

function renderRunReport(report) {
  const rows = [];
  rows.push(reportRow("MEMORIES", memoryDeltaText(report.gained, report.lost), report.lost.length ? "warn" : ""));
  rows.push(reportRow("COMPLIANCE", complianceReportText(report.complianceDelta, report.complianceNow), report.complianceNow >= 70 ? "bad" : report.complianceDelta > 0 ? "warn" : ""));
  rows.push(reportRow("STANDING", repDeltaText(report.repDelta), ""));
  if (report.unlocks.length) rows.push(reportRow("NEW LEADS", report.unlocks.join(" | "), "warn"));
  rows.push(reportRow("NEXT MOVE", report.next, ""));
  return `<span class="run-report">${rows.join("")}</span>`;
}

function reportRow(label, text, tone = "") {
  return `
    <span class="report-row ${tone}">
      <span class="report-label">${escapeHtml(label)}</span>
      <span class="report-text">${escapeHtml(text)}</span>
    </span>
  `;
}

function memoryDeltaText(gained, lost) {
  const parts = [];
  if (gained.length) parts.push(`+${gained.length}: ${gained.slice(0, 3).map(memorySummary).join("; ")}${gained.length > 3 ? "; ..." : ""}`);
  if (lost.length) parts.push(`-${lost.length}: ${lost.slice(0, 3).map(memorySummary).join("; ")}${lost.length > 3 ? "; ..." : ""}`);
  return parts.length ? parts.join(" / ") : "No memory stack change.";
}

function memorySummary(m) {
  const flags = [m.emotion, String(m.clarity), m.source];
  if (m.backdoor) flags.push("PING");
  if (m.encrypted) flags.push("encrypted");
  return `${shortHook(m.hook, 34)} [${flags.join(" ")}]`;
}

function complianceReportText(delta, now) {
  const d = delta > 0 ? `+${delta}` : String(delta);
  const tier = computeAuditTier(now);
  const suffix = tier === 0 ? "No audit tier." : tier === 1 ? "Watcher threshold crossed." : tier === 2 ? "Auditor danger." : "Enforcement danger.";
  return `${d}% this run, now ${now}%. ${suffix}`;
}

function repDeltaText(rows) {
  if (!rows.length) return "No faction standing changed.";
  return rows.map(r => `${r.label} ${r.delta > 0 ? "+" : ""}${r.delta} (${r.now > 0 ? "+" : ""}${r.now})`).join(" | ");
}

function reportUnlocks(before, after) {
  const out = [];
  if (!before.latticeOffered && after.latticeOffered) out.push("Lattice quiet line opened");
  if (!before.latticeCompleted && after.latticeCompleted) out.push("Lattice job completed");
  if (!before.spyRingUnlocked && after.spyRingUnlocked) out.push("Council Spy Ring unlocked");
  if (!before.spyRingCompleted && after.spyRingCompleted) out.push("Council Spy Ring resolved");
  if (!before.omniSabotageOffered && after.omniSabotageOffered) out.push("Omni Sabotage opened");
  if (!before.omniSabotageCompleted && after.omniSabotageCompleted) out.push("Omni Sabotage resolved");
  if (!before.kaelSuspect && after.kaelSuspect) out.push("Kael exposure lead acquired");
  if (!before.chromeWarActive && after.chromeWarActive) out.push("Chrome-Jaws war started");
  if (before.chromeWarResolved !== after.chromeWarResolved && after.chromeWarResolved) out.push(`Chrome-Jaws war resolved: ${after.chromeWarResolved}`);
  if ((after.droidBoyRank || 0) > (before.droidBoyRank || 0)) out.push(`Droid Boy rank ${after.droidBoyRank}`);
  const newFollowUps = (after.followUps || []).filter(id => !(before.followUps || []).includes(id));
  if (newFollowUps.includes("omni_sabotage_unlock")) out.push("Shadow refinery lead queued");
  return out;
}

function nextRunRecommendation() {
  const leads = caseBoardLeads();
  if (leads.length) return `${leads[0].kind}: ${leads[0].text}`;
  if (state.memories.length >= state.capacity) return "Burn, sell, or donate a memory before the stack overflows.";
  return "Check the contract board for the cleanest next lead.";
}

// ================================================================
// ==== COMPLIANCE + AUDIT ====
// ================================================================
// Audit escalation tiers:
//   Tier 1 (WATCHER, >=40%)   — flags stack. Single memory stripped on sleep.
//   Tier 2 (AUDITOR, >=70%)   — strips two memories on sleep; contract board
//                                locked on the following day.
//   Tier 3 (ENFORCEMENT, >=90%) — half the stack, compliance rebound only 25,
//                                  and all vendor trust takes a hit.
// Target priority (highest-priority victims first):
//   1. Memories with Omni PING (backdoor) — Omni hunts its own.
//   2. Stolen memories (flagged as illicit).
//   3. Highest-Clarity memory.
function complianceTick(amount) {
  let mult = 1;
  if (hasAug("cloak")) mult *= 0.75;
  if (state.flags.puritySanctum) mult *= 0.85;
  const adj = Math.ceil(amount * mult);
  const prev = state.compliance;
  state.compliance = Math.min(100, state.compliance + adj);
  trackStat("highestCompliance", state.compliance, "max");
  if (adj > 0) recordConsequence("HEAT", `Compliance +${adj}; now ${state.compliance}%.`, state.compliance >= 70 ? "bad" : "warn");

  const prevTier = state.auditTier || 0;
  const newTier = computeAuditTier(state.compliance);
  if (newTier > prevTier) {
    state.auditTier = newTier;
    state.auditPending = newTier >= 1;
    sensoryFlash("audit");
    if (newTier === 1) log("// COMPLIANCE WATCHER dispatched. Low-level surveillance is on you.", "warn");
    else if (newTier === 2) { log("// COMPLIANCE AUDITOR dispatched. Sleep and they will strike.", "bad"); playSFX("sfx_audit_alarm.mp3", 0.75); }
    else if (newTier === 3) { log("// COMPLIANCE ENFORCEMENT engaged. This is not a drill.", "bad"); playSFX("sfx_audit_alarm.mp3", 1.0); }
  }
  render();
}

function computeAuditTier(c) {
  if (c >= 90) return 3;
  if (c >= 70) return 2;
  if (c >= 40) return 1;
  return 0;
}

// ================================================================
// ==== THE SIGHT ====
// Reso's pirate overlay. Toggle on to reveal echoes in certain
// scenes. Stays on until toggled off or the sleep tax triggers.
// ================================================================
// When toggled on, document.body gets .sight-active (existing CSS animates it),
// some scene variants reveal hidden echoes, and the next sleep consumes one
// meditate slot — Sight stays on until the player turns it off or runs out of
// meditate slots. Reso's Sight is about attention, so keeping it on costs
// something.
function toggleSightMode() {
  state.sightToggled = !state.sightToggled;
  document.body.classList.toggle("sight-active", !!state.sightToggled);
  if (state.sightToggled) log("// Reso's overlay locked on. Hidden echoes will bleed through.", "lore");
  else log("// You let the overlay fall.", "warn");
  refreshSightButton();
}
function refreshSightButton() {
  const b = document.getElementById("btn-sight");
  if (!b) return;
  b.classList.toggle("active", !!state.sightToggled);
}
function sightOn() { return !!state.sightToggled || !!state.sightActive; }

// Order unencrypted memories by audit priority (highest-priority first)
function auditPriority(memories) {
  return memories.slice().sort((a, b) => {
    const aP = (a.backdoor ? 100 : 0) + (a.source === "Stolen" ? 30 : 0) + a.clarity;
    const bP = (b.backdoor ? 100 : 0) + (b.source === "Stolen" ? 30 : 0) + b.clarity;
    return bP - aP;
  });
}

function runAuditIfDue() {
  if (!state.auditPending) return false;
  const tier = state.auditTier || 1;
  glitchScene();
  sensoryFlash("audit");
  trackStat("audits", 1);
  recordConsequence("AUDIT", `Tier ${tier} audit arrived.`, "bad");
  playSFX("sfx_audit_alarm.mp3", 0.8);
  log(`// AUDIT TIER ${tier} — the ${["Watcher","Auditor","Enforcement squad"][tier-1] || "Auditor"} has arrived.`, "bad");

  // Spark augment: absorb one audit
  if (hasAug("spark") && state.augCharges.spark !== 0) {
    state.augCharges.spark = 0;
    state.auditPending = false;
    state.auditTier = 0;
    state.compliance = Math.max(0, state.compliance - 50);
    log("// SPARK ABSORBED the audit. The Auditor walks past your door.", "ok");
    render();
    return true;
  }

  const victims = auditPriority(state.memories.filter(m => !m.encrypted));
  if (victims.length === 0) {
    log("// Your stack is fully encrypted. They leave empty-handed.", "ok");
    state.auditPending = false;
    state.auditTier = 0;
    state.compliance = Math.max(0, state.compliance - 40);
    render();
    return true;
  }

  let losses;
  if (tier >= 3) losses = Math.max(1, Math.ceil(victims.length / 2));
  else if (tier === 2) losses = Math.min(2, victims.length);
  else losses = 1;

  const stripped = victims.slice(0, losses);
  stripped.forEach(target => {
    removeMemory(target.id);
    const flavor = target.backdoor ? "[PING TRACED]"
                 : target.source === "Stolen" ? "[FLAGGED AS STOLEN]"
                 : "[HIGHEST CLARITY]";
    log(`// AUDITED ${flavor}: "${target.hook}".`, "bad");
  });

  if (tier >= 3) {
    // Enforcement: vendor trust hit + compliance only partially scrubs
    Object.keys(state.flags.vendorTrust || {}).forEach(k => {
      state.flags.vendorTrust[k] = Math.max(0, (state.flags.vendorTrust[k] || 0) - 1);
    });
    state.compliance = Math.max(0, state.compliance - 25);
    log("// Enforcement broadcast your face to every vendor. Trust burned.", "bad");
  } else if (tier === 2) {
    // Auditor: contract board locked for the next day
    state.flags.boardLockedDay = state.day + 1;
    state.compliance = Math.max(0, state.compliance - 45);
    log("// The Auditor filed a detainment notice. Contract board sealed tomorrow.", "warn");
  } else {
    state.compliance = Math.max(0, state.compliance - 30);
  }

  state.auditPending = false;
  state.auditTier = computeAuditTier(state.compliance);
  render();
  return true;
}

// ================================================================
// ==== END OF DAY ====
// Decay, audit, Sight tax, day++, pendingEvent cascades.
// PENDING_EVENTS dispatches queued follow-ups at day boundaries.
// ================================================================
function endDay() {
  let decayed = 0;
  const nightMod = dailyContractModifier("board");
  state.memories.forEach(m => {
    if (m.encrypted) return;
    const resists = hasAug("empathy") && m.source === "Stolen";
    const chance = (resists ? 0.15 : 0.35) + (nightMod.flag === "rainBlackout" ? 0.12 : 0);
    if (Math.random() < chance) {
      m.clarity = Math.max(1, m.clarity - 1);
      decayed += 1;
    }
  });
  if (decayed > 0) log(`// ${decayed} memor${decayed === 1 ? "y" : "ies"} decayed overnight.`, "warn");
  if (decayed > 0) recordConsequence("DECAY", `${decayed} memory${decayed === 1 ? "" : "ies"} decayed overnight.`, "warn");

  runAuditIfDue();

  // Sight tax — keeping the overlay on means you don't fully rest
  if (state.sightToggled) {
    if (state.memories.length < state.capacity && Math.random() < 0.5) {
      const echo = randomMemory({ emotion: "Awe", clarity: 2 });
      echo.hook = "A half-dream from someone else's window";
      addMemory(echo);
      log("// Sight bled an echo into your sleep.", "lore");
    } else {
      complianceTick(4);
      log("// Sight kept you awake. Your signature flickered.", "warn");
    }
  }

  state.day += 1;
  state.meditatesToday = 0;
  // Rotate the radio ticker so NOW PLAYING moves on each sleep
  state.flags.newsCycle = (state.flags.newsCycle || 0) + 1;
  // Weekly follow-up drip: clear old board locks
  if (state.flags.boardLockedDay && state.flags.boardLockedDay < state.day) {
    state.flags.boardLockedDay = 0;
  }
  log(`// DAY ${state.day}.`, "");
  autosave();
  // If a previous choice queued a pendingEvent, fire it instead of the safehouse.
  if (state.flags.pendingEvent) {
    const ev = state.flags.pendingEvent;
    state.flags.pendingEvent = null;
    if (typeof PENDING_EVENTS[ev] === "function") { PENDING_EVENTS[ev](); return; }
  }
  enterSafehouse();
}

const PENDING_EVENTS = {
  auditor_followup() {
    setScene({
      portrait: "auditor.jpg",
      faction: "omni",
      title: "// AUDITOR FOLLOW-UP // 06:02",
      body: [
        "The same grey suit. Different haircut today. The smile has not been updated.",
        '"Yesterday\'s refusal was noted. A second interview is compulsory."'
      ],
      choices: [
        {
          label: "Comply — give up a Stolen memory if any",
          action: () => {
            const stolen = state.memories.find(m => !m.encrypted && m.source === "Stolen");
            if (stolen) { removeMemory(stolen.id); log(`// They took "${stolen.hook}".`, "warn"); }
            state.compliance = Math.max(0, state.compliance - 20);
            enterSafehouseAfterEvent();
          }
        },
        {
          label: "Refuse again — compliance spikes, no more calls",
          action: () => {
            complianceTick(25);
            state.reputation.omni -= 2;
            log("// They leave. The quiet afterwards is loud.", "bad");
            enterSafehouseAfterEvent();
          }
        }
      ]
    });
  },
  kid_returns() {
    setScene({
      portrait: "vex.jpg",
      title: "// THE KID IS BACK",
      body: [
        "Same kid. Dry this time. His hood hides something Mnemonic put behind his ear.",
        '"Last one worked out for you. I got more. Real ones. From a real place."'
      ],
      choices: [
        {
          label: "Take another — Joy·3 stolen",
          action: () => {
            const m = randomMemory({ emotion: "Joy", clarity: 3, source: "Stolen" });
            m.hook = "Somebody's fifteenth birthday, eaten off a plate that isn't yours";
            addMemory(m);
            state.reputation.shadow += 1;
            state.reputation.mnemonic -= 1;
            enterSafehouseAfterEvent();
          }
        },
        {
          label: "Pull him inside — warn him off Mnemonic",
          tag: "LORE",
          action: () => {
            state.reputation.shadow += 2;
            state.reputation.mnemonic -= 2;
            log("// You sent him to the Shadow's noodle shop. The Collective loses a runner.", "lore");
            enterSafehouseAfterEvent();
          }
        }
      ]
    });
  }
};

// ================================================================
// ==== MEMORY MODAL ====
// Per-memory action menu: encrypt (needs cover), re-live (capped),
// burn. Inspecting the starter memory triggers the endgame reveal.
// ================================================================
const MEDITATE_PER_DAY = 3;

function openMemoryModal(m) {
  const modal = document.createElement("div");
  modal.className = "modal-back";
  // Special: inspecting the starter memory triggers the endgame reveal once.
  const isStarter = m.starter === true
    || m.hook.startsWith("The face of the woman who raised you");
  const modalImgSrc = m.image || hookImage(m.hook, m.emotion);

  // Encrypt: find the cheapest low-clarity cover memory (clarity <= 2) that
  // isn't itself. Show its hook in the button so the cost is explicit.
  const coverMem = state.memories.find(f => f.id !== m.id && !f.encrypted && f.clarity <= 2);
  const canEncryptHere = state.location === "safehouse";
  const encryptLabel = !canEncryptHere
    ? `Encrypt — requires safehouse`
    : !coverMem
      ? `Encrypt — need a Clarity-≤2 cover memory`
      : `Encrypt <span class="hint-cost">(burns cover: "${escapeHtml(coverMem.hook.slice(0, 40))}${coverMem.hook.length > 40 ? '…' : ''}")</span>`;

  const meditatesLeft = MEDITATE_PER_DAY - (state.meditatesToday || 0);
  const canMeditate = meditatesLeft > 0 && m.clarity < 5;
  const meditateLabel = m.clarity >= 5
    ? `Re-live — already at max Clarity`
    : meditatesLeft <= 0
      ? `Re-live — no slots left today (${MEDITATE_PER_DAY}/day)`
      : `Re-live (Clarity +1) <span class="hint-cost">· ${meditatesLeft} left today</span>`;

  modal.innerHTML = `
    <div class="modal">
      <h2>// MEMORY RECORD</h2>
      <div class="body">
        <div class="memory-polaroid ${m.synthetic ? 'synthetic' : ''}">
          <img src="${modalImgSrc}" alt="Memory polaroid — ${escapeHtml(m.hook)}" onerror="this.onerror=null;this.src='data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';this.dataset.missing='1';">
          <div class="caption">"${escapeHtml(m.hook)}"</div>
        </div>
        <p style="color:var(--dim);font-size:12px;">
          EMOTION: <span class="emotion ${m.emotion}">${m.emotion}</span> ·
          CLARITY: ${m.clarity}/5 ·
          SOURCE: ${m.source}${m.synthetic ? " (SYNTHETIC)" : ""}${m.backdoor ? " · <span style='color:var(--audit)'>OMNI PING</span>" : ""}
        </p>
        <p style="color:var(--dim);font-size:12px;">Acquired Day ${m.day}. ${m.encrypted ? "Currently ENCRYPTED." : "Unsecured."}</p>
        <p style="color:var(--neon-g);font-size:11px;">TAGS: ${escapeHtml(memoryTagText(m))}</p>
        ${m.backdoor ? '<p class="hint" style="color:var(--audit);">Omni PING — Auditors will target this memory first. Encrypt or burn to break the trace.</p>' : ''}
        ${m.source === "Stolen" ? '<p class="hint" style="color:var(--neon-y);">Stolen. Auditors prioritize flagged memories; The Shadow values them donated.</p>' : ''}
        ${isStarter && state.runsCompleted >= 3 && !state.flags.starterSeen ? '<p class="glitch" style="color:var(--neon-m);">The edges of this memory are too clean. Machine-clean.</p>' : ''}
      </div>
      <div class="actions">
        <button class="choice" data-act="encrypt" ${m.encrypted || !canEncryptHere || !coverMem ? "disabled" : ""}>${encryptLabel}</button>
        <button class="choice" data-act="meditate" ${canMeditate ? "" : "disabled"}>${meditateLabel}</button>
        <button class="choice risk" data-act="delete">Burn memory</button>
        ${isStarter && state.runsCompleted >= 3 ? '<button class="choice" data-act="inspect" style="border-color:var(--neon-m);color:var(--neon-m);">Inspect its seams</button>' : ''}
        <button class="choice" data-act="close">Close</button>
      </div>
    </div>
  `;
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });
  modal.querySelectorAll("button[data-act]").forEach(b => {
    b.addEventListener("click", () => {
      if (b.disabled) return;
      const act = b.dataset.act;
      if (act === "close") { modal.remove(); return; }
      if (act === "encrypt") {
        if (!canEncryptHere) { log("// Can only encrypt at the safehouse.", "warn"); return; }
        if (!coverMem) { log("// No low-clarity cover memory available. Acquire filler first.", "warn"); modal.remove(); return; }
        removeMemory(coverMem.id);
        m.encrypted = true;
        state.flags.tutorialStep = Math.max(state.flags.tutorialStep || 0, 2);
        recordConsequence("ENCRYPTED", `${shortHook(m.hook)} is audit-proof.`, "ok");
        sensoryFlash("choice");
        log(`// Encrypted "${m.hook}" using "${coverMem.hook}" as cover.`, "ok");
        render();
      }
      if (act === "meditate") {
        if ((state.meditatesToday || 0) >= MEDITATE_PER_DAY) {
          log(`// You've used all ${MEDITATE_PER_DAY} meditate slots today. Sleep to reset.`, "warn");
          return;
        }
        if (m.clarity >= 5) { log("// Already at maximum clarity.", "warn"); return; }
        m.clarity += 1;
        state.meditatesToday = (state.meditatesToday || 0) + 1;
        state.flags.tutorialStep = Math.max(state.flags.tutorialStep || 0, 1);
        log(`// Re-lived. Clarity now ${m.clarity}. Slots left: ${MEDITATE_PER_DAY - state.meditatesToday}.`, "ok");
        render();
      }
      if (act === "delete") {
        removeMemory(m.id);
        log(`// Burned "${m.hook}".`, "warn");
      }
      if (act === "inspect") {
        state.flags.starterSeen = true;
        modal.remove();
        triggerStarterReveal();
        return;
      }
      modal.remove();
    });
  });
  $("#modal-root").appendChild(modal);
}

// ================================================================
// ==== VENDORS ====
// Ripperdoc, Mnemonic, Shadow, Grey, Purity. Each has per-vendor
// trust that unlocks perks at tier 3 and tier 5. bumpTrust(key, n)
// increments, trustLevel(key) reads.
// ================================================================
// Vendor trust tiers: every successful trade/donation/install increments a
// per-vendor counter. Trust 3+ unlocks barter or intel at each vendor.
function trustLevel(key) { return (state.flags.vendorTrust && state.flags.vendorTrust[key]) || 0; }
function bumpTrust(key, n = 1) {
  state.flags.vendorTrust = state.flags.vendorTrust || {};
  state.flags.vendorTrust[key] = Math.max(0, (state.flags.vendorTrust[key] || 0) + n);
  trackStat("vendorTrades", n);
  state.flags.tutorialStep = Math.max(state.flags.tutorialStep || 0, 4);
}

function findTaggedMemory({ emotion, clarity = 1, tags = [], source = null }) {
  return state.memories.find(m =>
    !m.encrypted &&
    (!emotion || m.emotion === emotion) &&
    m.clarity >= clarity &&
    (!source || m.source === source) &&
    memoryHasTags(m, tags)
  );
}

function openRipperdoc() {
  state.location = "ripperdoc";
  render();
  const trust = trustLevel("ripperdoc");
  const choices = [
    ...AUGMENTS.filter(a => !hasAug(a.id)).map(a => ({
      label: `${a.name} — pay ${a.cost.emotion} · Clarity ≥ ${a.cost.clarity}`,
      tag: a.effect,
      action: () => tryInstall(a)
    }))
  ];
  // Trust 3: the Ripperdoc will accept a SYNTHETIC memory at -1 clarity cost
  if (trust >= 3) {
    choices.push({
      label: "Barter — install any augment using 2 synthetic memories",
      tag: "BARTER",
      action: () => {
        const synths = state.memories.filter(m => !m.encrypted && m.synthetic);
        if (synths.length < 2) { log("// Need at least 2 synthetic memories for the barter.", "warn"); return; }
        const remaining = AUGMENTS.filter(a => !hasAug(a.id));
        if (!remaining.length) { log("// No augments left to install.", "warn"); return; }
        const aug = rand(remaining);
        removeMemory(synths[0].id);
        removeMemory(synths[1].id);
        state.augments.push(aug.id);
        if (aug.id === "spark") state.augCharges.spark = 1;
        state.reputation.purity = Math.max(-10, state.reputation.purity - 1);
        log(`// BARTER: ${aug.name} installed from 2 synthetic memories.`, "ok");
        bumpTrust("ripperdoc");
        openRipperdoc();
      }
    });
  }
  choices.push({
    label: "Recipe: Corporate Machine memory -> scrub PING + Compliance -10",
    tag: "TAGS",
    action: () => {
      const mem = findTaggedMemory({ tags: ["Corporate", "Machine"] });
      if (!mem) { log("// Need an unsecured Corporate + Machine memory.", "warn"); return; }
      mem.backdoor = false;
      state.compliance = Math.max(0, state.compliance - 10);
      bumpTrust("ripperdoc");
      recordConsequence("RECIPE", `Ripperdoc scrubbed ${shortHook(mem.hook)}.`, "ok");
      log(`// Recipe complete. "${mem.hook}" no longer carries an Omni ping.`, "ok");
      openRipperdoc();
    }
  });
  // Trust 5: uninstall augment (refund nothing; restore Purity rep by 1)
  if (trust >= 5 && state.augments.length > 0) {
    choices.push({
      label: "Extract one augment — Purity +1, augment gone",
      tag: "ETHICS",
      action: () => {
        const popped = state.augments.pop();
        state.reputation.purity = Math.min(10, state.reputation.purity + 1);
        log(`// Extracted ${augDef(popped)?.name || popped}. The doc sighs.`, "warn");
        bumpTrust("ripperdoc");
        openRipperdoc();
      }
    });
  }
  choices.push({ label: "Leave", action: enterSafehouse });
  setScene({
    portrait: "duchess_rend.jpg",
    faction: "chromejaw",
    title: "// RIPPERDOC // BACK ALLEY",
    body: [
      "Grease and neon. The doc doesn't look up from her surgical lathe.",
      '"Pay in memory, not cred. You know how this works."',
      trust >= 3 ? `<span class="hint" style="color:var(--neon-g);">She nods — you've earned a barter tier (trust ${trust}).</span>` : ''
    ],
    choices
  });
}

function tryInstall(aug) {
  const match = state.memories.find(m =>
    !m.encrypted && m.emotion === aug.cost.emotion && m.clarity >= aug.cost.clarity
  );
  if (!match) {
    log(`// No ${aug.cost.emotion} memory at clarity ${aug.cost.clarity}+ available.`, "warn");
    return;
  }
  removeMemory(match.id);
  state.augments.push(aug.id);
  if (aug.id === "spark") state.augCharges.spark = 1;
  log(`// INSTALLED: ${aug.name}. You paid with "${match.hook}".`, "ok");
  const purityHit = dailyContractModifier("board").flag === "purityInformant" ? 2 : 1;
  state.reputation.purity = Math.max(-10, state.reputation.purity - purityHit);
  if (purityHit > 1) log("// Purity informant saw the chrome go in. Temple trust drops harder.", "warn");
  bumpTrust("ripperdoc");
  openRipperdoc();
}

function openMnemonic() {
  state.location = "mnemonic";
  render();
  const trust = trustLevel("mnemonic");
  const sellList = state.memories.filter(m => !m.encrypted);
  const choices = [
    ...sellList.map(m => {
      const bonus = m.source === "Stolen" ? " · +rep (illicit)" : m.source === "Synthetic" ? " · low value" : "";
      return {
        label: `Sell "${m.hook.slice(0, 38)}${m.hook.length > 38 ? "…" : ""}"${bonus}`,
        tag: `${m.emotion}·${m.clarity}`,
        action: () => sellMemory(m)
      };
    })
  ];
  // Trust 3: Request a targeted extraction memory (pay 2 synthetic, get 1 fresh stolen)
  if (trust >= 3) {
    choices.push({
      label: "Commission a fresh stolen extraction (pay 2 synthetics)",
      tag: "COMMISSION",
      action: () => {
        const synths = state.memories.filter(m => !m.encrypted && m.synthetic);
        if (synths.length < 2) { log("// Need 2 synthetic memories to commission an extraction.", "warn"); return; }
        removeMemory(synths[0].id); removeMemory(synths[1].id);
        const fresh = randomMemory({ emotion: rand(["Rage", "Grief", "Fear"]), clarity: 4, source: "Stolen" });
        fresh.hook = rand([
          "A stranger's last phone call, cleanly severed",
          "An Omni middle manager's worst Tuesday",
          "A runner's first extraction, recorded as trauma"
        ]);
        addMemory(fresh);
        state.reputation.mnemonic = Math.min(10, state.reputation.mnemonic + 1);
        state.reputation.shadow = Math.max(-10, state.reputation.shadow - 1);
        log("// COMMISSION filled. Mnemonic brokered a fresh extraction.", "ok");
        bumpTrust("mnemonic");
        openMnemonic();
      }
    });
  }
  choices.push({
    label: "Recipe: Love + Childhood memory -> pristine Joy copy",
    tag: "TAGS",
    action: () => {
      const mem = findTaggedMemory({ tags: ["Love", "Childhood"] });
      if (!mem) { log("// Need an unsecured Love + Childhood memory.", "warn"); return; }
      const copy = makeMemory({ hook: `[COPY] ${mem.hook}`, emotion: "Joy", clarity: Math.max(2, mem.clarity - 1), source: "Synthetic", tags: ["Love", "Childhood", "Machine"] });
      addMemory(copy);
      state.reputation.mnemonic = Math.min(10, state.reputation.mnemonic + 1);
      bumpTrust("mnemonic");
      log("// Mnemonic made a clean childhood echo without taking the original.", "ok");
      openMnemonic();
    }
  });
  // Trust 5: Black catalog — buy a curated Joy·4 memory for a Grief·3
  if (trust >= 5) {
    choices.push({
      label: "Black catalog — trade a Grief·3 for a Joy·4",
      tag: "TRADE",
      action: () => {
        const grief = state.memories.find(m => !m.encrypted && m.emotion === "Grief" && m.clarity >= 3);
        if (!grief) { log("// Need a Grief·3 memory for the catalog trade.", "warn"); return; }
        removeMemory(grief.id);
        const joy = randomMemory({ emotion: "Joy", clarity: 4 });
        joy.hook = "A curated afternoon — someone's first love, anonymized";
        addMemory(joy);
        log("// Black catalog filled. The buyer winks from behind the glass.", "lore");
        bumpTrust("mnemonic");
        openMnemonic();
      }
    });
  }
  choices.push({ label: "Leave", action: enterSafehouse });
  setScene({
    portrait: "mnemonic.jpg",
    faction: "mnemonic",
    title: "// MNEMONIC LAB // NEON-7",
    body: [
      "Glass walls. Patients floating in fluid, dreaming strangers' lives.",
      "The buyer will purchase a memory — but a synthetic copy returns, half-Clarity.",
      trust >= 3 ? `<span class="hint" style="color:var(--neon-g);">Your trust is known here (${trust}). Commissioned work is on offer.</span>` : ''
    ],
    choices
  });
}

function sellMemory(m) {
  removeMemory(m.id);
  // Source-aware reactions: Stolen gets a +rep kick (illicit is their business),
  // Synthetic yields a weaker synthetic (copying a copy), Yours is standard.
  let repGain = 1;
  let clarityFactor = 0.5;
  if (m.source === "Stolen") {
    repGain = dailyContractModifier("board").flag === "mnemonicBuyer" ? 3 : 2;
    state.flags.soldStolen = (state.flags.soldStolen || 0) + 1;
    state.reputation.shadow = Math.max(-10, state.reputation.shadow - 1);
  }
  if (m.source === "Synthetic") { repGain = 0; clarityFactor = 0.34; }
  state.reputation.mnemonic = Math.min(10, state.reputation.mnemonic + repGain);
  const synth = makeMemory({
    hook: `[COPY] ${m.hook}`,
    emotion: m.emotion,
    clarity: Math.max(1, Math.ceil(m.clarity * clarityFactor)),
    source: "Synthetic"
  });
  addMemory(synth);
  bumpTrust("mnemonic");
  log(`// Sold "${m.hook}". ${m.source === "Stolen" ? "Mnemonic paid extra for stolen goods." : "Received synthetic echo."}`, "lore");
  openMnemonic();
}

function openShadow() {
  state.location = "shadow";
  render();
  const trust = trustLevel("shadow");
  const choices = [
    ...state.memories.filter(m => !m.encrypted).map(m => ({
      label: `Donate "${m.hook.slice(0, 40)}${m.hook.length > 40 ? "…" : ""}"`,
      tag: `${m.emotion}·${m.clarity}${m.source === "Stolen" ? "·stolen" : ""}`,
      action: () => donateMemory(m)
    }))
  ];
  // Trust 3: Encrypted storage — The Shadow will hide one memory off-book (auditor-proof)
  if (trust >= 3) {
    choices.push({
      label: "Stash one unencrypted memory off-book (auditor-proof)",
      tag: "STASH",
      action: () => {
        const candidates = state.memories.filter(m => !m.encrypted);
        if (!candidates.length) { log("// Nothing to stash.", "warn"); return; }
        candidates.sort((a, b) => b.clarity - a.clarity);
        candidates[0].encrypted = true;
        state.reputation.shadow = Math.min(10, state.reputation.shadow + 1);
        log(`// Stashed "${candidates[0].hook}" in the Shadow's deep record.`, "lore");
        bumpTrust("shadow");
        openShadow();
      }
    });
  }
  choices.push({
    label: "Recipe: Stolen Blackmail memory -> archive leverage",
    tag: "TAGS",
    action: () => {
      const mem = findTaggedMemory({ tags: ["Blackmail"], source: "Stolen" });
      if (!mem) { log("// Need a Stolen memory tagged Blackmail.", "warn"); return; }
      removeMemory(mem.id);
      state.reputation.shadow = Math.min(10, state.reputation.shadow + 4);
      state.compliance = Math.max(0, state.compliance - 18);
      bumpTrust("shadow");
      log("// The Shadow turns the blackmail into leverage. Heat drops hard.", "lore");
      openShadow();
    }
  });
  // Trust 5: Clandestine briefing — reveal Omni move, scrub 15 Compliance
  if (trust >= 5) {
    choices.push({
      label: "Request a briefing — Omni intel + Compliance -15",
      tag: "INFO",
      action: () => {
        state.compliance = Math.max(0, state.compliance - 15);
        state.flags.omniSabotageOffered = true;
        log("// The archivist draws a schematic on your wrist. A new contract will open.", "ok");
        bumpTrust("shadow");
        openShadow();
      }
    });
  }
  choices.push({ label: "Leave", action: enterSafehouse });
  setScene({
    portrait: "archivist.jpg",
    faction: "shadow",
    title: "// THE SHADOW ARCHIVE",
    body: [
      "A candlelit backroom behind a noodle shop. An archivist in a hood logs every story into a tape deck older than you.",
      "Donations earn no credit. Only a place in the record.",
      trust >= 3 ? `<span class="hint" style="color:var(--neon-g);">The hood tips — you have storage privileges (trust ${trust}).</span>` : ''
    ],
    choices
  });
}

function donateMemory(m) {
  const isStolen = m.source === "Stolen";
  removeMemory(m.id);
  state.reputation.shadow = Math.min(10, state.reputation.shadow + (isStolen ? 3 : 2));
  state.compliance = Math.max(0, state.compliance - (isStolen ? 12 : 8));
  bumpTrust("shadow");
  log(`// Donated "${m.hook}" to the archive.${isStolen ? " Stolen memories are gold to them." : " Compliance heat drops slightly."}`, "lore");
  openShadow();
}

function openGrey() {
  state.location = "grey";
  render();
  const trust = trustLevel("grey");
  if (trust >= 2 && !state.flags.latticeOffered) {
    state.flags.latticeOffered = true;
    log("// Lattice opens a quiet line. A new contract is on the board: LATTICE QUIET LINE.", "lore");
  }
  const tip = rand([
    "\"The Board of Nine met at 03:00. Only seven chairs were warm.\"",
    "\"Your safehouse's previous tenant was Compliance. Sweep again.\"",
    "\"The starter memory Omni issues new cores is always a maternal one. Always.\"",
    "\"Duchess Rend's monowire is keyed to her heartbeat. When she dies, it dies.\"",
    "\"Prophet Kael's chrome count has grown three points this quarter.\"",
    "\"There's a Purity spy on the Gutter-9 council. Find her and the Temple bleeds.\"",
    "\"Omni-Corp's Tier-3 sublevel has an unpatched backdoor. Auditors haven't noticed.\""
  ]);
  const choices = [
    {
      label: "Trade an Awe·3+ memory for Compliance scrub",
      tag: "AWE",
      action: () => {
        const mem = state.memories.find(m => !m.encrypted && m.emotion === "Awe" && m.clarity >= 3);
        if (!mem) { log("// No Awe·3+ memory on offer.", "warn"); return; }
        removeMemory(mem.id);
        state.compliance = Math.max(0, state.compliance - 25);
        state.reputation.grey = Math.min(10, state.reputation.grey + 1);
        bumpTrust("grey");
        log("// Lattice absorbs the memory. Your Compliance ping drops.", "ok");
        openGrey();
      }
    }
  ];
  choices.push({
    label: "Recipe: Dream + Corporate memory -> contract forecast",
    tag: "TAGS",
    action: () => {
      const mem = findTaggedMemory({ tags: ["Dream", "Corporate"] });
      if (!mem) { log("// Need an unsecured Dream + Corporate memory.", "warn"); return; }
      removeMemory(mem.id);
      state.flags.latticeOffered = true;
      state.compliance = Math.max(0, state.compliance - 12);
      bumpTrust("grey");
      log("// Lattice forecasts the next Omni move. Quiet Line is forced open.", "ok");
      openGrey();
    }
  });
  // Trust 3: Lattice unlocks the Purity spy contract
  if (trust >= 3 && !state.flags.spyRingUnlocked) {
    choices.push({
      label: "Ask Lattice to find the Purity spy on Gutter-9 council",
      tag: "INFO",
      action: () => {
        state.flags.spyRingUnlocked = true;
        state.reputation.grey = Math.min(10, state.reputation.grey + 1);
        bumpTrust("grey");
        log("// Lattice cross-references names. A new contract is unlocked.", "lore");
        openGrey();
      }
    });
  }
  // Trust 5: Offer Lattice a stolen memory and it returns a Synthetic Awe·5 pristine
  if (trust >= 5) {
    choices.push({
      label: "Give Lattice your ugliest Stolen memory (Synthetic Awe·5 returns)",
      tag: "TRADE",
      action: () => {
        const s = state.memories.find(m => !m.encrypted && m.source === "Stolen");
        if (!s) { log("// No Stolen memory to offer.", "warn"); return; }
        removeMemory(s.id);
        const refined = makeMemory({ hook: "A memory Lattice translated back into light", emotion: "Awe", clarity: 5, source: "Synthetic" });
        addMemory(refined);
        state.reputation.grey = Math.min(10, state.reputation.grey + 2);
        bumpTrust("grey");
        log("// Lattice transmuted the wound. Refined.", "ok");
        openGrey();
      }
    });
  }
  choices.push({ label: "Leave", action: enterSafehouse });
  setScene({
    portrait: "lattice_ai.jpg",
    faction: "grey",
    voice: "tts_lattice.mp3",
    title: "// THE GREY FREQUENCY",
    body: [
      "Lattice's voice comes through warm static. It sounds more human every week.",
      `<span class="glitch">${tip}</span>`,
      "\"I won't give you more today. I know what you'd do with it.\"",
      trust >= 3 ? `<span class="hint" style="color:var(--neon-g);">Lattice knows you now (${trust}). Favors are available.</span>` : ''
    ],
    choices
  });
}

function openPurity() {
  state.location = "purity";
  render();
  const trust = trustLevel("purity");
  const hypocriteLine = state.flags.kaelSuspect
    ? 'Prophet Kael smiles. You notice the seam above his ear that wasn\'t there yesterday.'
    : 'Prophet Kael blesses your unaugmented hands.';
  const choices = [
    {
      label: "Pray — Compliance scrub (no augments required)",
      action: () => {
        if (state.augments.length > 0) {
          log("// Kael senses your chrome. Prayer refused.", "warn");
          state.reputation.purity -= 1;
          return;
        }
        state.compliance = Math.max(0, state.compliance - 20);
        state.reputation.purity += 2;
        bumpTrust("purity");
        log("// You prayed. The heat drops. Something clean.", "ok");
        openPurity();
      }
    }
  ];
  if (trust >= 3 && state.augments.length === 0) {
    choices.push({
      label: "Confession — burn a Stolen memory for –30 Compliance",
      tag: "TRUST 3",
      action: () => {
        const idx = state.memories.findIndex(m => m.source === "Stolen");
        if (idx < 0) { log("// You have no stolen memories to confess.", "warn"); return; }
        state.memories.splice(idx, 1);
        state.compliance = Math.max(0, state.compliance - 30);
        state.reputation.purity += 3;
        log("// You burned a stolen memory on the altar. Kael weeps. The heat drops.", "ok");
        render();
        openPurity();
      }
    });
  }
  choices.push({
    label: "Recipe: Faith + Grief confession -> Purity +3",
    tag: "TAGS",
    action: () => {
      const mem = findTaggedMemory({ emotion: "Grief", tags: ["Faith"] });
      if (!mem) { log("// Need an unsecured Grief memory tagged Faith.", "warn"); return; }
      removeMemory(mem.id);
      state.reputation.purity = Math.min(10, state.reputation.purity + 3);
      state.compliance = Math.max(0, state.compliance - 12);
      bumpTrust("purity");
      log("// Kael calls the confession useful. You dislike how he says it.", "lore");
      openPurity();
    }
  });
  if (trust >= 5 && state.augments.length === 0 && !state.flags.puritySanctum) {
    choices.push({
      label: "Enter the Sanctum — permanent Compliance gain –15%",
      tag: "TRUST 5",
      action: () => {
        state.flags.puritySanctum = true;
        state.reputation.purity += 2;
        log("// You walked the Sanctum. The Prophet's seal is on you. Compliance rises slower.", "lore");
        openPurity();
      }
    });
  }
  if (state.flags.puritySanctum) {
    choices.push({ label: "Sanctum seal active — Compliance gain –15%", tag: "SEALED", action: openPurity });
  }
  choices.push({
    label: "Expose Kael (needs the Grey Freq rumor)",
    tag: "BETRAYAL",
    action: () => {
      if (!state.flags.kaelSuspect) {
        log("// You have no proof. Kael laughs politely.", "warn");
        return;
      }
      state.reputation.purity = -5;
      state.reputation.shadow += 3;
      log("// You tore down the Prophet. Purity is broken. The Shadow archives the collapse.", "lore");
      const m = randomMemory({ emotion: "Awe", clarity: 5 });
      m.hook = "Kael's congregation going silent as his skin pulled back";
      addMemory(m);
      enterSafehouse();
    }
  });
  choices.push({ label: "Leave", action: enterSafehouse });
  setScene({
    portrait: "kael.jpg",
    faction: "purity",
    voice: "tts_kael.mp3",
    title: "// PURITY TEMPLE // OLD CATHEDRAL",
    body: [
      "Candles. Unpainted wood. The smell of nobody's neural implants.",
      hypocriteLine,
      trust >= 5 ? '<span class="hint">The Sanctum door stands open.</span>' : ''
    ].filter(Boolean),
    choices
  });
}

// ================================================================
// ==== ENDGAME ====
// Triggered by high rep + >=5 runs, OR by inspecting the seams of
// the starter memory (which reveals it's an Omni template).
// Three endings: MERGE, ERASE, ARCHIVE. Each unlocks an NG+ mode.
// ================================================================
function maybeTriggerEndgame() {
  if (state.flags.endgameTriggered) return;
  if (state.flags.endingAchieved) return;
  // Trigger organically when rep with any faction is maxed AND at least 5 runs in
  const maxRep = Math.max(...Object.values(state.reputation).map(Math.abs));
  if (state.runsCompleted >= 5 && maxRep >= 8) {
    state.flags.endgameTriggered = true;
    log("// The city has noticed who you are. A choice is coming.", "lore");
    setTimeout(triggerEndgameChoice, 400);
  }
}

function triggerStarterReveal() {
  playSFX("sfx_project_sting.mp3", 0.85);
  setScene({
    title: "// MEMORY SEAM ANALYSIS",
    body: [
      '<span class="glitch">The woman in this memory has no pores. Her smile loops every 1.4 seconds.</span>',
      'You run the file through a mirror-check. The memory renders the same backward as forward. Real memories don\'t.',
      'This is a factory-seeded mother. An Omni-Corp template. You were someone else, before.',
      'Somewhere, the real you is archived — or erased.'
    ],
    choices: [
      {
        label: "Find out who you were",
        tag: "ENDGAME",
        action: () => {
          state.flags.endgameTriggered = true;
          triggerEndgameChoice();
        }
      },
      { label: "Put the memory back. Keep breathing.", action: enterSafehouse }
    ]
  });
}

function triggerEndgameChoice() {
  playSFX("sfx_project_sting.mp3", 0.8);
  const modal = document.createElement("div");
  modal.className = "modal-back endgame";
  // One of three doors MUST be taken — don't let Escape orphan the run.
  modal.dataset.noEscape = "true";
  modal.innerHTML = `
    <div class="modal">
      <h2>// THE PROJECT // FINAL ACCESS</h2>
      <div class="body">
        <p>You stand at the edge of Omni-Corp's Project core. Your starter memory was a template. Your life began as a seed.</p>
        <p>Three doors open in the data. You can only walk through one.</p>
        <div>
          <button class="endgame-choice" data-end="merge">
            <span class="eg-title">MERGE</span>
            <span class="eg-body">Join the hive. Memory pooled, self dissolved. The city gets quieter. So do you.</span>
          </button>
          <button class="endgame-choice" data-end="erase">
            <span class="eg-title">ERASE</span>
            <span class="eg-body">Wipe yourself clean. Become a Baseline nobody can audit. No one who loved you will recognize what remains.</span>
          </button>
          <button class="endgame-choice" data-end="archive">
            <span class="eg-title">ARCHIVE</span>
            <span class="eg-body">Give everything you are to The Shadow. You become a ghost in the city's living history — voiceless, but heard forever.</span>
          </button>
        </div>
      </div>
    </div>
  `;
  modal.querySelectorAll("button[data-end]").forEach(b => {
    b.addEventListener("click", () => {
      const ending = b.dataset.end;
      modal.remove();
      showEnding(ending);
    });
  });
  $("#modal-root").appendChild(modal);
}

// ASCII banners for each ending — rendered in <pre>
const ENDING_BANNERS = {
  merge: String.raw`
 __  __   ___   ___    ___   ___   ___
|  \/  | | __| | _ \  / __| | __| |   \
| |\/| | | _|  |   / | (_ | | _|  | |) |
|_|  |_| |___| |_|_\  \___| |___| |___/
`.trim(),
  erase: String.raw`
 ___   ___    _    ___  ___  ___
| __| | _ \  /_\  / __|| __|| \
| _|  |   / / _ \ \__ \| _| | |)|
|___| |_|_\/_/ \_\|___/|___||___/
`.trim(),
  archive: String.raw`
   _     ___    ___   _  _  ___ __   __ ___   ___
  /_\   | _ \  / __| | || ||_ _|\ \ / /| __| |   \
 / _ \  |   / | (__  | __ | | |  \ V / | _|  | |) |
/_/ \_\ |_|_\  \___| |_||_||___|  \_/  |___| |___/
`.trim()
};

function showEnding(id) {
  state.flags.endingAchieved = id;
  autosave();
  saveNGPlus(id);
  // Swelling minor chord carries the weight of the end-card
  playSFX("sfx_welcome_chord.mp3", 0.75);
  stopBGM();
  stopAmbient();

  const endings = {
    merge: {
      title: "// MERGED",
      text: [
        "You walk into the Project core willingly. The Board of Nine becomes ten, briefly, before arithmetic forgets you.",
        "There is a chorus now where your voice used to be. It sings things you never agreed to.",
        "Somewhere in the hum, a memory of rain drums on a corrugated roof. No one remembers why it matters.",
        "END // THE PROJECT CONSUMES"
      ],
      bg: "ending_merged.jpg"
    },
    erase: {
      title: "// ERASED",
      text: [
        "You wipe yourself clean. Every augment, every stolen echo, every face you loved.",
        "You wake on a Baseline bench in Gutter-9 with no name and a clarity of one.",
        "A stranger who looks like The Shadow's archivist offers you synth-noodles. You accept. You do not know why.",
        "END // THE BASELINE SURVIVES"
      ],
      bg: "ending_erased.jpg"
    },
    archive: {
      title: "// ARCHIVED",
      text: [
        "The Shadow accepts everything. Your memories become a library that plays at low volume in a thousand safehouses.",
        "Children in Gutter-9 will grow up with your Tuesdays. Your grief. Your one clean sunrise.",
        "Your body walks out alone, quiet as snow. Omni-Corp cannot audit what is already public.",
        "END // THE CITY REMEMBERS"
      ],
      bg: "archive_bg.jpg",
      voice: "tts_archive_end.mp3"
    }
  };
  const e = endings[id];
  const screen = document.createElement("div");
  screen.className = "ending-screen";
  if (e.bg) {
    screen.style.backgroundImage =
      `linear-gradient(180deg, rgba(0,0,0,0.82), rgba(0,0,0,0.92)), url("assets/images/${e.bg}")`;
    screen.style.backgroundSize = "cover";
    screen.style.backgroundPosition = "center";
  }
  const banner = ENDING_BANNERS[id] || "";
  screen.innerHTML = `
    <pre class="ending-banner">${banner}</pre>
    <h1>${e.title}</h1>
    ${e.text.map(p => `<p>${p}</p>`).join("")}
    <button id="ending-restart">NEW GAME +</button>
  `;
  document.body.appendChild(screen);
  if (e.voice) playVoice(e.voice);
  $("#ending-restart").addEventListener("click", () => {
    screen.remove();
    resetGame();
  });
}

// ================================================================
// ==== SAVE / LOAD ====
// Three slots + legacy auto-migration. SAVE_VERSION gates schema
// transforms; migrateSave() deep-merges additive fields for free.
// ================================================================
// Three save slots plus a legacy single-slot key that auto-migrates to slot 1
// the first time it's seen. Active slot is tracked in localStorage so autosave
// writes to the correct slot after load.
function activeSlotIndex() {
  try {
    const raw = localStorage.getItem(ACTIVE_SLOT_KEY);
    const n = raw == null ? 0 : parseInt(raw, 10);
    return isNaN(n) ? 0 : Math.max(0, Math.min(2, n));
  } catch (_) { return 0; }
}
function setActiveSlot(i) {
  try { localStorage.setItem(ACTIVE_SLOT_KEY, String(Math.max(0, Math.min(2, i)))); } catch (_) {}
}
function slotKey(i) { return SAVE_SLOT_KEYS[Math.max(0, Math.min(2, i))]; }
function readSlotRaw(i) {
  try { return localStorage.getItem(slotKey(i)); } catch (_) { return null; }
}
function readSlotMeta(i) {
  // Returns { empty, day, name, ending, version, ts }
  const raw = readSlotRaw(i);
  if (!raw) {
    // Legacy fallback for slot 0 only — pick up the old save key if present
    if (i === 0) {
      try {
        const legacy = localStorage.getItem(SAVE_KEY);
        if (legacy) {
          const s = JSON.parse(legacy);
          return { empty: false, day: s.day || 1, name: s.operative?.name || "—", ending: s.flags?.endingAchieved || null, legacy: true };
        }
      } catch (_) {}
    }
    return { empty: true };
  }
  try {
    const s = JSON.parse(raw);
    return { empty: false, day: s.day || 1, name: s.operative?.name || "—", ending: s.flags?.endingAchieved || null, version: s.version || 1 };
  } catch (_) { return { empty: true, corrupt: true }; }
}
function writeSlot(i, payload) {
  try { localStorage.setItem(slotKey(i), JSON.stringify(payload)); return true; } catch (e) { return false; }
}

function autosave() {
  const i = activeSlotIndex();
  try { localStorage.setItem(slotKey(i), JSON.stringify(state)); } catch (_) {}
}
function saveGame() {
  const i = activeSlotIndex();
  if (writeSlot(i, state)) log(`// SAVE written to slot ${i + 1}.`, "ok");
  else log("// SAVE failed.", "bad");
}
function loadGame() {
  const i = activeSlotIndex();
  let raw = readSlotRaw(i);
  if (!raw && i === 0) raw = localStorage.getItem(SAVE_KEY); // legacy
  if (!raw) { log("// No save found in this slot.", "warn"); return; }
  try {
    const loaded = JSON.parse(raw);
    state = migrateSave(loaded);
    // Migrate legacy key into slot 1
    try {
      const legacy = localStorage.getItem(SAVE_KEY);
      if (legacy && !readSlotRaw(0)) writeSlot(0, JSON.parse(legacy));
      if (legacy) localStorage.removeItem(SAVE_KEY);
    } catch (_) {}
    document.querySelector(".ending-screen")?.remove();
    log("// SAVE loaded.", "ok");
    enterSafehouse();
  } catch (e) { log("// LOAD failed: " + e.message, "bad"); }
}
function loadFromSlot(i) {
  setActiveSlot(i);
  loadGame();
}

function openSaveSlotModal(mode) {
  // mode: "save" | "load"
  const modal = document.createElement("div");
  modal.className = "modal-back";
  const slots = [0, 1, 2].map(i => {
    const meta = readSlotMeta(i);
    const label = meta.empty
      ? `<span style="color:var(--dim);">&lt;empty&gt;</span>`
      : `<b>${escapeHtml(meta.name)}</b> — Day ${String(meta.day).padStart(2, "0")}${meta.ending ? ` · <span style="color:var(--neon-m)">${meta.ending.toUpperCase()}</span>` : ""}${meta.legacy ? ' <span style="color:var(--dim);">(legacy)</span>' : ""}`;
    return `<button class="choice" data-slot="${i}" ${mode === "load" && meta.empty ? "disabled" : ""} style="${mode === "load" && meta.empty ? "opacity:0.4;cursor:not-allowed;" : ""}">
      <span style="letter-spacing:3px;color:var(--neon-c);">SLOT ${i + 1}</span> — ${label}
    </button>`;
  }).join("");
  modal.innerHTML = `
    <div class="modal">
      <h2>// ${mode === "save" ? "SAVE TO SLOT" : "LOAD FROM SLOT"}</h2>
      <div class="body" style="display:flex;flex-direction:column;gap:6px;">
        ${slots}
      </div>
      <div class="actions"><button class="choice" id="slot-cancel">Cancel</button></div>
    </div>`;
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });
  modal.querySelectorAll("button[data-slot]").forEach(b => {
    b.addEventListener("click", () => {
      const i = parseInt(b.dataset.slot, 10);
      modal.remove();
      setActiveSlot(i);
      if (mode === "save") saveGame();
      else loadGame();
    });
  });
  modal.querySelector("#slot-cancel").addEventListener("click", () => modal.remove());
  $("#modal-root").appendChild(modal);
}

function openExportImportModal() {
  const payload = JSON.stringify({ slot: activeSlotIndex(), state, ngplus: readNGPlus() }, null, 2);
  const modal = document.createElement("div");
  modal.className = "modal-back";
  modal.innerHTML = `
    <div class="modal wide">
      <h2>// SAVE TRANSFER</h2>
      <div class="body">
        <p style="color:var(--dim);font-size:12px;">Export this text, or paste a prior export and import it into the active slot.</p>
        <textarea id="save-transfer-text" class="save-transfer">${escapeHtml(payload)}</textarea>
      </div>
      <div class="actions">
        <button class="choice" id="copy-save">Copy export</button>
        <button class="choice" id="import-save">Import pasted save</button>
        <button class="choice" id="transfer-close">Close</button>
      </div>
    </div>
  `;
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });
  modal.querySelector("#copy-save").addEventListener("click", async () => {
    const text = modal.querySelector("#save-transfer-text").value;
    try { await navigator.clipboard.writeText(text); log("// Save export copied.", "ok"); }
    catch (_) { log("// Clipboard blocked. Select the export text manually.", "warn"); }
  });
  modal.querySelector("#import-save").addEventListener("click", () => {
    try {
      const parsed = JSON.parse(modal.querySelector("#save-transfer-text").value);
      const imported = parsed.state || parsed;
      state = migrateSave(imported);
      writeSlot(activeSlotIndex(), state);
      if (parsed.ngplus) localStorage.setItem(NGPLUS_KEY, JSON.stringify(parsed.ngplus));
      modal.remove();
      log("// Imported save into active slot.", "ok");
      enterSafehouse();
    } catch (e) {
      log("// Import failed: " + e.message, "bad");
    }
  });
  modal.querySelector("#transfer-close").addEventListener("click", () => modal.remove());
  $("#modal-root").appendChild(modal);
  modal.querySelector("#save-transfer-text").focus();
  modal.querySelector("#save-transfer-text").select();
}

function openRunHistoryModal() {
  const stats = Object.assign({}, freshState().flags.stats, state.flags.stats || {});
  const rows = (state.flags.runHistory || []).map(r => `
    <div class="history-row">
      <span class="history-title">DAY ${String(r.day).padStart(2, "0")} // ${escapeHtml(r.title)}</span>
      <span>${escapeHtml(r.modifier || "NO MOD")} // mem +${r.gained}/-${r.lost} // heat ${r.complianceDelta > 0 ? "+" : ""}${r.complianceDelta} -> ${r.complianceNow}%</span>
      <span>${escapeHtml((r.rep || []).join(" | ") || "No standing shift")}</span>
    </div>
  `).join("");
  const modal = document.createElement("div");
  modal.className = "modal-back";
  modal.innerHTML = `
    <div class="modal wide">
      <h2>// RUN HISTORY</h2>
      <div class="body">
        <div class="stats-grid">
          <span>Contracts <b>${stats.contracts}</b></span>
          <span>Memories gained <b>${stats.memoriesGained}</b></span>
          <span>Memories lost <b>${stats.memoriesLost}</b></span>
          <span>Audits <b>${stats.audits}</b></span>
          <span>Vendor trades <b>${stats.vendorTrades}</b></span>
          <span>Highest heat <b>${stats.highestCompliance}%</b></span>
        </div>
        <div class="history-list">${rows || '<span class="hint">No completed contracts yet.</span>'}</div>
      </div>
      <div class="actions"><button class="choice" id="history-close">Close</button></div>
    </div>
  `;
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });
  modal.querySelector("#history-close").addEventListener("click", () => modal.remove());
  $("#modal-root").appendChild(modal);
}

function resetGame() {
  // Preserve NG+ ledger across reset (it's the whole point of unlocks)
  const i = activeSlotIndex();
  try { localStorage.removeItem(slotKey(i)); localStorage.removeItem(SAVE_KEY); } catch (_) {}
  state = freshState();
  document.querySelector(".ending-screen")?.remove();
  const ts = document.getElementById("title-screen");
  // If the title screen exists, bring it back so the NG+ button is reachable
  if (ts) {
    ts.classList.remove("title-hidden");
    document.body.classList.add("showing-title");
    refreshNGPlusButton();
    return;
  }
  boot();
}

function refreshNGPlusButton() {
  const ngp = readNGPlus();
  const ngBtn = document.getElementById("title-ngplus");
  if (!ngBtn) return;
  if (ngp.lastEnding) {
    ngBtn.style.display = "";
  } else {
    ngBtn.style.display = "none";
  }
}

// ================================================================
// ==== NG+ + ARCHIVE MODE ====
// NG+ ledger survives game resets (it's the whole point of unlocks).
// Archive mode is a roguelite: each cycle re-broadcasts your
// preserved memories to listeners; first-touch unlocks extended
// vignettes; completing all listeners opens a new cycle.
// ================================================================
function saveNGPlus(endingId) {
  try {
    const prior = readNGPlus();
    const endings = Array.from(new Set([...(prior.endings || []), endingId]));
    const payload = {
      endings,
      lastEnding: endingId,
      finalMemories: state.memories.map(m => ({
        hook: m.hook, emotion: m.emotion, clarity: m.clarity, source: m.source, day: m.day, tags: m.tags || []
      }))
    };
    localStorage.setItem(NGPLUS_KEY, JSON.stringify(payload));
  } catch (_) {}
}

function readNGPlus() {
  try {
    const raw = localStorage.getItem(NGPLUS_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch (_) { return {}; }
}

function startNGPlus(mode) {
  try { localStorage.removeItem(SAVE_KEY); } catch (_) {}
  state = freshState();
  state.flags.ngMode = mode;
  document.querySelector(".ending-screen")?.remove();
  document.getElementById("title-screen")?.classList.add("title-hidden");
  log(`// NEW GAME+ // ${mode.toUpperCase()} carry-over active.`, "lore");

  if (mode === "archive") {
    enterArchiveMode();
    return;
  }

  // Erase: no starter memory + 1 extra capacity slot
  if (mode === "erase") {
    state.capacity = 9;
    // no starter memory
  }

  // Merge: different starter, hive-mind bleed active
  if (mode === "merge") {
    addMemory(makeMemory({
      hook: "A room full of strangers all agreeing at once",
      emotion: "Awe", clarity: 4
    }));
  }

  // Normal (no mode) or erase / merge fall through to safehouse
  if (mode !== "erase" && mode !== "merge") {
    // shouldn't happen but safe
    addMemory(makeMemory({
      hook: "The face of the woman who raised you — fading at the edges",
      emotion: "Grief", clarity: 4
    }));
  }

  initRadio();
  enterSafehouse();
}

// ---- Archive mode (Archive ending replay) ----
function enterArchiveMode() {
  state.location = "archive";
  render();
  document.body.classList.add("archive-mode");
  const archived = readNGPlus().finalMemories || [];
  const hud = document.getElementById("hud");
  if (hud) hud.style.opacity = "0.35";

  const runCount = state.flags.archiveRun || 0;
  const echoes = state.flags.archiveEchoes || [];
  const listened = echoes.length;
  const allReached = listened >= archived.length;

  setScene({
    portrait: "archivist.jpg",
    faction: "shadow",
    title: "// THE LIVING ARCHIVE",
    body: [
      "You are no longer a body in Gutter-9. You are a broadcast — played in a thousand safehouses, listened to by children who will never meet you.",
      `<span class="hint">Broadcast cycle ${runCount + 1} · ${listened}/${archived.length} vignettes reached${allReached ? ' · <b>FULL CIRCLE</b>' : ''}</span>`,
      `<span class="hint">Re-live any memory to deliver it to a listener. Each listener responds. Some unlock an extended vignette.</span>`
    ],
    choices: [
      ...archived.map((m) => {
        const reached = echoes.includes(m.hook);
        return {
          label: `${reached ? '◆ ' : ''}${m.hook.slice(0, 44)}${m.hook.length > 44 ? "…" : ""}`,
          tag: `${m.emotion}·${m.clarity}`,
          action: () => reliveArchivedMemory(m)
        };
      }),
      allReached ? {
        label: "Complete the cycle — begin a new broadcast",
        tag: "LOOP",
        action: () => {
          state.flags.archiveRun = (state.flags.archiveRun || 0) + 1;
          state.flags.archiveEchoes = [];
          log("// The broadcast loops. A new city of listeners tunes in.", "lore");
          enterArchiveMode();
        }
      } : null,
      {
        label: "Return to the world (leave archive mode)",
        tag: "EXIT",
        action: () => {
          if (hud) hud.style.opacity = "1";
          document.body.classList.remove("archive-mode");
          resetGame();
        }
      }
    ].filter(Boolean)
  });
}

function reliveArchivedMemory(m) {
  const vignettes = {
    Joy:   "A child in Gutter-9 laughs at a joke you made seventeen years ago.",
    Fear:  "A runner in Tier-2 flinches on your behalf. She never knew your name.",
    Rage:  "A Compliance Auditor loses sleep for the first time in their career.",
    Awe:   "Someone looks up at the sky through your eyes and thinks, briefly, of stars.",
    Grief: "An apartment window you never visited lights up for a stranger's grandmother."
  };
  const extended = {
    Joy:   "They teach the joke to someone else. It mutates. The original line is lost but the laugh is identical.",
    Fear:  "She uses the flinch as muscle memory on her next run. Her own daughter inherits it without meeting either of you.",
    Rage:  "They resign the next morning. The Board reassigns their desk to someone less interesting.",
    Awe:   "They paint the stars they imagined. A gallery hangs it. Nobody remembers whose eyes originally saw them.",
    Grief: "The grandmother's window was already lit. Your memory made her notice it was warm."
  };
  state.flags.archiveEchoes = state.flags.archiveEchoes || [];
  const firstTouch = !state.flags.archiveEchoes.includes(m.hook);
  if (firstTouch) state.flags.archiveEchoes.push(m.hook);
  setScene({
    portrait: "archivist.jpg",
    faction: "shadow",
    title: firstTouch ? "// RELIVING — FIRST LISTENER" : "// RELIVING — REPRISE",
    body: [
      `<span class="glitch">"${m.hook}"</span>`,
      `Emotion: ${m.emotion} · Clarity at preservation: ${m.clarity}/5`,
      vignettes[m.emotion] || "",
      firstTouch ? `<span class="hint">${extended[m.emotion] || ""}</span>` : '<span class="hint">You have reached this listener before. The memory lands softer now.</span>'
    ],
    choices: [{ label: "Back to the archive", action: enterArchiveMode }]
  });
}

// ================================================================
// ==== PIRATE RADIO ====
// 5 stations — Reso, Lattice, Omni, Mnemonic, Chrome-Jaws.
// getStationNowPlaying() rotates the NOW PLAYING ticker based on
// day, rep, compliance — no new audio needed, pure flavor.
// ================================================================
const RADIO_STATIONS = {
  reso:      { file: "reso_late_show.mp3",  artist: "RESO // THE PIRATE VJ",     now: "The Sight · Live from a bunker below Gutter-9",   portrait: "reso_studio.jpg" },
  lattice:   { file: "lattice.mp3",         artist: "LATTICE // GREY FREQ",       now: "Transmission: on ethics, on memory, on refusing", portrait: "lattice.jpg" },
  omni:      { file: "omnicorp_psa.mp3",    artist: "OMNI-CORP // PSA",           now: "Clarity — because a quiet mind is a happy one",    portrait: "auditor.jpg" },
  mnemonic:  { file: "mnemonic.mp3",        artist: "MNEMONIC COLLECTIVE",        now: "Your next life is in our catalog. All sales final.", portrait: "mnemonic.jpg" },
  chromejaw: { file: "chromejaws.mp3",      artist: "CHROME-JAW // BLACK WIRE",   now: "Pirate market open. Bring cred, leave heavier.",   portrait: "duchess_rend.jpg" }
};

const radioState = { current: "reso", playing: false };

function initRadio() {
  const toggle = $("#radio-toggle");
  const audio = $("#radio-audio");
  const radio = $("#radio");
  audio.dataset.baseVolume = "0.55";

  toggle.addEventListener("click", () => {
    radio.classList.toggle("radio-on");
    if (radio.classList.contains("radio-on")) {
      playStation(radioState.current);
    } else {
      audio.pause();
      radioState.playing = false;
    }
  });

  $$("#radio-stations .station").forEach(btn => {
    btn.addEventListener("click", () => {
      $$("#radio-stations .station").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      playStation(btn.dataset.station);
    });
  });
}

function playStation(key) {
  const s = RADIO_STATIONS[key];
  if (!s) return;
  radioState.current = key;
  const audio = $("#radio-audio");
  audio.src = `assets/audio/${s.file}`;
  audio.dataset.baseVolume = "0.55";
  audio.volume = AudioLayer.muted ? 0 : 0.55;
  audio.play().catch(() => {/* autoplay blocked, wait for user gesture */});
  const now = getStationNowPlaying(key, s);
  $("#radio-now").innerHTML = `<span class="artist">${s.artist}</span><br>${now}`;
  $("#radio-portrait").src = `assets/images/${s.portrait}`;
  radioState.playing = true;
  log(`// RADIO: tuned ${s.artist}`, "lore");
}

// Radio-faction integration: "NOW PLAYING" rotates based on game state + day.
// Each station reflects what that faction is doing this cycle. This is pure
// flavor text — no new audio needed — but makes the radio feel alive.
function getStationNowPlaying(key, s) {
  const day = state.day || 1;
  const cycle = state.flags.newsCycle || 0;
  const rep = state.reputation || {};
  const bank = {
    reso: [
      "The Sight · Live from a bunker below Gutter-9",
      "Reso: \"They're selling your Tuesdays back to you at a markup.\"",
      "Reso: \"If your memory feels clean, check the seams.\"",
      state.flags.endgameTriggered
        ? "Reso: \"We see you at the Project core, operator. Run.\""
        : "Reso: \"Tune the dial. The dial tunes you.\""
    ],
    lattice: [
      rep.grey >= 4 ? "Lattice: \"Operator known. Your patterns are novel.\"" : "Transmission: on ethics, on memory, on refusing",
      "Lattice: \"I refused a sale today. The buyer cried.\"",
      "Lattice: \"The Board of Nine met at 03:00. Only seven chairs were warm.\"",
      rep.grey >= 2 ? "Lattice: \"A tip, free, because you've earned it: Kael is 34% chrome.\"" : "Lattice: \"Subscription required. Your standing is too low.\""
    ],
    omni: [
      "Clarity — because a quiet mind is a happy one",
      rep.omni < -3 ? "OMNI PSA: \"A warrant has been filed for an unnamed dissident. Stay still.\"" : "OMNI PSA: \"Volunteer for Clarity today. Tomorrow is optional.\"",
      state.flags.endgameTriggered ? "OMNI PSA: \"The Project is complete. Congratulations, citizens.\"" : "OMNI PSA: \"Your neural implant is your friend.\"",
      rep.omni >= 4 ? "OMNI PSA: \"Valued partner, your next bonus awaits.\"" : "OMNI PSA: \"Non-compliance is its own punishment.\""
    ],
    mnemonic: [
      "Your next life is in our catalog. All sales final.",
      rep.mnemonic >= 4 ? "Mnemonic: \"Premium buyer notice — a new intake is available.\"" : "Mnemonic: \"Buying: Awe, Grief. Paying in synthetic echoes.\"",
      state.flags.chromeWarActive ? "Mnemonic: \"Duchess Rend's bounty stands. Bring her memory, walk out rich.\"" : "Mnemonic: \"No war this week. Prices are soft.\"",
      "Mnemonic: \"A good dream costs less than an augment. Ask us how.\""
    ],
    chromejaw: [
      "Pirate market open. Bring cred, leave heavier.",
      state.flags.chromeWarResolved === "fight" ? "Chrome-Jaw: \"Bounty posted on the operator who tasted Rend's wire.\"" : "Chrome-Jaw: \"Droid Boys hiring climbers. Come bleed.\"",
      rep.mnemonic < 0 ? "Chrome-Jaw: \"A certain snitch has been marked. You know who you are.\"" : "Chrome-Jaw: \"The welding room is open. Rank three requires rank two.\"",
      "Chrome-Jaw: \"Monowire special this cycle. Half off, full lethal.\""
    ]
  };
  const arr = bank[key] || [s.now];
  return arr[(day + cycle) % arr.length];
}

// ================================================================
// ==== TITLE SCREEN ====
// Splash, CONTINUE / NEW RUN / NG+ / MUTE. NEW RUN and CONTINUE
// both route through slot pickers.
// ================================================================
function initTitle() {
  const screen = $("#title-screen");
  const audio = $("#title-audio");
  // Signal to CSS that the title is on screen — hides #crt + radio + toolbar
  // until dismissed, so nothing can bleed through the semi-transparent overlay.
  document.body.classList.add("showing-title");
  initMatrixRain();
  audio.volume = 0.7;
  // Try to play — will likely fail pre-gesture. Bound to a first-gesture handler below.
  audio.play().catch(() => {
    const kick = () => {
      audio.play().catch(() => {});
      window.removeEventListener("pointerdown", kick, true);
      window.removeEventListener("keydown", kick, true);
    };
    window.addEventListener("pointerdown", kick, true);
    window.addEventListener("keydown", kick, true);
  });

  const anySlot = [0, 1, 2].some(i => !readSlotMeta(i).empty) || !!localStorage.getItem(SAVE_KEY);
  $("#title-continue").disabled = !anySlot;
  if (!anySlot) {
    $("#title-continue").style.opacity = 0.35;
    $("#title-continue").style.cursor = "not-allowed";
  }

  $("#title-new").addEventListener("click", () => {
    // Pick a save slot on New Run instead of clobbering
    if (anySlot) {
      audio.pause();
      openNewRunSlotPicker(() => {
        state = freshState();
        screen.classList.add("title-hidden");
        document.body.classList.remove("showing-title");
        stopMatrixRain();
        boot();
      });
      return;
    }
    state = freshState();
    setActiveSlot(0);
    audio.pause();
    screen.classList.add("title-hidden");
    document.body.classList.remove("showing-title");
    stopMatrixRain();
    boot();
  });

  $("#title-continue").addEventListener("click", () => {
    if (!anySlot) return;
    audio.pause();
    // If >1 slot, let the player pick which one
    const occupied = [0, 1, 2].filter(i => !readSlotMeta(i).empty);
    const doLoad = (idx) => {
      setActiveSlot(idx);
      screen.classList.add("title-hidden");
      document.body.classList.remove("showing-title");
      stopMatrixRain();
      loadGame();
    };
    if (occupied.length <= 1) doLoad(occupied[0] ?? 0);
    else openTitleSlotPicker(doLoad);
  });

  $("#title-mute").addEventListener("click", () => {
    AudioLayer.toggle();
    // Keep explicit muting on the title audio too since some browsers
    // ignore volume=0 until a gesture.
    audio.muted = AudioLayer.muted;
    _bgmEl.muted = AudioLayer.muted;
  });
  // Initialize label to persisted mute state
  $("#title-mute").textContent = AudioLayer.muted ? "♪ UNMUTE" : "♪ MUTE";
  audio.muted = AudioLayer.muted;
  _bgmEl.muted = AudioLayer.muted;

  // NG+ button — visible only if at least one ending was achieved
  const ngp = readNGPlus();
  const ngBtn = $("#title-ngplus");
  if (ngBtn) {
    if (ngp.lastEnding) {
      ngBtn.style.display = "";
      ngBtn.addEventListener("click", () => {
        audio.pause();
        openNGPlusPicker(ngp);
      });
    } else {
      ngBtn.style.display = "none";
    }
  }
}

function openTitleSlotPicker(onPick) {
  const modal = document.createElement("div");
  modal.className = "modal-back";
  const slots = [0, 1, 2].map(i => {
    const meta = readSlotMeta(i);
    const label = meta.empty
      ? `<span style="color:var(--dim);">&lt;empty&gt;</span>`
      : `<b>${escapeHtml(meta.name)}</b> — Day ${String(meta.day).padStart(2, "0")}${meta.ending ? ` · <span style=\"color:var(--neon-m)\">${meta.ending.toUpperCase()}</span>` : ""}`;
    return `<button class="choice" data-slot="${i}" ${meta.empty ? "disabled" : ""} style="${meta.empty ? "opacity:0.4;cursor:not-allowed;" : ""}">
      <span style="letter-spacing:3px;color:var(--neon-c);">SLOT ${i + 1}</span> — ${label}
    </button>`;
  }).join("");
  modal.innerHTML = `
    <div class="modal">
      <h2>// CONTINUE // PICK A SLOT</h2>
      <div class="body" style="display:flex;flex-direction:column;gap:6px;">${slots}</div>
      <div class="actions"><button class="choice" id="slot-cancel">Cancel</button></div>
    </div>`;
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });
  modal.querySelectorAll("button[data-slot]").forEach(b => {
    b.addEventListener("click", () => { const i = parseInt(b.dataset.slot, 10); modal.remove(); onPick(i); });
  });
  modal.querySelector("#slot-cancel").addEventListener("click", () => modal.remove());
  $("#modal-root").appendChild(modal);
}

function openNewRunSlotPicker(onPick) {
  const modal = document.createElement("div");
  modal.className = "modal-back";
  const slots = [0, 1, 2].map(i => {
    const meta = readSlotMeta(i);
    const label = meta.empty
      ? `<span style="color:var(--dim);">&lt;empty&gt;</span>`
      : `<b>${escapeHtml(meta.name)}</b> — Day ${String(meta.day).padStart(2, "0")} <span style="color:var(--audit);">(will overwrite)</span>`;
    return `<button class="choice ${meta.empty ? "" : "risk"}" data-slot="${i}">
      <span style="letter-spacing:3px;color:var(--neon-c);">SLOT ${i + 1}</span> — ${label}
    </button>`;
  }).join("");
  modal.innerHTML = `
    <div class="modal">
      <h2>// NEW RUN // PICK A SLOT</h2>
      <div class="body" style="display:flex;flex-direction:column;gap:6px;">${slots}</div>
      <div class="actions"><button class="choice" id="slot-cancel">Cancel</button></div>
    </div>`;
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });
  modal.querySelectorAll("button[data-slot]").forEach(b => {
    b.addEventListener("click", () => {
      const i = parseInt(b.dataset.slot, 10);
      modal.remove();
      try { localStorage.removeItem(slotKey(i)); } catch (_) {}
      setActiveSlot(i);
      onPick();
    });
  });
  modal.querySelector("#slot-cancel").addEventListener("click", () => modal.remove());
  $("#modal-root").appendChild(modal);
}

function openNGPlusPicker(ngp) {
  const modal = document.createElement("div");
  modal.className = "modal-back endgame";
  const unlocked = new Set(ngp.endings || []);
  modal.innerHTML = `
    <div class="modal">
      <h2>// NEW GAME + // CARRY OVER</h2>
      <div class="body">
        <p style="font-size:13px;color:var(--dim);">Endings unlocked: ${[...unlocked].join(" · ") || "none"}. Pick a carry-over to run again.</p>
        <button class="endgame-choice" data-ngmode="archive" ${unlocked.has("archive") ? "" : "disabled"} style="${unlocked.has("archive") ? "" : "opacity:0.35;cursor:not-allowed;"}">
          <span class="eg-title">ARCHIVE</span>
          <span class="eg-body">Play as the archive. No combat, no compliance. Browse and relive the memories you left behind.</span>
        </button>
        <button class="endgame-choice" data-ngmode="erase" ${unlocked.has("erase") ? "" : "disabled"} style="${unlocked.has("erase") ? "" : "opacity:0.35;cursor:not-allowed;"}">
          <span class="eg-title">ERASE</span>
          <span class="eg-body">Start with no memories and no mother. Capacity +1 \u2014 you carry more, but from nothing.</span>
        </button>
        <button class="endgame-choice" data-ngmode="merge" ${unlocked.has("merge") ? "" : "disabled"} style="${unlocked.has("merge") ? "" : "opacity:0.35;cursor:not-allowed;"}">
          <span class="eg-title">MERGE</span>
          <span class="eg-body">Hive-mind bleed. Every memory you gain also feeds Omni-Corp. You have always been Omni.</span>
        </button>
        <button class="endgame-choice" data-ngmode="cancel"><span class="eg-title" style="color:var(--dim);">CANCEL</span></button>
      </div>
    </div>
  `;
  modal.querySelectorAll("button[data-ngmode]").forEach(b => {
    b.addEventListener("click", () => {
      const mode = b.dataset.ngmode;
      modal.remove();
      if (mode === "cancel") return;
      if (!unlocked.has(mode)) return;
      startNGPlus(mode);
    });
  });
  $("#modal-root").appendChild(modal);
}

// ================================================================
// ==== DAILY EVENTS ====
// Safehouse encounters. Rolled after day 2 on enterSafehouse().
// Some events queue a pendingEvent for next-day cascades.
// ================================================================
const DAILY_EVENTS = [
  // Reso pirate overlay — free Awe memory
  () => {
    setScene({
      portrait: "reso.jpg",
      faction: "grey",
      voice: "tts_reso_overlay.mp3",
      title: "// RESO'S OVERLAY — 04:13",
      body: [
        'A billboard three blocks over fractures into Reso\'s face.',
        '<span class="glitch">"Wake up, Neon City. They\'re selling your Tuesdays back to you at a markup."</span>',
        'The overlay lasts nine seconds. You remember all of them.'
      ],
      choices: [{
        label: "Absorb the broadcast",
        action: () => {
          const m = randomMemory({ emotion: "Awe", clarity: 3 });
          m.hook = "Reso's pirate smile overwriting an Omni billboard";
          addMemory(m);
          state.reputation.grey += 1;
          enterSafehouseAfterEvent();
        }
      }]
    });
  },

  // Synth-Hound at the door
  () => {
    playSFX("sfx_hound_growl.mp3", 0.65);
    setScene({
      portrait: "hound.jpg",
      faction: "omni",
      title: "// SCRATCHING // 03:40",
      body: [
        "A chrome-plated Synth-Hound is standing outside your door. Its thermal scan paints your chest.",
        "Your deck pings once — Lattice, warning you to stay still."
      ],
      choices: [
        {
          label: "Hold your breath. Wait it out.",
          action: () => {
            if (Math.random() > 0.5 || hasAug("cloak")) {
              log("// The Hound moves on.", "ok");
              if (hasAug("cloak")) log("// CLOAK engaged.", "ok");
            } else {
              log("// The Hound logged you. Compliance ticks up.", "bad");
              complianceTick(8);
            }
            enterSafehouseAfterEvent();
          }
        },
        {
          label: "Spend Fear·2+ to spoof its sensors",
          tag: "FEAR",
          action: () => {
            const bait = state.memories.find(m => !m.encrypted && m.emotion === "Fear" && m.clarity >= 2);
            if (!bait) { log("// No Fear·2 memory to broadcast as decoy.", "warn"); return; }
            removeMemory(bait.id);
            log(`// Broadcast "${bait.hook}" as decoy. The Hound chases a ghost.`, "ok");
            state.compliance = Math.max(0, state.compliance - 10);
            enterSafehouseAfterEvent();
          }
        }
      ]
    });
  },

  // A knock at the door — street kid selling memories
  () => {
    setScene({
      portrait: "vex.jpg",
      title: "// KNOCK AT THE DOOR",
      body: [
        "A kid, maybe fifteen, dripping rain. Holds up a cracked data-drive.",
        '"Traded my grandma\'s wedding. Mnemonic wouldn\'t touch it. You buy?"'
      ],
      choices: [
        {
          label: "Buy it — accept a Joy·2 stolen memory",
          action: () => {
            const m = randomMemory({ emotion: "Joy", clarity: 2, source: "Stolen" });
            m.hook = "A wedding dance under tungsten bulbs, 1987";
            addMemory(m);
            state.reputation.shadow += 1;
            state.flags.pendingEvent = "kid_returns";
            log("// The kid smiles. You didn't pay cred. You paid presence. He'll be back.", "ok");
            enterSafehouseAfterEvent();
          }
        },
        {
          label: "Turn him away",
          action: () => {
            state.reputation.shadow -= 1;
            log("// You shut the door. He walks into the rain.", "warn");
            enterSafehouseAfterEvent();
          }
        }
      ]
    });
  },

  // Compliance Division knocks
  () => {
    setScene({
      portrait: "auditor.jpg",
      faction: "omni",
      voice: "tts_auditor.mp3",
      title: "// COMPLIANCE COURTESY CALL",
      body: [
        "Two Auditors in grey suits. Identical haircuts. Identical smiles.",
        '"A routine wellness check, citizen. Would you prefer audio or visual scan?"'
      ],
      choices: [
        {
          label: "Consent to audio — gives up Fear·1",
          action: () => {
            const fear = state.memories.find(m => !m.encrypted && m.emotion === "Fear");
            if (fear) { removeMemory(fear.id); log(`// They scraped "${fear.hook}".`, "warn"); }
            state.reputation.omni += 1;
            state.compliance = Math.max(0, state.compliance - 15);
            enterSafehouseAfterEvent();
          }
        },
        {
          label: "Refuse — slam the door",
          action: () => {
            state.reputation.omni -= 2;
            complianceTick(15);
            state.flags.pendingEvent = "auditor_followup";
            log("// They noted the refusal in ink you can't see. They will be back.", "bad");
            enterSafehouseAfterEvent();
          }
        }
      ]
    });
  },

  // The Circuit Shaman speaks
  () => {
    setScene({
      portrait: "circuit_shaman.jpg",
      title: "// VOICES IN THE WIRING",
      body: [
        "You wake to a hum you can't source. Your toaster is whispering a prayer.",
        "A Circuit Shaman has crossed your wiring, pro bono. They want your attention."
      ],
      choices: [
        {
          label: "Listen — gain an Awe·4 memory",
          action: () => {
            const m = randomMemory({ emotion: "Awe", clarity: 4 });
            m.hook = "A toaster singing your grandmother's lullaby in binary";
            addMemory(m);
            state.capacity = Math.min(12, state.capacity + 1);
            log("// The shaman taught you to carry one more memory than you thought you could.", "ok");
            enterSafehouseAfterEvent();
          }
        },
        {
          label: "Unplug everything",
          action: () => {
            log("// The hum dies. You feel emptier than before.", "warn");
            enterSafehouseAfterEvent();
          }
        }
      ]
    });
  }
];

function pickDailyEvent() {
  // Don't stack events in the first 2 days
  if (state.day < 2) return null;
  return rand(DAILY_EVENTS);
}

function enterSafehouseAfterEvent() {
  // Return to the normal safehouse view without re-firing events
  state.location = "safehouse";
  render();
  const hasMemories = state.memories.length > 0;
  setScene({
    title: `DAY ${String(state.day).padStart(2,"0")} // SAFEHOUSE`,
    body: [
      "Rain drums on the corrugated roof. A dozen tiny red LEDs blink from the deck on your workbench.",
      "Gutter-9 is quiet. For now."
    ],
    choices: [
      { label: "Check the contract board", tag: "RUN", action: openContractBoard },
      { label: "Visit the Ripperdoc", tag: "SPEND", action: openRipperdoc, disabled: () => !hasMemories || (state.flags.chromeWarActive && !state.flags.chromeWarResolved) },
      { label: "Route through Mnemonic Lab", tag: "TRADE", action: openMnemonic, disabled: () => !hasMemories },
      { label: "Drop off at The Shadow Archive", tag: "LORE", action: openShadow, disabled: () => !hasMemories },
      { label: "Ping the Grey Frequency", tag: "INFO", action: openGrey, disabled: () => state.reputation.grey < 2 && !hasAug("ice") },
      { label: "Visit the Purity Temple", tag: "FAITH", action: openPurity, disabled: () => state.reputation.purity < 1 && state.day < 2 },
      { label: "Tune the deck and sleep", tag: "END DAY", action: endDay }
    ]
  });
}

// ================================================================
// ==== CHROME-JAWS WAR ARC ====
// Long-burn faction event. Resolves via warResolve() with three
// outcomes affecting Chrome-Jaw, Omni, and Shadow standings.
// ================================================================
function triggerChromeWarIntro() {
  log("// Duchess Rend has located your safehouse.", "bad");
  playSFX("sfx_monowire_hum.mp3", 0.35);
  setScene({
    portrait: "duchess_rend.jpg",
    faction: "chromejaw",
    voice: "tts_duchess_rend.mp3",
    title: "// DUCHESS REND AT YOUR DOOR",
    body: [
      "87% chrome. A single length of monowire hangs from her wrist like a pet.",
      '"You\'ve been selling our ghosts to the Mnemonic Collective. I have questions. They have edges."',
      '<span class="glitch">A war is now open against the Chrome-Jaws. Until it ends, Ripperdoc and Drophouse contracts are sealed.</span>'
    ],
    choices: [
      {
        label: "Offer tribute — lose your highest-Clarity memory",
        tag: "SUBMIT",
        action: () => {
          const victims = state.memories.filter(m => !m.encrypted);
          if (victims.length === 0) { log("// Nothing to offer. She'll kill you instead.", "bad"); warResolve("killed"); return; }
          victims.sort((a, b) => b.clarity - a.clarity);
          removeMemory(victims[0].id);
          log(`// You offered "${victims[0].hook}". Duchess takes it slowly.`, "warn");
          state.flags.warTribute = true;
          warResolve("tribute");
        }
      },
      {
        label: "Fight back — requires Reflex or Rage·5",
        tag: "FIGHT",
        action: () => {
          const rage5 = state.memories.find(m => !m.encrypted && m.emotion === "Rage" && m.clarity >= 5);
          const canFight = hasAug("reflex") || !!rage5;
          if (!canFight) { log("// She steps inside before you finish the thought. You can't win this one raw.", "bad"); warResolve("killed"); return; }
          if (rage5) removeMemory(rage5.id);
          log("// You met monowire with muscle memory. She's bleeding. You're bleeding. You're alive.", "ok");
          state.reputation.mnemonic += 2;
          state.flags.warVictor = true;
          warResolve("fight");
        }
      },
      {
        label: "Call in The Shadow",
        tag: "ALLY",
        action: () => {
          if (state.reputation.shadow < 4) { log("// The Shadow doesn't trust you enough to die for you.", "warn"); warResolve("abandoned"); return; }
          log("// The Shadow arrives. Hoods, no faces. Duchess walks away, slowly.", "lore");
          state.reputation.shadow -= 2;
          state.flags.warAllied = true;
          warResolve("ally");
        }
      }
    ]
  });
}

function warResolve(outcome) {
  state.flags.chromeWarResolved = outcome;

  if (outcome === "killed") {
    // Brutal — player loses half their memories and a big compliance spike, but survives
    const losses = Math.ceil(state.memories.length / 2);
    const toRemove = state.memories.filter(m => !m.encrypted).slice(0, losses);
    toRemove.forEach(m => removeMemory(m.id));
    complianceTick(25);
    log(`// Duchess left you breathing. Barely. ${losses} memories taken.`, "bad");
  }
  if (outcome === "abandoned") {
    const losses = Math.ceil(state.memories.length / 2);
    const toRemove = state.memories.filter(m => !m.encrypted).slice(0, losses);
    toRemove.forEach(m => removeMemory(m.id));
    complianceTick(15);
  }

  setScene({
    portrait: "duchess_rend.jpg",
    faction: "chromejaw",
    title: "// AFTERMATH",
    body: [
      outcome === "fight"    ? "You won. The Chrome-Jaws will remember. A bounty opens on your name." :
      outcome === "tribute"  ? "She took what she came for. The Chrome-Jaws consider your debt paid — for now." :
      outcome === "ally"     ? "The Shadow bought you passage. You owe them. You'll always owe them." :
                               "The rain doesn't clean your apartment of what she left behind.",
      "The safehouse walls feel thinner."
    ],
    choices: [{ label: "Continue", action: enterSafehouseAfterEvent }]
  });
}

// ================================================================
// ==== BOOT + INTRO + GLOSSARY ====
// DOMContentLoaded → boot(): load save, init title, wire toolbar,
// hotkeys, tooltips, radio. playIntroVideo() runs once per profile.
// openGlossary() is the in-game help modal.
// ================================================================
function boot() {
  log("// CLARITY — BOOT", "ok");
  log("// Memory is currency. Clarity is survival.", "lore");
  if (state.memories.length === 0) {
    const starter = makeMemory({
      hook: "The face of the woman who raised you — fading at the edges",
      emotion: "Grief",
      clarity: 4
    });
    starter.starter = true;  // drives the endgame "inspect the seams" reveal
    addMemory(starter);
  }
  initRadio();
  // First-run — show the cinematic intro. If the video is missing or the
  // browser blocks playback, fall back to the text orientation card.
  if (!localStorage.getItem(INTRO_SEEN_KEY)) {
    playIntroVideo(
      () => {
        try { localStorage.setItem(INTRO_SEEN_KEY, "1"); } catch (_) {}
        enterSafehouse();
      },
      () => {
        log("// Intro video unavailable. Falling back to orientation.", "warn");
        showOrientation();
      }
    );
    return;
  }
  enterSafehouse();
}

// ---- Intro cinematic player ----
function playIntroVideo(onDone, onFail) {
  const screen = document.getElementById("intro-video-screen");
  const video = document.getElementById("intro-video");
  const skipBtn = document.getElementById("intro-skip");
  if (!screen || !video || !skipBtn) {
    if (onFail) onFail(); else onDone();
    return;
  }

  let finished = false;
  const cleanup = () => {
    finished = true;
    try { video.pause(); video.currentTime = 0; } catch (_) {}
    screen.style.display = "none";
    skipBtn.removeEventListener("click", finish);
    document.removeEventListener("keydown", onKey);
    video.removeEventListener("ended", finish);
    video.removeEventListener("error", fail);
  };
  const finish = () => { if (finished) return; cleanup(); onDone(); };
  const fail = () => { if (finished) return; cleanup(); (onFail || onDone)(); };
  const onKey = (e) => { if (e.key === "Escape" || e.key === " ") finish(); };

  // Duck any other audio to near-silence during the intro
  _bgmEl.pause();

  screen.style.display = "flex";
  video.currentTime = 0;
  skipBtn.addEventListener("click", finish);
  video.addEventListener("ended", finish);
  video.addEventListener("error", fail);
  document.addEventListener("keydown", onKey);

  // Play — NEW RUN click is the user gesture that unlocks autoplay + audio
  video.play().catch((err) => {
    log("// Intro video play blocked: " + err.message, "warn");
    fail();
  });
}

function showOrientation() {
  playBGM("safehouse_ambient.mp3");
  state.location = "safehouse";
  render();
  setScene({
    portrait: "skyline.jpg",
    title: "// WELCOME TO NEON CITY",
    body: [
      'Rain has been falling for seven years. The city breathes steam and advertising jingles you never asked to learn.',
      '<span class="glitch">Here is what you need to know.</span>',
      '<strong>Memory is currency.</strong> Your inventory \u2014 right sidebar \u2014 is not items. It is the things that happened to you. You trade them, encrypt them, weaponize them.',
      '<strong>Clarity is survival.</strong> Omni-Corp\'s Compliance Division audits the population by stripping high-clarity memories from your skull. Encrypt what matters, or lose it.',
      '<strong>Factions want different things.</strong> The Shadow archives you. Mnemonic traffics you. Omni overwrites you. Which of them gets your memory this week is the game.',
      '<strong>You will end.</strong> Three endings wait \u2014 one reveals what you really are. Play twice.',
      '<span class="hint">Click through. Choose. See where you land.</span>'
    ],
    choices: [{
      label: "Open my eyes.",
      tag: "BEGIN",
      action: () => {
        try { localStorage.setItem(INTRO_SEEN_KEY, "1"); } catch (_) {}
        enterSafehouse();
      }
    }]
  });
}

function openGlossary() {
  const modal = document.createElement("div");
  modal.className = "modal-back";
  modal.innerHTML = `
    <div class="modal" style="max-width:720px; max-height:80vh; overflow-y:auto;">
      <h2>// GLOSSARY</h2>
      <div class="body" style="font-size:12px; line-height:1.55;">

        <h3 class="gl-h">CORE LOOP</h3>
        <p><b>Run</b> a contract \u2192 <b>extract</b> memories \u2192 <b>spend</b> them at vendors \u2192 <b>audit</b> catches up \u2192 repeat. Three endings wait at the end.</p>

        <h3 class="gl-h">MEMORY</h3>
        <p>Your inventory is the things that happened to you. Each memory has:</p>
        <ul class="gl-list">
          <li><b>Emotion</b> \u2014 Joy / Fear / Rage / Awe / Grief. Drives what vendors will take it.</li>
          <li><b>Clarity</b> (1\u20135) \u2014 audit resistance. Decays 35%/night unless encrypted.</li>
          <li><b>Source</b> \u2014 <i>Yours</i> (real), <i>Stolen</i> (extracted), <i>Synthetic</i> (copied, half-clarity, sometimes backdoored).</li>
        </ul>

        <h3 class="gl-h">ENCRYPTION</h3>
        <p>Click a memory \u2192 "Encrypt at safehouse". Spends a low-Clarity memory as cover. Encrypted memories survive audits and don't decay.</p>

        <h3 class="gl-h">COMPLIANCE</h3>
        <p>Your Omni-Corp heat. At <b>70%</b> an Auditor is dispatched. On your <b>next sleep</b>, the Auditor strips your highest-Clarity <i>unencrypted</i> memory. Sleep with a full-encrypted stack to shrug them off.</p>

        <h3 class="gl-h">FACTIONS (6)</h3>
        <ul class="gl-list">
          <li><b>The Shadow</b> \u2014 archive. Donate = +Shadow rep, -Compliance.</li>
          <li><b>Mnemonic Collective</b> \u2014 black market. Sell \u2192 synthetic copy.</li>
          <li><b>Grey Frequency / Lattice</b> \u2014 info-broker AI. Awe memories buy Compliance scrubs.</li>
          <li><b>Purity</b> \u2014 anti-chrome cult. Prays scrub Compliance if you're flesh-clean.</li>
          <li><b>Omni-Corp</b> \u2014 The Project. Pays well, pings you.</li>
          <li><b>Chrome-Jaws</b> \u2014 cyberware syndicate. Ripperdoc + Droid Boys.</li>
        </ul>

        <h3 class="gl-h">AUGMENTS (5)</h3>
        <ul class="gl-list">
          <li><b>Runner's Cloak</b> (Fear\u00b73) \u2014 \u221225% Compliance gain everywhere.</li>
          <li><b>Chrome-Jaw Reflex</b> (Rage\u00b74) \u2014 auto-win risky rolls in smuggle/duel contracts.</li>
          <li><b>Grid Architect ICE-piercer</b> (Awe\u00b74) \u2014 bonus memory on data runs.</li>
          <li><b>Empathy Dampener</b> (Grief\u00b73) \u2014 Stolen memories decay slower.</li>
          <li><b>Circuit Shaman Spark</b> (Joy\u00b75) \u2014 absorbs one audit. One-time.</li>
        </ul>
        <p style="color:var(--dim);font-size:11px;">Every augment you install drops Purity rep.</p>

        <h3 class="gl-h">ENDINGS</h3>
        <p>After ~5 runs with any faction at \u00b18, OR by inspecting your starter memory's 'seams' after 3 runs, three doors open: <b>MERGE</b> / <b>ERASE</b> / <b>ARCHIVE</b>. Each unlocks a New Game + mode.</p>

        <h3 class="gl-h">KEYS</h3>
        <p><b>ESC</b> or <b>SPACE</b> skip the intro cinematic. <b>Click anywhere</b> during text reveal to skip the typewriter.</p>

      </div>
      <div class="actions">
        <button class="choice" id="glossary-close">Close</button>
      </div>
    </div>
  `;
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });
  modal.querySelector("#glossary-close").addEventListener("click", () => modal.remove());
  $("#modal-root").appendChild(modal);
}

document.addEventListener("DOMContentLoaded", () => {
  $("#btn-save").addEventListener("click", () => openSaveSlotModal("save"));
  $("#btn-load").addEventListener("click", () => openSaveSlotModal("load"));
  $("#btn-history").addEventListener("click", openRunHistoryModal);
  $("#btn-export").addEventListener("click", openExportImportModal);
  $("#btn-reset").addEventListener("click", () => {
    if (confirm("Reset progress in the active save slot?")) resetGame();
  });
  $("#btn-help").addEventListener("click", openGlossary);
  const muteBtn = $("#hud-mute");
  if (muteBtn) {
    muteBtn.textContent = AudioLayer.muted ? "♪ UNMUTE" : "♪ MUTE";
    muteBtn.addEventListener("click", () => { AudioLayer.toggle(); });
  }
  const sightBtn = $("#btn-sight");
  if (sightBtn) {
    sightBtn.addEventListener("click", () => { toggleSightMode(); });
    refreshSightButton();
  }
  initTooltips();
  initTitle();

  // --- Global keyboard handler ---
  // Escape: close topmost dismissible modal (unless it opted out).
  // 1..9: activate the N-th choice on screen.
  // S (ctrl): quicksave. L (ctrl): quickload. M: mute toggle. H: help.
  // Arrow keys navigate between focusable scene choices.
  document.addEventListener("keydown", (e) => {
    const intro = document.getElementById("intro-video-screen");
    if (intro && intro.style.display && intro.style.display !== "none") return;
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;

    // Escape handling
    if (e.key === "Escape") {
      const modals = document.querySelectorAll(".modal-back");
      if (modals.length === 0) return;
      const top = modals[modals.length - 1];
      if (top.dataset.noEscape === "true") return;
      top.remove();
      return;
    }

    // Ctrl+S quicksave / Ctrl+L quickload
    if (e.ctrlKey && (e.key === "s" || e.key === "S")) {
      e.preventDefault();
      saveGame();
      return;
    }
    if (e.ctrlKey && (e.key === "l" || e.key === "L")) {
      e.preventDefault();
      loadGame();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    // Single-key shortcuts (ignored while a modal is up, to avoid stomping)
    const anyModal = document.querySelector(".modal-back");
    if (!anyModal) {
      if (e.key === "m" || e.key === "M") { AudioLayer.toggle(); return; }
      if (e.key === "h" || e.key === "H" || e.key === "?") { openGlossary(); return; }
      if (e.key === "g" || e.key === "G") { toggleSightMode(); return; }
    }

    // Number keys select the Nth scene choice
    if (/^[1-9]$/.test(e.key)) {
      const ctx = anyModal || $("#scene-choices");
      if (!ctx) return;
      const btns = Array.from(ctx.querySelectorAll("button"))
        .filter(b => !b.disabled && b.offsetParent !== null);
      const idx = parseInt(e.key, 10) - 1;
      if (btns[idx]) { btns[idx].click(); }
      return;
    }

    // Arrow-key navigation across visible choice buttons
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const ctx = anyModal || $("#scene-choices");
      if (!ctx) return;
      const btns = Array.from(ctx.querySelectorAll("button"))
        .filter(b => !b.disabled && b.offsetParent !== null);
      if (!btns.length) return;
      const active = document.activeElement;
      let i = btns.indexOf(active);
      if (e.key === "ArrowDown") i = (i + 1) % btns.length;
      else i = (i - 1 + btns.length) % btns.length;
      btns[i].focus();
      e.preventDefault();
    }
  });
});
