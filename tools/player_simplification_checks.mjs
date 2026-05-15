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
