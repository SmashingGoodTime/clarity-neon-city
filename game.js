// ================================================================
// CLARITY // Neon City
// A memory-as-inventory immersive sim.
// ================================================================

// ---------- Utility ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
const uid = (() => { let i = 0; return () => `m${Date.now().toString(36)}${(i++).toString(36)}`; })();

// ---------- State ----------
const EMOTIONS = ["Joy", "Fear", "Rage", "Awe", "Grief"];

const FACTIONS = [
  { key: "shadow",   label: "THE SHADOW",    max: 10 },
  { key: "mnemonic", label: "MNEMONIC",      max: 10 },
  { key: "grey",     label: "GREY FREQ",     max: 10 },
  { key: "purity",   label: "PURITY",        max: 10 },
  { key: "omni",     label: "OMNI-CORP",     max: 10 }
];

const SAVE_KEY = "clarity.save";
const NGPLUS_KEY = "clarity.ngplus";
const INTRO_SEEN_KEY = "clarity.introSeen";

// ---------- BGM + SFX (shared audio layer, distinct from radio) ----------
const _bgmEl = (() => {
  const el = document.createElement("audio");
  el.loop = true;
  el.volume = 0.45;
  el.preload = "auto";
  document.addEventListener("DOMContentLoaded", () => document.body.appendChild(el));
  return el;
})();

let _bgmCurrent = null;
function playBGM(file) {
  if (_bgmCurrent === file) return;
  _bgmCurrent = file;
  _bgmEl.src = `assets/audio/${file}`;
  _bgmEl.play().catch(() => {/* autoplay blocked — will start after first user click */});
}
function stopBGM() { _bgmCurrent = null; _bgmEl.pause(); _bgmEl.src = ""; }

// Independent ambient layer (rain, etc.) — loops quietly alongside BGM
const _ambientEl = (() => {
  const el = document.createElement("audio");
  el.loop = true;
  el.volume = 0.2;
  el.preload = "auto";
  document.addEventListener("DOMContentLoaded", () => document.body.appendChild(el));
  return el;
})();
let _ambientCurrent = null;
function playAmbient(file, volume = 0.22) {
  if (_ambientCurrent === file) { _ambientEl.volume = volume; return; }
  _ambientCurrent = file;
  _ambientEl.src = `assets/audio/${file}`;
  _ambientEl.volume = volume;
  _ambientEl.play().catch(() => {});
}
function stopAmbient() { _ambientCurrent = null; _ambientEl.pause(); }

function playSFX(file, vol = 0.55) {
  try {
    const el = new Audio(`assets/audio/${file}`);
    el.volume = vol;
    el.play().catch(() => {});
  } catch (_) {}
}

// ---------- Matrix rain (title screen only) ----------
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

// ---------- Terminal prompt per location ----------
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

// ---------- Typewriter ----------
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

let state = freshState();

function freshState() {
  return {
    day: 1,
    location: "safehouse",
    capacity: 8,
    compliance: 0,
    auditPending: false,
    sightActive: false,
    memories: [],
    augments: [],          // array of augment ids
    augCharges: {},        // per-augment charge counter (spark uses this)
    reputation: { shadow: 0, mnemonic: 0, grey: 0, purity: 0, omni: 0 },
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
      lastEventDay: 0
    },
    runsCompleted: 0,
    operative: {
      name: "JANE DOE",
      origin: "BASELINE",
      path: "GUTTER-SYNDICATE RUNNER"
    }
  };
}

// ---------- Memory model ----------
function makeMemory({ hook, emotion, clarity = 3, source = "Yours", synthetic = false, backdoor = false }) {
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
    image: hookImage(hook, emotion)
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

function addMemory(mem) {
  if (state.memories.length >= state.capacity) {
    log(`// OVERCAP: "${mem.hook}" slipped through. Cyber-psychosis ticks up.`, "bad");
    state.compliance = Math.min(100, state.compliance + 5);
    glitchScene();
    return false;
  }
  state.memories.push(mem);
  log(`+ MEMORY ACQUIRED: "${mem.hook}" [${mem.emotion}·${mem.clarity}]`, "ok");
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
    render();
    return m;
  }
  return null;
}

