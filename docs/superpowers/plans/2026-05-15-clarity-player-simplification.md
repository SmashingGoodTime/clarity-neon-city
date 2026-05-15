# CLARITY Player Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make CLARITY's first-run player experience feel like a clear memory-heist loop with optional depth instead of a dashboard of every system.

**Architecture:** Keep the existing static HTML/CSS/vanilla JS structure. Add small player-facing helper seams in `game.js`, then route the safehouse, contract board, heat display, onboarding, and toolbar through those seams without rewriting contract arcs, saves, endings, audio, or memory generation.

**Tech Stack:** Vanilla JavaScript, static HTML, CSS, browser `localStorage`, Node.js for lightweight file-content smoke checks.

---

## Files

- Modify: `game.js`
  - Add helper seams for safehouse choices, market entry, memory management, contract posting selection, heat labels, lead prioritization, and first-run event gating.
  - Keep existing vendor functions, contract arcs, save/load, endings, audio, and memory generation intact.
- Modify: `index.html`
  - Simplify toolbar buttons and bump cache query strings after JS/CSS changes.
- Modify: `style.css`
  - Style simplified heat labels and any new toolbar "More" button behavior.
- Create: `tools/player_simplification_checks.mjs`
  - Static smoke checks that fail before each task's implementation and pass after.

## Task 1: Safehouse And Market Entry

**Files:**
- Create: `tools/player_simplification_checks.mjs`
- Modify: `game.js`

- [ ] **Step 1: Write the failing smoke checks**

Create `tools/player_simplification_checks.mjs`:

```js
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const game = fs.readFileSync(path.join(root, "game.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

function assertContains(source, needle, label) {
  if (!source.includes(needle)) {
    throw new Error(`${label}: missing ${needle}`);
  }
}

function assertNotContains(source, needle, label) {
  if (source.includes(needle)) {
    throw new Error(`${label}: still contains ${needle}`);
  }
}

assertContains(game, "function renderSafehouseScene()", "safehouse scene helper");
assertContains(game, "function safehouseChoices()", "safehouse choices helper");
assertContains(game, 'label: "Take a Contract"', "safehouse contract action");
assertContains(game, 'label: "Manage Memories"', "safehouse memory action");
assertContains(game, 'label: "Visit the Market"', "safehouse market action");
assertContains(game, 'label: "Sleep"', "safehouse sleep action");
assertContains(game, 'label: "Help"', "safehouse help action");
assertContains(game, "function openMarket()", "market entry scene");
assertContains(game, "const MARKET_ENTRIES", "market entry definitions");
assertContains(game, "function openManageMemories()", "memory management scene");
assertNotContains(game, 'label: "Visit the Ripperdoc"', "old safehouse vendor action");
assertNotContains(game, 'label: "Route through Mnemonic Lab"', "old safehouse vendor action");
assertNotContains(game, 'label: "Drop off at The Shadow Archive"', "old safehouse vendor action");
assertContains(html, '<button id="btn-help"', "help button remains available");

console.log("player simplification checks passed");
```

- [ ] **Step 2: Run the smoke checks and verify they fail**

Run:

```bash
node tools/player_simplification_checks.mjs
```

Expected: FAIL with a missing `function renderSafehouseScene()` error.

- [ ] **Step 3: Add safehouse and market helper seams**

In `game.js`, add this block immediately before `function enterSafehouse()`:

```js
function hasAnyMemory() {
  return state.memories.length > 0;
}

function marketIsUseful() {
  return hasAnyMemory()
    || state.reputation.grey >= 2
    || hasAug("ice")
    || state.reputation.purity >= 1
    || state.day >= 2;
}

function safehouseBody() {
  const heat = typeof heatState === "function" ? heatState(state.compliance) : null;
  const heatLine = heat && heat.label !== "LOW"
    ? `Omni heat is ${heat.label.toLowerCase()}. Secure what matters before sleep.`
    : "Gutter-9 is quiet. For now.";
  return [
    "Rain drums on the corrugated roof. A dozen tiny red LEDs blink from the deck on your workbench.",
    heatLine
  ];
}

function safehouseChoices() {
  return [
    { label: "Take a Contract", tag: "RUN", action: openContractBoard },
    {
      label: "Manage Memories",
      tag: "MEMORY",
      action: openManageMemories,
      disabled: () => !hasAnyMemory(),
      tip: "Run a contract first. You need at least one memory to manage."
    },
    {
      label: "Visit the Market",
      tag: "MARKET",
      action: openMarket,
      disabled: () => !marketIsUseful(),
      tip: "The Market opens after you have a memory, a contact, or a little time in the city."
    },
    { label: "Sleep", tag: "END DAY", action: endDay },
    { label: "Help", tag: "INFO", action: openGlossary }
  ];
}

function renderSafehouseScene() {
  setScene({
    title: `DAY ${String(state.day).padStart(2, "0")} // SAFEHOUSE`,
    body: safehouseBody(),
    choices: safehouseChoices()
  });
}

