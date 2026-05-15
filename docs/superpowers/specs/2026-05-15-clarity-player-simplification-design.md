# CLARITY Player-Facing Simplification Design

Date: 2026-05-15

## Goal

Make the first-run player experience easier to understand without turning CLARITY into a different game. The core fantasy stays: memories are inventory, contracts create heat, and Omni-Corp audits threaten the things the player chooses to keep.

This pass is not a code-architecture refactor. It changes what the player sees, when they see it, and how much they must understand at once.

## Recommended Approach

Use a "Core Run" simplification. Keep the main loop visible and satisfying:

`Take a contract -> gain or lose memories -> manage heat -> sleep -> repeat`

Advanced systems should either unlock later, move behind optional actions, or appear only when directly relevant. The player should not need to understand vendor trust, memory tags, audit tiers, faction chains, NG+, run history, and daily event cascades before they have enjoyed a few contracts.

## Player-Facing Rules

The early game should teach only five concepts:

1. Memories are the player's inventory.
2. Each memory has emotion, clarity, and security state.
3. Contracts give memories and raise Omni heat.
4. High heat causes audits that can strip unsecured memories.
5. Sleep advances the day and resolves pressure.

Everything else is supporting texture until the player has a reason to care.

## UI and Flow Changes

Simplify the safehouse into a small set of obvious actions:

- Take a Contract
- Manage Memories
- Visit the Market
- Sleep
- Help

Reduce contract board pressure by showing three primary options at a time:

- One low-risk contract
- One higher-risk contract
- One story or faction contract

Locked or advanced contracts can stay hidden until they matter. If a contract is unavailable, the game should explain it through a short lead or story beat rather than a dense board of gates.

Collapse the five vendor entrances into one Market entry point. The Market can still contain Ripperdoc, Mnemonic, Shadow, Grey, and Purity internally, but the safehouse should not ask the player to parse five separate economy systems at once.

Replace detailed audit tier language in early UI with a simpler heat state:

- Low
- Rising
- Dangerous

The detailed Watcher, Auditor, and Enforcement behavior can remain in the code and help modal, but first-run messaging should focus on the consequence: "sleeping now may cost unsecured memories."

## Systems to De-Emphasize

These features should remain available only when relevant or optional:

- Vendor trust tiers
- Memory tags as explicit purchase requirements
- Case board optimization leads
- Chrome-Jaws war arc
- Daily event cascades during the first few days
- NG+ presentation before any ending is unlocked
- Dense tooltip and glossary detail
- Run history as a main toolbar action

None of these need to be deleted in the first pass. The simplification should be reversible and conservative.

## Implementation Boundaries

This design should mostly affect:

- Safehouse action list
- Contract board presentation
- Vendor entry flow
- Case board lead selection
- Audit and compliance copy
- First-run glossary/orientation copy
- Toolbar visibility or priority

It should avoid rewriting contract arcs, save format, memory generation, endings, or audio systems unless a small change is required to support the simplified flow.

## Testing

Manual verification is enough for the first pass:

1. Start a fresh run.
2. Confirm the safehouse presents the simplified actions.
3. Take a contract and confirm the loop is understandable without reading the full glossary.
4. Gain at least one memory and manage it from the memory stack or Manage Memories flow.
5. Raise compliance enough to see simplified heat messaging.
6. Sleep and confirm audit/decay messaging remains clear.
7. Visit the Market and confirm the old vendors remain reachable without crowding the safehouse.
8. Confirm existing saves still load.

## Success Criteria

A new player should be able to play the first three days while understanding what they are doing from the visible UI alone. The game should feel like a tight memory-heist loop with optional depth, not a dashboard of every system at once.