// ---------- Augments ----------
const AUGMENTS = [
  { id: "reflex",  name: "Chrome-Jaw Reflex",          cost: { emotion: "Rage",  clarity: 4 }, effect: "Avoid one run-fail outcome per day" },
  { id: "ice",     name: "Grid Architect ICE-piercer", cost: { emotion: "Awe",   clarity: 4 }, effect: "+1 memory yield on data runs" },
  { id: "cloak",   name: "Runner's Cloak",             cost: { emotion: "Fear",  clarity: 3 }, effect: "Compliance gain reduced 25%" },
  { id: "empathy", name: "Empathy Dampener",           cost: { emotion: "Grief", clarity: 3 }, effect: "Stolen memories resist decay" },
  { id: "spark",   name: "Circuit Shaman Spark",       cost: { emotion: "Joy",   clarity: 5 }, effect: "Absorb one audit (one-time)" }
];

function hasAug(id) { return state.augments.includes(id); }
function augDef(id) { return AUGMENTS.find(a => a.id === id); }

// ---------- Logging ----------
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

// ---------- Rendering ----------
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
      </div>
    `;
    el.addEventListener("click", () => openMemoryModal(m));
    ml.appendChild(el);
  });

  // Reputation
  renderRep();

  // Augments
  renderAugs();
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

// ---------- Voice (Chatterbox TTS one-shots) ----------
let _voiceEl = null;
function playVoice(file, volume = 0.9) {
  if (!file) return;
  try {
    if (_voiceEl) { _voiceEl.pause(); _voiceEl = null; unduckMusic(); }
    _voiceEl = new Audio(`assets/audio/${file}`);
    _voiceEl.volume = Math.max(0, Math.min(1, volume));
    _voiceEl.onerror = () => { unduckMusic(); };
    _voiceEl.onended = () => { unduckMusic(); };
    duckMusic();
    _voiceEl.play().catch(() => { unduckMusic(); });
  } catch (_) { unduckMusic(); }
}

// ---------- Tooltip system ----------
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

// ---------- Scene ----------
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
    btn.addEventListener("click", () => {
      if (c.disabled && c.disabled()) return;
      c.action();
    });
    if (c.disabled && c.disabled()) {
      btn.disabled = true;
      btn.style.opacity = 0.4;
      btn.style.cursor = "not-allowed";
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

// ---------- Safehouse ----------
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

// ---------- Contract board ----------
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
  }
];

function openContractBoard() {
  state.location = "safehouse";
  render();
  const available = CONTRACTS.filter(c => c.gate());
  setScene({
    title: "// CONTRACT BOARD",
    body: [`${available.length} posting${available.length === 1 ? "" : "s"} pulse on the grey-market board.`],
    choices: [
      ...available.map(c => ({
        label: `${typeof c.title === "function" ? c.title() : c.title} — ${c.issuer}`,
        tag: `C+${effectiveCompliance(c.compliance)}`,
        action: () => startContract(c)
      })),
      { label: "Back", action: enterSafehouse }
    ]
  });
}

function effectiveCompliance(base) {
  return hasAug("cloak") ? Math.ceil(base * 0.75) : base;
}

function startContract(c) {
  state.location = "run";
  playBGM("contract_tension.mp3");
  stopAmbient();  // no rain layer when you're out in the field
  const title = typeof c.title === "function" ? c.title() : c.title;
  log(`// CONTRACT START: ${title}`, "warn");
  ARCS[c.arc](c);
}

// ---------- Arcs ----------
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
  }
};

function endRun(c, text) {
  state.runsCompleted += 1;
  log("// CONTRACT END.", "ok");
  setScene({
    title: "// EXFILTRATION",
    body: [text, "You return to the safehouse as the rain gets louder."],
    choices: [{ label: "Return to safehouse", action: enterSafehouse }]
  });
}

// ---------- Compliance + Audit ----------
function complianceTick(amount) {
  const adj = hasAug("cloak") ? Math.ceil(amount * 0.75) : amount;
  state.compliance = Math.min(100, state.compliance + adj);
  render();
  if (state.compliance >= 70 && !state.auditPending) {
    state.auditPending = true;
    log("// COMPLIANCE HEAT CRITICAL. An Auditor has been dispatched.", "bad");
    playSFX("sfx_audit_alarm.mp3", 0.75);
  }
}