function openManageMemories() {
  if (!hasAnyMemory()) {
    log("// Your stack is empty. Take a contract first.", "warn");
    return;
  }
  const choices = state.memories
    .slice()
    .sort((a, b) => b.clarity - a.clarity)
    .slice(0, 6)
    .map(m => ({
      label: `Inspect "${shortHook(m.hook, 38)}"`,
      tag: `${m.emotion} ${m.clarity}`,
      action: () => openMemoryModal(m)
    }));
  choices.push({ label: "Back", action: enterSafehouse });
  setScene({
    title: "// MEMORY CARE",
    body: [
      "Your stack flickers across the workbench.",
      "Inspect a memory to re-live, encrypt, or burn it. Encrypted memories survive audits and do not decay."
    ],
    choices
  });
}

const MARKET_ENTRIES = [
  {
    label: "Ripperdoc - buy chrome",
    tag: "SPEND",
    action: openRipperdoc,
    disabled: () => !hasAnyMemory() || (state.flags.chromeWarActive && !state.flags.chromeWarResolved),
    tip: "Chrome costs memories. The Ripperdoc is unavailable during an active Chrome-Jaws war."
  },
  {
    label: "Mnemonic Lab - sell or copy memories",
    tag: "TRADE",
    action: openMnemonic,
    disabled: () => !hasAnyMemory(),
    tip: "Mnemonic needs an unsecured memory to buy or copy."
  },
  {
    label: "Shadow Archive - donate memories",
    tag: "LORE",
    action: openShadow,
    disabled: () => !hasAnyMemory(),
    tip: "The Shadow needs an unsecured memory to archive."
  },
  {
    label: "Grey Frequency - scrub heat",
    tag: "INFO",
    action: openGrey,
    disabled: () => state.reputation.grey < 2 && !hasAug("ice"),
    tip: "Earn Grey trust or install ICE-piercer to reach Lattice."
  },
  {
    label: "Purity Temple - pray heat down",
    tag: "FAITH",
    action: openPurity,
    disabled: () => state.reputation.purity < 1 && state.day < 2,
    tip: "The Temple opens after the first night or when Purity notices you."
  }
];

function openMarket() {
  const choices = MARKET_ENTRIES.map(entry => ({ ...entry }));
  choices.push({ label: "Back", action: enterSafehouse });
  setScene({
    title: "// GUTTER-9 MARKET",
    body: [
      "A single alley splits into five kinds of trouble.",
      "Pick a contact when you need one. Ignore the rest until the city gives you a reason."
    ],
    choices
  });
}
```

- [ ] **Step 4: Route both safehouse entry points through the helper**

Replace the final `setScene(...)` block inside `enterSafehouse()` with:

```js
  renderSafehouseScene();
