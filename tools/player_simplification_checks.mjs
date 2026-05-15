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

function assertFunctionContains(source, name, needle, label) {
  const signature = `function ${name}(`;
  const start = source.indexOf(signature);
  if (start === -1) {
    throw new Error(`${label}: missing ${signature}`);
  }
  const next = source.indexOf("\nfunction ", start + signature.length);
  const body = source.slice(start, next === -1 ? source.length : next);
  assertContains(body, needle, label);
}

function assertFunctionNotContains(source, name, needle, label) {
  const signature = `function ${name}(`;
  const start = source.indexOf(signature);
  if (start === -1) {
    throw new Error(`${label}: missing ${signature}`);
  }
  const next = source.indexOf("\nfunction ", start + signature.length);
  const body = source.slice(start, next === -1 ? source.length : next);
  assertNotContains(body, needle, label);
}

function assertStoryPriorityOutranks(source, highValueId, lowValueId) {
  const match = source.match(/const STORY_CONTRACT_PRIORITY = \{([\s\S]*?)\};/);
  if (!match) {
    throw new Error("story priority fixture: missing STORY_CONTRACT_PRIORITY");
  }
  const valueFor = (id) => {
    const idMatch = match[1].match(new RegExp(`${id}:\\s*(\\d+)`));
    if (!idMatch) throw new Error(`story priority fixture: missing ${id}`);
    return Number(idMatch[1]);
  };
  if (valueFor(highValueId) <= valueFor(lowValueId)) {
    throw new Error(`story priority fixture: expected ${highValueId} to outrank ${lowValueId}`);
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
assertContains(game, "function returnToSafehouseMenu()", "safehouse local return helper");
assertContains(game, "function guardedOpenMarket()", "safehouse market guard");
assertContains(game, "function guardedOpenRipperdoc()", "market ripperdoc guard");
assertContains(game, "function guardedOpenMnemonic()", "market mnemonic guard");
assertContains(game, "function guardedOpenShadow()", "market shadow guard");
assertContains(game, "function guardedOpenGrey()", "market grey guard");
assertContains(game, "function guardedOpenPurity()", "market purity guard");
assertContains(game, "action: guardedOpenMarket", "safehouse market guarded action");
assertContains(game, "action: guardedOpenRipperdoc", "market ripperdoc guarded action");
assertContains(game, "action: guardedOpenMnemonic", "market mnemonic guarded action");
assertContains(game, "action: guardedOpenShadow", "market shadow guarded action");
assertContains(game, "action: guardedOpenGrey", "market grey guarded action");
assertContains(game, "action: guardedOpenPurity", "market purity guarded action");
assertContains(game, 'choices.push({ label: "Back", action: returnToSafehouseMenu });', "safehouse submenus local back action");
assertFunctionContains(game, "enterSafehouse", "renderSafehouseScene();", "safehouse entry render route");
assertFunctionContains(game, "enterSafehouseAfterEvent", "renderSafehouseScene();", "post-event safehouse render route");
assertNotContains(game, 'label: "Visit the Ripperdoc"', "old safehouse vendor action");
assertNotContains(game, 'label: "Route through Mnemonic Lab"', "old safehouse vendor action");
assertNotContains(game, 'label: "Drop off at The Shadow Archive"', "old safehouse vendor action");
assertNotContains(game, 'label: "Ping the Grey Frequency"', "old safehouse vendor action");
assertNotContains(game, 'label: "Visit the Purity Temple"', "old safehouse vendor action");
assertContains(html, '<button id="btn-help"', "help button remains available");
assertContains(game, "function primaryContractPostings(available)", "primary contract selector");
assertContains(game, "const STORY_CONTRACT_IDS", "story contract list");
assertContains(game, "primaryContractPostings(available)", "contract board uses selector");
assertContains(game, "Only the clearest jobs are lit.", "simplified contract board copy");
assertNotContains(game, "...locked.map(c => ({", "locked contract choices removed");
assertContains(game, "function storyContractPriority(c)", "story contract priority helper");
assertFunctionContains(game, "primaryContractPostings", "storyContractPriority(b) - storyContractPriority(a)", "primary selector sorts by story priority");
assertNotContains(game, "available.find(c => STORY_CONTRACT_IDS.includes(c.id))", "old first-story selector removed");
assertContains(game, "function storyContractExhausted(c)", "story contract exhaustion helper");
assertFunctionContains(game, "storyContractPriority", "storyContractExhausted(c)", "story priority uses exhaustion helper");
assertFunctionContains(game, "storyContractExhausted", 'case "droidboy_rankclimb"', "droidboy exhaustion special case");
assertFunctionContains(game, "storyContractExhausted", "(state.flags.droidBoyRank || 0) >= 3", "droidboy rank climb exhausts only at rank 3");
assertFunctionNotContains(game, "storyContractPriority", "completedContractIds().includes(c.id)", "blanket completed-story demotion removed");
assertNotContains(game, "completed ? -100", "blanket completed penalty removed");
assertFunctionContains(game, "primaryContractPostings", "const nonStory = available.filter(c => !STORY_CONTRACT_IDS.includes(c.id));", "primary selector separates non-story contracts");
assertFunctionContains(game, "primaryContractPostings", "storyCandidates.slice(0, 2).forEach(add);", "primary selector adds two story candidates first");
assertFunctionContains(game, "primaryContractPostings", "add(nonStory.find(c => effectiveCompliance(c.compliance, c) <= 10));", "primary selector low-risk filler uses non-story");
assertFunctionContains(game, "primaryContractPostings", "add(nonStory.find(c => effectiveCompliance(c.compliance, c) > 10));", "primary selector high-risk filler uses non-story");
assertStoryPriorityOutranks(game, "droidboy_rankclimb", "purity_cleanse");
assertStoryPriorityOutranks(game, "compliance_heist", "purity_cleanse");
assertStoryPriorityOutranks(game, "omni_sabotage", "purity_cleanse");

console.log("player simplification checks passed");