function runAuditIfDue() {
  if (!state.auditPending) return false;
  glitchScene();
  playSFX("sfx_audit_alarm.mp3", 0.8);
  log("// A Memory Auditor has arrived at your safehouse door.", "bad");

  // Spark augment: absorb one audit
  if (hasAug("spark") && state.augCharges.spark !== 0) {
    state.augCharges.spark = 0;
    state.auditPending = false;
    state.compliance = Math.max(0, state.compliance - 50);
    log("// SPARK ABSORBED the audit. The Auditor walks past your door.", "ok");
    render();
    return true;
  }

  const victims = state.memories.filter(m => !m.encrypted);
  if (victims.length === 0) {
    log("// Your stack is fully encrypted. The Auditor leaves empty-handed.", "ok");
    state.auditPending = false;
    state.compliance = Math.max(0, state.compliance - 40);
    render();
    return true;
  }
  victims.sort((a, b) => b.clarity - a.clarity);
  const target = victims[0];
  removeMemory(target.id);
  log(`// AUDITED: "${target.hook}" was overwritten. It is no longer yours.`, "bad");
  state.auditPending = false;
  state.compliance = Math.max(0, state.compliance - 50);
  render();
  return true;
}

// ---------- End of day ----------
function endDay() {
  let decayed = 0;
  state.memories.forEach(m => {
    if (m.encrypted) return;
    const resists = hasAug("empathy") && m.source === "Stolen";
    const chance = resists ? 0.15 : 0.35;
    if (Math.random() < chance) {
      m.clarity = Math.max(1, m.clarity - 1);
      decayed += 1;
    }
  });
  if (decayed > 0) log(`// ${decayed} memor${decayed === 1 ? "y" : "ies"} decayed overnight.`, "warn");

  runAuditIfDue();

  state.day += 1;
  log(`// DAY ${state.day}.`, "");
  autosave();
  enterSafehouse();
}