```

Replace the entire `enterSafehouseAfterEvent()` body with:

```js
function enterSafehouseAfterEvent() {
  state.location = "safehouse";
  render();
  renderSafehouseScene();
}
```

- [ ] **Step 5: Run the smoke checks and verify they pass**

Run:

```bash
node tools/player_simplification_checks.mjs
```

Expected: PASS with `player simplification checks passed`.

- [ ] **Step 6: Commit Task 1**

```bash
git add game.js tools/player_simplification_checks.mjs
git commit -m "Simplify Clarity safehouse entry"
```

## Task 2: Contract Board Focus

**Files:**
- Modify: `tools/player_simplification_checks.mjs`
- Modify: `game.js`

- [ ] **Step 1: Extend the smoke checks**

Append these checks to `tools/player_simplification_checks.mjs` before the final `console.log(...)`:

```js
assertContains(game, "function primaryContractPostings(available)", "primary contract selector");
assertContains(game, "const STORY_CONTRACT_IDS", "story contract list");
assertContains(game, "primaryContractPostings(available)", "contract board uses selector");
assertContains(game, "Only the clearest jobs are lit.", "simplified contract board copy");
assertNotContains(game, "...locked.map(c => ({", "locked contract choices removed");
```

- [ ] **Step 2: Run the smoke checks and verify they fail**

Run:

```bash
node tools/player_simplification_checks.mjs
```

Expected: FAIL with a missing `function primaryContractPostings(available)` error.

- [ ] **Step 3: Add focused posting selection**

In `game.js`, add this block above `function openContractBoard()`:

```js
const STORY_CONTRACT_IDS = [
  "purity_cleanse",
  "lattice_data_theft",
  "purity_spy_ring",
  "omni_sabotage",
  "compliance_heist",
  "droidboy_rankclimb"
];

function primaryContractPostings(available) {
  const picked = [];
  const add = (contract) => {
    if (contract && !picked.some(c => c.id === contract.id)) picked.push(contract);
  };

  add(available.find(c => effectiveCompliance(c.compliance, c) <= 10));
  add(available.find(c => effectiveCompliance(c.compliance, c) > 10));
  add(available.find(c => STORY_CONTRACT_IDS.includes(c.id)));

  available.forEach(add);
  return picked.slice(0, 3);
}

function nextLockedContractHint(locked) {
  const c = locked.find(item => gateReason(item));
  if (!c) return "";
  return `A dim posting flickers behind the board: ${contractTitle(c)} - ${gateReason(c)}.`;
}
```

- [ ] **Step 4: Replace the contract board presentation**

Inside `openContractBoard()`, replace the `available`, `locked`, and `setScene(...)` section with:

```js
  const available = CONTRACTS.filter(c => c.gate());
  const locked = CONTRACTS.filter(c => !c.gate() && gateReason(c));
  const postings = primaryContractPostings(available);
  const todayMod = dailyContractModifier("board");
  const lockedHint = nextLockedContractHint(locked);
  setScene({
    title: "// CONTRACT BOARD",
    body: [
      "Only the clearest jobs are lit.",
      "Pick one run. Bring back a memory. Deal with the heat after.",
      `<span class="hint">${todayMod.label}: ${todayMod.text}</span>`,
      lockedHint ? `<span class="hint">${lockedHint}</span>` : ""
    ].filter(Boolean),
    choices: [
      ...postings.map(c => ({
        label: contractBoardLabel(c),
        tag: `HEAT +${effectiveCompliance(c.compliance, c)}`,
        action: () => startContract(c)
      })),
      { label: "Back", action: enterSafehouse }
    ]
  });
```

- [ ] **Step 5: Run the smoke checks and verify they pass**

Run:

```bash
node tools/player_simplification_checks.mjs
```

Expected: PASS with `player simplification checks passed`.

- [ ] **Step 6: Commit Task 2**

```bash
git add game.js tools/player_simplification_checks.mjs
git commit -m "Focus Clarity contract board"
```

## Task 3: Heat Labels, Case Board, And Early Event Gating

**Files:**
- Modify: `tools/player_simplification_checks.mjs`
- Modify: `game.js`
- Modify: `style.css`

- [ ] **Step 1: Extend the smoke checks**

Append these checks to `tools/player_simplification_checks.mjs` before the final `console.log(...)`:

```js
const css = fs.readFileSync(path.join(root, "style.css"), "utf8");

