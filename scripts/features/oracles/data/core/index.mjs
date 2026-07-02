/**
 * GLUniverse Suite — Oracles feature: the CORE pack.
 *
 * The four universal prompt tables every genre inherits (Action, Theme,
 * Descriptor, Focus) plus the two composite prompts built from them.
 * Contains material from Ironsworn: Starforged by Shawn Tomkin, licensed
 * under CC BY 4.0 (ironswornrpg.com). Ironsworn and Starforged are
 * trademarks of Shawn Tomkin and are not claimed by this module.
 *
 * This pack is ALWAYS active; genre packs may override any table by
 * shipping one with the same qualified id via `overrides` (not yet used).
 */

export default {
  id: "core",
  label: "Core Oracles",
  attribution:
    "Contains material from Ironsworn: Starforged by Shawn Tomkin, licensed under CC BY 4.0.",
  context: null,
  slots: {},
  tables: [
    {
      id: "action",
      name: "Action",
      category: "Core Oracles",
      words: [
        "Abandon", "Acquire", "Advance", "Affect", "Aid", "Arrive", "Assault", "Attack", "Avenge", "Avoid",
        "Await", "Begin", "Betray", "Bolster", "Breach", "Break", "Capture", "Challenge", "Change", "Charge",
        "Clash", "Command", "Communicate", "Construct", "Control", "Coordinate", "Create", "Debate", "Defeat", "Defend",
        "Deflect", "Defy", "Deliver", "Demand", "Depart", "Destroy", "Distract", "Eliminate", "Endure", "Escalate",
        "Escort", "Evade", "Explore", "Falter", "Find", "Finish", "Focus", "Follow", "Fortify", "Gather",
        "Guard", "Hide", "Hold", "Hunt", "Impress", "Initiate", "Inspect", "Investigate", "Journey", "Learn",
        "Leave", "Locate", "Lose", "Manipulate", "Mourn", "Move", "Oppose", "Overwhelm", "Persevere", "Preserve",
        "Protect", "Raid", "Reduce", "Refuse", "Reject", "Release", "Remove", "Research", "Resist", "Restore",
        "Reveal", "Risk", "Scheme", "Search", "Secure", "Seize", "Serve", "Share", "Strengthen", "Summon",
        "Support", "Suppress", "Surrender", "Swear", "Threaten", "Transform", "Uncover", "Uphold", "Weaken", "Withdraw",
      ],
    },
    {
      id: "theme",
      name: "Theme",
      category: "Core Oracles",
      words: [
        "Ability", "Advantage", "Alliance", "Authority", "Balance", "Barrier", "Belief", "Blood", "Bond", "Burden",
        "Commerce", "Community", "Corruption", "Creation", "Crime", "Culture", "Cure", "Danger", "Death", "Debt",
        "Decay", "Deception", "Defense", "Destiny", "Disaster", "Discovery", "Disease", "Dominion", "Dream", "Duty",
        "Enemy", "Expedition", "Faction", "Fame", "Family", "Fear", "Fellowship", "Freedom", "Greed", "Hardship",
        "Hate", "Health", "History", "Home", "Honor", "Hope", "Humanity", "Innocence", "Knowledge", "Labor",
        "Language", "Law", "Legacy", "Life", "Love", "Memory", "Nature", "Opportunity", "Passage", "Peace",
        "Phenomenon", "Possession", "Power", "Price", "Pride", "Prize", "Prophesy", "Protection", "Quest", "Relationship",
        "Religion", "Reputation", "Resource", "Revenge", "Rival", "Rumor", "Safety", "Sanctuary", "Secret", "Solution",
        "Spirit", "Stranger", "Strategy", "Strength", "Superstition", "Supply", "Survival", "Technology", "Time", "Tool",
        "Trade", "Truth", "Vengeance", "Vow", "War", "Warning", "Weakness", "Wealth", "Weapon", "World",
      ],
    },
    {
      id: "descriptor",
      name: "Descriptor",
      category: "Core Oracles",
      words: [
        "Abandoned", "Abundant", "Active", "Advanced", "Alien", "Ancient", "Archaic", "Automated", "Barren", "Biological",
        "Blighted", "Blocked", "Breached", "Broken", "Captured", "Chaotic", "Civilized", "Collapsed", "Colossal", "Confined",
        "Conspicuous", "Constructed", "Contested", "Corrupted", "Created", "Damaged", "Dead", "Deadly", "Decaying", "Defended",
        "Depleted", "Desolate", "Destroyed", "Diverse", "Empty", "Engulfed", "Ensnaring", "Expansive", "Exposed", "Fiery",
        "Foreboding", "Forgotten", "Forsaken", "Fortified", "Foul", "Fragile", "Frozen", "Functional", "Grim", "Guarded",
        "Haunted", "Hidden", "Hoarded", "Hostile", "Immersed", "Inaccessible", "Infested", "Inhabited", "Isolated", "Living",
        "Lost", "Lush", "Makeshift", "Mechanical", "Misleading", "Moving", "Mysterious", "Natural", "New", "Obscured",
        "Open", "Peaceful", "Perilous", "Pillaged", "Powerful", "Preserved", "Prominent", "Protected", "Radiant", "Rare",
        "Remote", "Rich", "Ruined", "Sacred", "Safe", "Sealed", "Secret", "Settled", "Shrouded", "Stolen",
        "Strange", "Subsurface", "Toxic", "Trapped", "Undiscovered", "Unnatural", "Unstable", "Untamed", "Valuable", "Violent",
      ],
    },
    {
      id: "focus",
      name: "Focus",
      category: "Core Oracles",
      words: [
        "Alarm", "Anomaly", "Apparition", "Archive", "Art", "Artifact", "Atmosphere", "Battleground", "Beacon", "Being",
        "Blockade", "Boundary", "Cache", "Cargo", "Commodity", "Confinement", "Connection", "Container", "Creation", "Creature",
        "Crossing", "Data", "Debris", "Device", "Dimension", "Discovery", "Ecosystem", "Enclosure", "Energy", "Environment",
        "Equipment", "Experiment", "Facility", "Faction", "Fleet", "Force", "Fortification", "Gas", "Grave", "Habitat",
        "Hazard", "Hideaway", "Home", "Illusion", "Industry", "Intelligence", "Lair", "Lifeform", "Liquid", "Machine",
        "Material", "Mechanism", "Message", "Mineral", "Monument", "Obstacle", "Organism", "Outbreak", "Outpost", "Path",
        "People", "Person", "Plant", "Portal", "Reality", "Refuge", "Relic", "Remains", "Rendezvous", "Resource",
        "Route", "Ruins", "Salvage", "Settlement", "Shelter", "Ship", "Shortcut", "Signal", "Sound", "Storage",
        "Storm", "Structure", "Supply", "Symbol", "System", "Technology", "Terrain", "Territory", "Threshold", "Time",
        "Transport", "Trap", "Treasure", "Vault", "Vehicle", "Viewpoint", "Void", "Weapon", "World", "Wreckage",
      ],
    },
    {
      id: "action-theme",
      name: "Action + Theme",
      category: "Core Oracles",
      compose: ["core:action", "core:theme"],
    },
    {
      id: "descriptor-focus",
      name: "Descriptor + Focus",
      category: "Core Oracles",
      compose: ["core:descriptor", "core:focus"],
    },
  ],
};