// ---------- Memory modal ----------
function openMemoryModal(m) {
  const modal = document.createElement("div");
  modal.className = "modal-back";
  // Special: inspecting the starter memory triggers the endgame reveal once.
  // Tagged explicitly on the seed at boot; the startsWith fallback is for saves
  // that predate the tag (so existing players don't lose the reveal).
  const isStarter = m.starter === true
    || m.hook.startsWith("The face of the woman who raised you");
  const modalImgSrc = m.image || hookImage(m.hook, m.emotion);
  modal.innerHTML = `
    <div class="modal">
      <h2>// MEMORY RECORD</h2>
      <div class="body">
        <div class="memory-polaroid ${m.synthetic ? 'synthetic' : ''}">
          <img src="${modalImgSrc}" alt="" onerror="this.onerror=null;this.src='data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';this.dataset.missing='1';">
          <div class="caption">"${escapeHtml(m.hook)}"</div>
        </div>
        <p style="color:var(--dim);font-size:12px;">
          EMOTION: <span class="emotion ${m.emotion}">${m.emotion}</span> ·
          CLARITY: ${m.clarity}/5 ·
          SOURCE: ${m.source}${m.synthetic ? " (SYNTHETIC)" : ""}${m.backdoor ? " · <span style='color:var(--audit)'>OMNI PING</span>" : ""}
        </p>
        <p style="color:var(--dim);font-size:12px;">Acquired Day ${m.day}. ${m.encrypted ? "Currently ENCRYPTED." : "Unsecured."}</p>
        ${isStarter && state.runsCompleted >= 3 && !state.flags.starterSeen ? '<p class="glitch" style="color:var(--neon-m);">The edges of this memory are too clean. Machine-clean.</p>' : ''}
      </div>
      <div class="actions">
        <button class="choice" data-act="encrypt" ${m.encrypted ? "disabled" : ""}>Encrypt at safehouse</button>
        <button class="choice" data-act="meditate">Re-live (clarity +1)</button>
        <button class="choice risk" data-act="delete">Burn memory</button>
        ${isStarter && state.runsCompleted >= 3 ? '<button class="choice" data-act="inspect" style="border-color:var(--neon-m);color:var(--neon-m);">Inspect its seams</button>' : ''}
        <button class="choice" data-act="close">Close</button>
      </div>
    </div>
  `;
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });
  modal.querySelectorAll("button[data-act]").forEach(b => {
    b.addEventListener("click", () => {
      const act = b.dataset.act;
      if (act === "close") { modal.remove(); return; }
      if (act === "encrypt") {
        if (state.location !== "safehouse") { log("// Can only encrypt at the safehouse.", "warn"); return; }
        const filler = state.memories.find(f => f.id !== m.id && !f.encrypted && f.clarity <= 2);
        if (!filler) {
          log("// No low-clarity cover memory available. Acquire filler first.", "warn");
          modal.remove();
          return;
        }
        removeMemory(filler.id);
        m.encrypted = true;
        log(`// Encrypted "${m.hook}" using "${filler.hook}" as cover.`, "ok");
        render();
      }
      if (act === "meditate") {
        if (m.clarity < 5) {
          m.clarity += 1;
          log(`// Re-lived. Clarity now ${m.clarity}.`, "ok");
          render();
        } else {
          log("// Already at maximum clarity.", "warn");
        }
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

// ---------- Vendors ----------
function openRipperdoc() {
  state.location = "ripperdoc";
  render();
  setScene({
    portrait: "duchess_rend.jpg",
    faction: "chromejaw",
    title: "// RIPPERDOC // BACK ALLEY",
    body: [
      "Grease and neon. The doc doesn't look up from her surgical lathe.",
      '"Pay in memory, not cred. You know how this works."'
    ],
    choices: [
      ...AUGMENTS.filter(a => !hasAug(a.id)).map(a => ({
        label: `${a.name} — pay ${a.cost.emotion} · Clarity ≥ ${a.cost.clarity}`,
        tag: a.effect,
        action: () => tryInstall(a)
      })),
      { label: "Leave", action: enterSafehouse }
    ]
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
  state.reputation.purity -= 1;
  openRipperdoc();
}

function openMnemonic() {
  state.location = "mnemonic";
  render();
  setScene({
    portrait: "mnemonic.jpg",
    faction: "mnemonic",
    title: "// MNEMONIC LAB // NEON-7",
    body: [
      "Glass walls. Patients floating in fluid, dreaming strangers' lives.",
      "The buyer will purchase a memory — but a synthetic copy returns, half-Clarity."
    ],
    choices: [
      ...state.memories.filter(m => !m.encrypted).map(m => ({
        label: `Sell "${m.hook.slice(0, 38)}${m.hook.length > 38 ? "…" : ""}"`,
        tag: `${m.emotion}·${m.clarity}`,
        action: () => sellMemory(m)
      })),
      { label: "Leave", action: enterSafehouse }
    ]
  });
}

function sellMemory(m) {
  removeMemory(m.id);
  state.reputation.mnemonic += 1;
  const synth = makeMemory({
    hook: `[COPY] ${m.hook}`,
    emotion: m.emotion,
    clarity: Math.max(1, Math.ceil(m.clarity / 2)),
    source: "Synthetic"
  });
  addMemory(synth);
  log(`// Sold "${m.hook}". Received synthetic echo.`, "lore");
  openMnemonic();
}

function openShadow() {
  state.location = "shadow";
  render();
  setScene({
    portrait: "archivist.jpg",
    faction: "shadow",
    title: "// THE SHADOW ARCHIVE",
    body: [
      "A candlelit backroom behind a noodle shop. An archivist in a hood logs every story into a tape deck older than you.",
      "Donations earn no credit. Only a place in the record."
    ],
    choices: [
      ...state.memories.filter(m => !m.encrypted).map(m => ({
        label: `Donate "${m.hook.slice(0, 40)}${m.hook.length > 40 ? "…" : ""}"`,
        tag: `${m.emotion}·${m.clarity}`,
        action: () => donateMemory(m)
      })),
      { label: "Leave", action: enterSafehouse }
    ]
  });
}

function donateMemory(m) {
  removeMemory(m.id);
  state.reputation.shadow += 2;
  state.compliance = Math.max(0, state.compliance - 8);
  log(`// Donated "${m.hook}" to the archive. Compliance heat drops slightly.`, "lore");
  openShadow();
}

function openGrey() {
  state.location = "grey";
  render();
  const tip = rand([
    "\"The Board of Nine met at 03:00. Only seven chairs were warm.\"",
    "\"Your safehouse's previous tenant was Compliance. Sweep again.\"",
    "\"The starter memory Omni issues new cores is always a maternal one. Always.\"",
    "\"Duchess Rend's monowire is keyed to her heartbeat. When she dies, it dies.\"",
    "\"Prophet Kael's chrome count has grown three points this quarter.\""
  ]);
  setScene({
    portrait: "lattice_ai.jpg",
    faction: "grey",
    voice: "tts_lattice.mp3",
    title: "// THE GREY FREQUENCY",
    body: [
      "Lattice's voice comes through warm static. It sounds more human every week.",
      `<span class="glitch">${tip}</span>`,
      "\"I won't give you more today. I know what you'd do with it.\""
    ],
    choices: [
      {
        label: "Trade an Awe·3+ memory for Compliance scrub",
        tag: "AWE",
        action: () => {
          const mem = state.memories.find(m => !m.encrypted && m.emotion === "Awe" && m.clarity >= 3);
          if (!mem) { log("// No Awe·3+ memory on offer.", "warn"); return; }
          removeMemory(mem.id);
          state.compliance = Math.max(0, state.compliance - 25);
          state.reputation.grey += 1;
          log("// Lattice absorbs the memory. Your Compliance ping drops.", "ok");
          openGrey();
        }
      },
      { label: "Leave", action: enterSafehouse }
    ]
  });
}

function openPurity() {
  state.location = "purity";
  render();
  const hypocriteLine = state.flags.kaelSuspect
    ? 'Prophet Kael smiles. You notice the seam above his ear that wasn\'t there yesterday.'
    : 'Prophet Kael blesses your unaugmented hands.';
  setScene({
    portrait: "kael.jpg",
    faction: "purity",
    voice: "tts_kael.mp3",
    title: "// PURITY TEMPLE // OLD CATHEDRAL",
    body: [
      "Candles. Unpainted wood. The smell of nobody's neural implants.",
      hypocriteLine
    ],
    choices: [
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
          log("// You prayed. The heat drops. Something clean.", "ok");
          openPurity();
        }
      },
      {
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
      },
      { label: "Leave", action: enterSafehouse }
    ]
  });
}

// ---------- Endgame ----------
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

// ---------- Save / Load ----------
function autosave() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (_) {}
}
function saveGame() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
    log("// SAVE written.", "ok");
  } catch (e) { log("// SAVE failed: " + e.message, "bad"); }
}
function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) { log("// No save found.", "warn"); return; }
    const loaded = JSON.parse(raw);
    state = Object.assign(freshState(), loaded);
    // Remove any ending screen
    document.querySelector(".ending-screen")?.remove();
    log("// SAVE loaded.", "ok");
    enterSafehouse();
  } catch (e) { log("// LOAD failed: " + e.message, "bad"); }
}
function resetGame() {
  // Preserve NG+ ledger across reset (it's the whole point of unlocks)
  try { localStorage.removeItem(SAVE_KEY); } catch (_) {}
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

// ---------- NG+ persistence ----------
function saveNGPlus(endingId) {
  try {
    const prior = readNGPlus();
    const endings = Array.from(new Set([...(prior.endings || []), endingId]));
    const payload = {
      endings,
      lastEnding: endingId,
      finalMemories: state.memories.map(m => ({
        hook: m.hook, emotion: m.emotion, clarity: m.clarity, source: m.source, day: m.day
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

// ---------- Archive mode (Archive ending replay) ----------
function enterArchiveMode() {
  state.location = "archive";
  render();
  const archived = readNGPlus().finalMemories || [];
  const hud = document.getElementById("hud");
  if (hud) hud.style.opacity = "0.35";

  setScene({
    portrait: "archivist.jpg",
    faction: "shadow",
    title: "// THE LIVING ARCHIVE",
    body: [
      "You are no longer a body in Gutter-9. You are a broadcast — played in a thousand safehouses, listened to by children who will never meet you.",
      "The Shadow keeps the lights on. You keep the memories moving. This is what you traded yourself for.",
      `<span class="hint">Below: the ${archived.length} memor${archived.length === 1 ? "y" : "ies"} that survived you. Click any one to relive it.</span>`
    ],
    choices: [
      ...archived.map((m, i) => ({
        label: `${m.hook.slice(0, 48)}${m.hook.length > 48 ? "…" : ""}`,
        tag: `${m.emotion}·${m.clarity}`,
        action: () => reliveArchivedMemory(m)
      })),
      {
        label: "Return to the world (leave archive mode)",
        tag: "EXIT",
        action: () => {
          if (hud) hud.style.opacity = "1";
          resetGame();
        }
      }
    ]
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
  setScene({
    portrait: "archivist.jpg",
    faction: "shadow",
    title: "// RELIVING",
    body: [
      `<span class="glitch">"${m.hook}"</span>`,
      `Emotion: ${m.emotion} · Clarity at preservation: ${m.clarity}/5`,
      vignettes[m.emotion] || ""
    ],
    choices: [{ label: "Back to the archive", action: enterArchiveMode }]
  });
}

// ---------- Pirate Radio ----------
const RADIO_STATIONS = {
  reso:      { file: "reso_late_show.mp3",  artist: "RESO // THE PIRATE VJ",     now: "The Sight · Live from a bunker below Gutter-9",   portrait: "reso_studio.jpg" },
  lattice:   { file: "lattice.mp3",         artist: "LATTICE // GREY FREQ",       now: "Transmission: on ethics, on memory, on refusing", portrait: "lattice.jpg" },
  omni:      { file: "omnicorp_psa.mp3",    artist: "OMNI-CORP // PSA",           now: "Clarity — because a quiet mind is a happy one",    portrait: "auditor.jpg" },
  mnemonic:  { file: "mnemonic.mp3",        artist: "MNEMONIC COLLECTIVE",        now: "Your next life is in our catalog. All sales final.", portrait: "mnemonic.jpg" },
  chromejaw: { file: "chromejaws.mp3",      artist: "CHROME-JAW // BLACK WIRE",   now: "Pirate market open. Bring cred, leave heavier.",   portrait: "duchess_rend.jpg" }
};

const radioState = { current: "reso", playing: false, muted: false };

function initRadio() {
  const toggle = $("#radio-toggle");
  const audio = $("#radio-audio");
  const radio = $("#radio");

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
  audio.volume = radioState.muted ? 0 : 0.55;
  audio.play().catch(() => {/* autoplay blocked, wait for user gesture */});
  $("#radio-now").innerHTML = `<span class="artist">${s.artist}</span><br>${s.now}`;
  $("#radio-portrait").src = `assets/images/${s.portrait}`;
  radioState.playing = true;
  log(`// RADIO: tuned ${s.artist}`, "lore");
}

function muteAll(mute) {
  radioState.muted = mute;
  const ra = $("#radio-audio");
  const ta = $("#title-audio");
  if (ra) ra.volume = mute ? 0 : 0.55;
  if (ta) ta.volume = mute ? 0 : 0.7;
}

// ---------- Title screen ----------
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

  const hasSave = !!localStorage.getItem(SAVE_KEY);
  $("#title-continue").disabled = !hasSave;
  if (!hasSave) {
    $("#title-continue").style.opacity = 0.35;
    $("#title-continue").style.cursor = "not-allowed";
  }

  $("#title-new").addEventListener("click", () => {
    try { localStorage.removeItem(SAVE_KEY); } catch (_) {}
    state = freshState();
    audio.pause();
    screen.classList.add("title-hidden");
    document.body.classList.remove("showing-title");
    stopMatrixRain();
    boot();
  });

  $("#title-continue").addEventListener("click", () => {
    if (!hasSave) return;
    audio.pause();
    screen.classList.add("title-hidden");
    document.body.classList.remove("showing-title");
    stopMatrixRain();
    loadGame();
  });

  $("#title-mute").addEventListener("click", () => {
    radioState.muted = !radioState.muted;
    muteAll(radioState.muted);
    audio.muted = radioState.muted;
    _bgmEl.muted = radioState.muted;
    $("#title-mute").textContent = radioState.muted ? "♪ UNMUTE" : "♪ MUTE";
  });

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

// ---------- Daily events ----------
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
            log("// The kid smiles. You didn't pay cred. You paid presence.", "ok");
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
            log("// They noted the refusal in ink you can't see.", "bad");
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

// ---------- Chrome-Jaws War Arc ----------
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

// ---------- Boot ----------
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

// ---------- Intro cinematic player ----------
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
  $("#btn-save").addEventListener("click", saveGame);
  $("#btn-load").addEventListener("click", loadGame);
  $("#btn-reset").addEventListener("click", () => {
    if (confirm("Reset all progress?")) resetGame();
  });
  $("#btn-help").addEventListener("click", openGlossary);
  initTooltips();
  initTitle();

  // Global ESC: close the topmost dismissible modal. Modals can opt out by
  // setting data-no-escape="true" (used by the endgame door modal where a
  // choice is required). The intro video has its own ESC/SPACE handler —
  // we skip while it's visible so we don't double-fire.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const intro = document.getElementById("intro-video-screen");
    if (intro && intro.style.display && intro.style.display !== "none") return;
    const modals = document.querySelectorAll(".modal-back");
    if (modals.length === 0) return;
    const top = modals[modals.length - 1];
    if (top.dataset.noEscape === "true") return;
    top.remove();
  });
});