assertContains(game, "function heatState(value = state.compliance)", "heat state helper");
assertContains(game, "LOW", "low heat label");
assertContains(game, "RISING", "rising heat label");
assertContains(game, "DANGEROUS", "dangerous heat label");
assertContains(game, "const SIMPLIFIED_LEAD_LIMIT = 3", "case board lead limit");
assertContains(game, "function dailyEventsUnlocked()", "daily event gate");
assertContains(game, "function chromeWarUnlocked()", "chrome war gate");
assertContains(css, "#audit-tier-readout.heat-low", "low heat style");
assertContains(css, "#audit-tier-readout.heat-rising", "rising heat style");
assertContains(css, "#audit-tier-readout.heat-dangerous", "dangerous heat style");
assertNotContains(game, "COMPLIANCE WATCHER dispatched", "old watcher log copy removed");
assertNotContains(game, "COMPLIANCE AUDITOR dispatched", "old auditor log copy removed");
assertNotContains(game, "COMPLIANCE ENFORCEMENT engaged", "old enforcement log copy removed");
```

- [ ] **Step 2: Run the smoke checks and verify they fail**

Run:

```bash
node tools/player_simplification_checks.mjs
```

Expected: FAIL with a missing `function heatState(value = state.compliance)` error.

- [ ] **Step 3: Add heat and event helper functions**

In `game.js`, add this block above `function renderHud()`:

```js
function heatState(value = state.compliance) {
  if (state.auditPending || value >= 70) {
    return {
      label: "DANGEROUS",
      className: "heat-dangerous",
      copy: "Sleep may cost unsecured memories."
    };
  }
  if (value >= 35) {
    return {
      label: "RISING",
      className: "heat-rising",
      copy: "Omni is paying attention."
    };
  }
  return {
    label: "LOW",
    className: "heat-low",
    copy: "Omni has not locked on."
  };
}

function dailyEventsUnlocked() {
  return state.day >= 3 && state.runsCompleted >= 2;
}

function chromeWarUnlocked() {
  return !state.flags.chromeWarActive
    && state.reputation.mnemonic >= 6
    && state.runsCompleted >= 5;
}
```

- [ ] **Step 4: Update HUD heat copy**

Inside `renderHud()`, replace the current `tierEl` block with:

```js
  const tierEl = document.getElementById("audit-tier-readout");
  if (tierEl) {
    const heat = heatState(state.compliance);
    tierEl.textContent = heat.label;
    tierEl.className = "sub audit-tier " + heat.className;
    tierEl.setAttribute("data-tip", heat.copy);
  }
```

- [ ] **Step 5: Update compliance escalation logs**

Inside `complianceTick(amount)`, replace the `if (newTier > prevTier) { ... }` body with:

```js
  if (newTier > prevTier) {
    state.auditTier = newTier;
    state.auditPending = newTier >= 1;
    sensoryFlash("audit");
    const heat = heatState(state.compliance);
    log(`// OMNI HEAT ${heat.label}. ${heat.copy}`, newTier >= 2 ? "bad" : "warn");
    if (newTier >= 2) playSFX("sfx_audit_alarm.mp3", newTier === 3 ? 1.0 : 0.75);
  }
```

- [ ] **Step 6: Reduce case board density**

In `game.js`, add this constant above `function renderCaseBoard()`:

```js
const SIMPLIFIED_LEAD_LIMIT = 3;
```

Change this line in `renderCaseBoard()`:

```js
  const leads = caseBoardLeads().slice(0, 5);
```

to:

```js
  const leads = caseBoardLeads().slice(0, SIMPLIFIED_LEAD_LIMIT);
```

Inside `caseBoardLeads()`, change the audit lead block to use heat language:

```js
  if (state.auditPending || state.auditTier > 0) {
    const tier = state.auditTier || computeAuditTier(state.compliance);
    const victims = auditPriority(memories.filter(m => !m.encrypted));
    const lossCount = tier >= 3 ? Math.max(1, Math.ceil(victims.length / 2))
                    : tier === 2 ? Math.min(2, victims.length)
                    : Math.min(1, victims.length);
    leads.push({
      kind: "HEAT",
      tone: "risk",
      text: victims.length
        ? `Sleep may cost ${lossCount} unsecured memory${lossCount === 1 ? "" : "ies"}. First at risk: ${shortHook(victims[0].hook)}.`
        : "Heat is dangerous, but every memory is secured."
    });
  } else if (state.compliance >= 35) {
    leads.push({
      kind: "HEAT",
      tone: "risk",
      text: `Omni heat is ${state.compliance}%. Secure key memories before it spikes.`
    });
  }
```

Change the later lead additions so advanced optimization waits until the player has a few runs:

```js
  const nextContract = state.runsCompleted >= 1 ? nextLockedContractLead() : null;
  if (nextContract) leads.push(nextContract);

  const vendorLead = state.runsCompleted >= 3 ? nextVendorTrustLead(trust) : null;
  if (vendorLead) leads.push(vendorLead);

  const memoryLead = state.runsCompleted >= 3 ? nextMemoryGoalLead() : null;
  if (memoryLead) leads.push(memoryLead);
```

- [ ] **Step 7: Gate early daily events and Chrome war**

In `enterSafehouse()`, replace the Chrome-Jaws trigger condition with:

```js
  if (chromeWarUnlocked()) {
```

In `enterSafehouse()`, replace the daily event condition with:

```js
  if (dailyEventsUnlocked() && state.flags.lastEventDay !== state.day && Math.random() < 0.55) {
```

- [ ] **Step 8: Update heat CSS**

In `style.css`, replace the three `#audit-tier-readout.tier-*` rules with:

```css
#audit-tier-readout.heat-low { color: #9fdcff; text-shadow: 0 0 4px #9fdcff66; }
#audit-tier-readout.heat-rising { color: #ffcc66; text-shadow: 0 0 5px #ffcc6688; }
#audit-tier-readout.heat-dangerous { color: #ff6464; text-shadow: 0 0 8px #ff646499; animation: tier3Pulse 1.2s steps(2) infinite; }
```

- [ ] **Step 9: Run the smoke checks and verify they pass**

Run:

```bash
node tools/player_simplification_checks.mjs
```

Expected: PASS with `player simplification checks passed`.

- [ ] **Step 10: Commit Task 3**

```bash
git add game.js style.css tools/player_simplification_checks.mjs
git commit -m "Simplify Clarity heat and lead messaging"
```

## Task 4: First-Run Help And Advanced Toolbar

**Files:**
- Modify: `tools/player_simplification_checks.mjs`
- Modify: `game.js`
- Modify: `index.html`
- Modify: `style.css`

- [ ] **Step 1: Extend the smoke checks**

Append these checks to `tools/player_simplification_checks.mjs` before the final `console.log(...)`:

```js
assertContains(game, "function openToolsMenu()", "advanced tools menu");
assertContains(game, "FIRST RUN", "first run help section");
assertContains(game, "Advanced systems", "advanced help section");
assertContains(html, '<button id="btn-more"', "more button in toolbar");
assertNotContains(html, 'id="btn-history"', "history removed from main toolbar");
assertNotContains(html, 'id="btn-export"', "export removed from main toolbar");
assertNotContains(html, 'id="btn-reset"', "reset removed from main toolbar");
assertContains(html, "style.css?v=31", "css cache bust bumped");
assertContains(html, "game.js?v=31", "js cache bust bumped");
```

- [ ] **Step 2: Run the smoke checks and verify they fail**

Run:

```bash
node tools/player_simplification_checks.mjs
```

Expected: FAIL with a missing `function openToolsMenu()` error.

- [ ] **Step 3: Simplify the orientation copy**

In `showOrientation()`, replace the `body` array with:

```js
    body: [
      "Rain has been falling for seven years. The city breathes steam and advertising jingles you never asked to learn.",
      '<span class="glitch">FIRST RUN: keep it simple.</span>',
      '<strong>Take contracts.</strong> Runs bring back memories and raise Omni heat.',
      '<strong>Memories are your inventory.</strong> Emotion decides what they can buy. Clarity shows how strong they are.',
      '<strong>Secure what matters.</strong> High heat can strip unsecured memories when you sleep.',
      '<strong>Sleep moves the city.</strong> Run, manage the stack, visit the Market when you need it, then rest.',
      '<span class="hint">The deeper systems will surface when they matter.</span>'
    ],
```

- [ ] **Step 4: Simplify the glossary top section**

In `openGlossary()`, replace the modal body between `<div class="body"...>` and the close button with:

```html
        <h3 class="gl-h">FIRST RUN</h3>
        <p><b>Take a Contract</b>, bring back memories, manage Omni heat, then <b>Sleep</b>. That loop is the game.</p>

        <h3 class="gl-h">MEMORIES</h3>
        <p>Your inventory is made of things that happened to you. Click a memory to re-live, encrypt, or burn it.</p>
        <ul class="gl-list">
          <li><b>Emotion</b> - Joy / Fear / Rage / Awe / Grief. Vendors ask for different emotions.</li>
          <li><b>Clarity</b> - 1 to 5. Higher clarity is more valuable and more tempting to auditors.</li>
          <li><b>Security</b> - encrypted memories survive audits and do not decay.</li>
        </ul>

        <h3 class="gl-h">HEAT</h3>
        <p>Compliance is Omni-Corp's attention. When heat is dangerous, sleeping may cost unsecured memories.</p>

        <h3 class="gl-h">MARKET</h3>
        <p>The Market holds the deeper systems: chrome, memory sales, the Shadow archive, Lattice, and Purity. Use it when the main loop gives you a reason.</p>

        <h3 class="gl-h">Advanced systems</h3>
        <p>Faction standing, vendor trust, memory tags, endings, and New Game+ still exist. They surface through contracts, leads, and the Market after the first few days.</p>

        <h3 class="gl-h">KEYS</h3>
        <p><b>1-9</b> choose visible actions. <b>H</b> opens Help. <b>M</b> toggles mute. <b>G</b> toggles Sight. <b>Ctrl+S</b> saves. <b>Ctrl+L</b> loads.</p>
```

- [ ] **Step 5: Move advanced toolbar actions into a More menu**

In `index.html`, replace the toolbar block with:

```html
  <div id="toolbar" role="toolbar" aria-label="Game actions">
    <button id="btn-help" class="tool-btn" data-tip="Open quick help. (H)" aria-label="Open help">? HELP</button>
    <button id="btn-sight" class="tool-btn" data-tip="Toggle Reso's Sight overlay. (G)" aria-label="Toggle Sight mode">SIGHT</button>
    <button id="hud-mute" class="tool-btn" data-tip="Mute all audio. (M)" aria-label="Toggle audio mute">MUTE</button>
    <button id="btn-save" class="tool-btn" data-tip="Save to a slot. Ctrl+S quicksaves." aria-label="Save game">SAVE</button>
    <button id="btn-load" class="tool-btn" data-tip="Load from a slot. Ctrl+L quickloads." aria-label="Load game">LOAD</button>
    <button id="btn-more" class="tool-btn" data-tip="History, export/import, and reset." aria-label="More tools">MORE</button>
  </div>
```

Also bump asset query strings in `index.html`:

```html
<link rel="stylesheet" href="style.css?v=31">
<script src="game.js?v=31"></script>
```

- [ ] **Step 6: Add the More menu function**

In `game.js`, add this function above `document.addEventListener("DOMContentLoaded", ...)`:

```js
function openToolsMenu() {
  const modal = document.createElement("div");
  modal.className = "modal-back";
  modal.innerHTML = `
    <div class="modal" style="max-width:520px;">
      <h2>// MORE TOOLS</h2>
      <div class="body">
        <p>Utility tools live here so the main toolbar stays focused on play.</p>
      </div>
      <div class="actions">
        <button class="choice" id="tools-history">Run History</button>
        <button class="choice" id="tools-export">Export / Import Save</button>
        <button class="choice danger" id="tools-reset">Reset Slot</button>
        <button class="choice" id="tools-close">Close</button>
      </div>
    </div>
  `;
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });
  modal.querySelector("#tools-history").addEventListener("click", () => { modal.remove(); openRunHistoryModal(); });
  modal.querySelector("#tools-export").addEventListener("click", () => { modal.remove(); openExportImportModal(); });
  modal.querySelector("#tools-reset").addEventListener("click", () => {
    modal.remove();
    if (confirm("Reset progress in the active save slot?")) resetGame();
  });
  modal.querySelector("#tools-close").addEventListener("click", () => modal.remove());
  $("#modal-root").appendChild(modal);
}
```

- [ ] **Step 7: Rewire toolbar event listeners**

In `document.addEventListener("DOMContentLoaded", ...)`, replace:

```js
  $("#btn-history").addEventListener("click", openRunHistoryModal);
  $("#btn-export").addEventListener("click", openExportImportModal);
  $("#btn-reset").addEventListener("click", () => {
    if (confirm("Reset progress in the active save slot?")) resetGame();
  });
```

with:

```js
  $("#btn-more").addEventListener("click", openToolsMenu);
```

- [ ] **Step 8: Run the smoke checks and verify they pass**

Run:

```bash
node tools/player_simplification_checks.mjs
```

Expected: PASS with `player simplification checks passed`.

- [ ] **Step 9: Commit Task 4**

```bash
git add game.js index.html style.css tools/player_simplification_checks.mjs
git commit -m "Simplify Clarity onboarding and toolbar"
```

## Task 5: Browser Verification

**Files:**
- No source edits unless verification exposes a concrete defect.

- [ ] **Step 1: Start a local static server**

Run from `D:\CLAUDE\Game Universe\Neon City\Clarity`:

```bash
python -m http.server 8000
```

Expected: server starts at `http://localhost:8000`.

- [ ] **Step 2: Open a fresh run**

Open `http://localhost:8000` in the browser. Use a fresh profile, private window, or clear `localStorage` for this origin.

Expected:
- Title screen loads.
- New run reaches the simplified orientation.
- Safehouse choices are exactly: Take a Contract, Manage Memories, Visit the Market, Sleep, Help.

- [ ] **Step 3: Verify first contract flow**

Click `Take a Contract`.

Expected:
- The board shows no more than three contract choices plus Back.
- Copy says "Only the clearest jobs are lit."
- Locked contracts appear only as a short hint, not as disabled choice rows.

- [ ] **Step 4: Complete one contract and manage memory**

Finish any visible contract. Return to the safehouse. Click `Manage Memories`.

Expected:
- The memory scene lists inspectable memories.
- Selecting one opens the existing memory modal.
- Existing memory actions still work.

- [ ] **Step 5: Verify Market access**

Click `Visit the Market`.

Expected:
- Market opens one scene with Ripperdoc, Mnemonic, Shadow, Grey, and Purity entries.
- Old vendor scenes remain reachable.
- Disabled entries explain why they are unavailable.

- [ ] **Step 6: Verify heat messaging**

Use contracts or console state edits to raise compliance past 35 and 70.

Expected:
- HUD heat label shows LOW, RISING, or DANGEROUS.
- Case board focuses on the risk of sleeping with unsecured memories.
- Old Watcher/Auditor/Enforcement labels do not dominate early UI.

- [ ] **Step 7: Verify advanced tools**

Click `MORE`.

Expected:
- Run History opens from the More modal.
- Export / Import Save opens from the More modal.
- Reset Slot still asks for confirmation.
- Main toolbar remains focused: Help, Sight, Mute, Save, Load, More.

- [ ] **Step 8: Verify existing saves still load**

Use the Load button on any existing slot.

Expected:
- Existing saves migrate normally.
- Safehouse still uses the simplified choices.
- Existing memories, reputations, augments, and unlocked endings are preserved.

- [ ] **Step 9: Run final smoke checks**

Run:

```bash
node tools/player_simplification_checks.mjs
```

Expected: PASS with `player simplification checks passed`.

- [ ] **Step 10: Commit verification fixes or close**

If verification required source edits:

```bash
git add game.js index.html style.css tools/player_simplification_checks.mjs
git commit -m "Fix Clarity simplification verification issues"
```

If verification required no source edits, do not create an empty commit.

## Plan Self-Review

Spec coverage:
- Safehouse action list: Task 1.
- Contract board presentation: Task 2.
- Vendor entry flow: Task 1.
- Case board lead selection: Task 3.
- Audit and compliance copy: Task 3.
- First-run glossary/orientation copy: Task 4.
- Toolbar priority: Task 4.
- Daily events and Chrome-Jaws war de-emphasis: Task 3.
- Manual first-run and save verification: Task 5.

Placeholder scan:
- The plan contains no open-ended implementation gaps.
- Each source-editing task includes exact code or exact replacement snippets.

Type consistency:
- New helper names are consistent across tasks: `renderSafehouseScene`, `safehouseChoices`, `openManageMemories`, `MARKET_ENTRIES`, `openMarket`, `primaryContractPostings`, `heatState`, `dailyEventsUnlocked`, `chromeWarUnlocked`, and `openToolsMenu`.
