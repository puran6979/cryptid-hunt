// Pure game rules: no DOM or networking, so the host and tests share them.
export const COLS = 12;
export const ROWS = 9;
export const TERRAINS = ['forest', 'desert', 'swamp', 'mountain', 'water'];
export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 5;
export const SETUP_ROUND_CHOICES = [0, 1, 2, 3, 4];
export const STRUCTURE_COLORS = ['red', 'violet', 'white', 'black'];
export const DEFAULT_OPTIONS = { advanced: false, setupRounds: 2, highlight: true };

const STRUCTURE_LABEL = { stone: 'a standing stone', shack: 'an abandoned shack' };
const ANIMAL_LABEL = { bear: 'bear territory', cougar: 'cougar territory' };

export class RuleError extends Error {}

export function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(list, rng) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Columns use the odd-q offset layout: odd columns sit half a hex lower.
export function hexDistance(a, b) {
  const az = a.r - (a.c - (a.c & 1)) / 2;
  const bz = b.r - (b.c - (b.c & 1)) / 2;
  const dx = a.c - b.c;
  const dz = az - bz;
  return Math.max(Math.abs(dx), Math.abs(dz), Math.abs(dx + dz));
}

export function generateMap(rng) {
  for (;;) {
    const hexes = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        hexes.push({ id: hexes.length, c, r, terrain: null, structure: null, animal: null });
      }
    }

    // Terrain: Voronoi regions from jittered sites, for natural-looking blobs.
    const pool = shuffle([...TERRAINS, ...TERRAINS, ...TERRAINS, ...TERRAINS], rng);
    const sites = [];
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 4; j++) {
        sites.push({
          c: Math.floor(((i + rng()) * COLS) / 5),
          r: Math.floor(((j + rng()) * ROWS) / 4),
          terrain: pool[sites.length],
        });
      }
    }
    for (const hex of hexes) {
      let best = Infinity;
      for (const site of sites) {
        const d = hexDistance(hex, site) + rng() * 0.9;
        if (d < best) {
          best = d;
          hex.terrain = site.terrain;
        }
      }
    }
    const counts = TERRAINS.map((t) => hexes.filter((h) => h.terrain === t).length);
    if (Math.min(...counts) < 14) continue;

    // Each of the six 6x3 sections gets one structure and one animal territory.
    const structures = shuffle(['stone', 'stone', 'stone', 'shack', 'shack', 'shack'], rng);
    const animals = shuffle(['bear', 'bear', 'bear', 'cougar', 'cougar', 'cougar'], rng);
    // Colour clues count both types, so a colour may appear on up to two structures.
    const paints = { stone: shuffle(STRUCTURE_COLORS, rng), shack: shuffle(STRUCTURE_COLORS, rng) };
    let section = 0;
    for (let tr = 0; tr < 3; tr++) {
      for (let tc = 0; tc < 2; tc++) {
        const inside = shuffle(
          hexes.filter((h) => Math.floor(h.c / 6) === tc && Math.floor(h.r / 3) === tr),
          rng,
        );
        const home = inside.find((h) => h.terrain !== 'water') ?? inside[0];
        home.structure = structures[section];
        home.structureColor = paints[home.structure].pop();
        const open = inside.filter((h) => h !== home);
        const territory = [open[0]];
        for (const h of open.slice(1)) {
          if (territory.length < 3 && territory.some((t) => hexDistance(t, h) === 1)) territory.push(h);
        }
        for (const h of territory) h.animal = animals[section];
        section++;
      }
    }
    return { hexes };
  }
}

function within(hex, hexes, test, range) {
  return hexes.some((other) => test(other) && hexDistance(hex, other) <= range);
}

export function clueMatches(map, clue, hex) {
  let result;
  switch (clue.kind) {
    case 'terrainPair':
      result = hex.terrain === clue.a || hex.terrain === clue.b;
      break;
    case 'nearTerrain':
      result = within(hex, map.hexes, (h) => h.terrain === clue.terrain, 1);
      break;
    case 'nearAnyAnimal':
      result = within(hex, map.hexes, (h) => h.animal, 1);
      break;
    case 'nearStructure':
      result = within(hex, map.hexes, (h) => h.structure === clue.structure, 2);
      break;
    case 'nearAnimal':
      result = within(hex, map.hexes, (h) => h.animal === clue.animal, 2);
      break;
    case 'nearColor':
      result = within(hex, map.hexes, (h) => h.structure && h.structureColor === clue.color, 3);
      break;
    default:
      throw new RuleError(`Unknown clue kind ${clue.kind}`);
  }
  return clue.negated ? !result : result;
}

export function clueText(clue) {
  const on = clue.negated ? 'is not' : 'is';
  switch (clue.kind) {
    case 'terrainPair':
      return `The habitat ${on} on ${clue.a} or ${clue.b}.`;
    case 'nearTerrain':
      return `The habitat ${on} within 1 space of ${clue.terrain}.`;
    case 'nearAnyAnimal':
      return `The habitat ${on} within 1 space of any animal territory.`;
    case 'nearStructure':
      return `The habitat ${on} within 2 spaces of ${STRUCTURE_LABEL[clue.structure]}.`;
    case 'nearAnimal':
      return `The habitat ${on} within 2 spaces of ${ANIMAL_LABEL[clue.animal]}.`;
    case 'nearColor':
      return `The habitat ${on} within 3 spaces of a ${clue.color} structure.`;
    default:
      throw new RuleError(`Unknown clue kind ${clue.kind}`);
  }
}

export function clueCatalog() {
  const clues = [{ kind: 'nearAnyAnimal' }];
  TERRAINS.forEach((a, i) => {
    clues.push({ kind: 'nearTerrain', terrain: a });
    for (const b of TERRAINS.slice(i + 1)) clues.push({ kind: 'terrainPair', a, b });
  });
  for (const structure of ['stone', 'shack']) clues.push({ kind: 'nearStructure', structure });
  for (const animal of ['bear', 'cougar']) clues.push({ kind: 'nearAnimal', animal });
  for (const color of STRUCTURE_COLORS) clues.push({ kind: 'nearColor', color });
  return clues;
}

// Finds clues that pin down exactly one hex, where every clue is necessary:
// dropping any one of them would leave more than one candidate.
export function generatePuzzle(seed, playerCount, advanced = false) {
  const rng = makeRng(seed);
  for (;;) {
    const map = generateMap(rng);
    const size = map.hexes.length;
    const catalog = [];
    for (const base of clueCatalog()) {
      for (const clue of advanced ? [base, { ...base, negated: true }] : [base]) {
        const ids = new Set(map.hexes.filter((h) => clueMatches(map, clue, h)).map((h) => h.id));
        if (ids.size >= size * 0.15 && ids.size <= size * 0.75) catalog.push({ clue, ids });
      }
    }

    for (let attempt = 0; attempt < 3000; attempt++) {
      const habitat = Math.floor(rng() * size);
      const fits = shuffle(catalog.filter((e) => e.ids.has(habitat)), rng);
      const chosen = [];
      if (advanced) {
        const negative = fits.find((e) => e.clue.negated);
        if (!negative) continue;
        chosen.push(negative);
      }
      for (const entry of fits) {
        if (chosen.length === playerCount) break;
        if (!entry.clue.negated) chosen.push(entry);
      }
      if (chosen.length !== playerCount) continue;

      const survivors = (entries) =>
        map.hexes.filter((h) => entries.every((e) => e.ids.has(h.id))).length;
      if (survivors(chosen) !== 1) continue;
      if (chosen.some((_, i) => survivors(chosen.filter((__, j) => j !== i)) === 1)) continue;
      return { map, habitat, clues: shuffle(chosen, rng).map((e) => e.clue) };
    }
  }
}

export function createGame(names, seed, options = {}) {
  const { advanced, setupRounds, highlight } = { ...DEFAULT_OPTIONS, ...options };
  if (!SETUP_ROUND_CHOICES.includes(setupRounds)) throw new RuleError('Invalid number of setup rounds.');
  if (names.length < MIN_PLAYERS || names.length > MAX_PLAYERS) {
    throw new RuleError(`Cryptid Hunt needs ${MIN_PLAYERS}-${MAX_PLAYERS} players.`);
  }
  const { map, habitat, clues } = generatePuzzle(seed, names.length, advanced);
  return {
    names,
    advanced,
    highlight,
    setupRounds,
    map,
    habitat,
    clues,
    cubes: {},
    discs: {},
    current: 0,
    phase: setupRounds === 0 ? 'turn' : 'setup',
    setupLeft: names.length * setupRounds,
    pendingCube: null,
    winner: null,
    lastHex: null,
    log: [
      `Turn order: ${names.join(', ')}.`,
      setupRounds === 0
        ? 'No setup rounds. The hunt begins!'
        : `Setup: each player places ${setupRounds} cube${setupRounds === 1 ? '' : 's'} on spaces their clue rules out.`,
    ],
  };
}

function hexOf(game, id) {
  const hex = Number.isInteger(id) ? game.map.hexes[id] : undefined;
  if (!hex) throw new RuleError('That space is not on the map.');
  return hex;
}

function nameOf(game, player) {
  return game.names[player];
}

function spaceName(hex) {
  return `${String.fromCharCode(65 + hex.c)}${hex.r + 1}`;
}

export function canPlaceCube(game, player, hex) {
  return game.cubes[hex.id] === undefined && !clueMatches(game.map, game.clues[player], hex);
}

function addDisc(game, hex, player) {
  const discs = game.discs[hex.id] ?? (game.discs[hex.id] = []);
  if (!discs.includes(player)) discs.push(player);
}

function nextTurn(game) {
  game.current = (game.current + 1) % game.names.length;
  game.phase = 'turn';
  game.pendingCube = null;
}

// A wrong answer costs the active player a cube of their own, if any space allows it.
function requirePenalty(game, player) {
  if (game.map.hexes.some((h) => canPlaceCube(game, player, h))) {
    game.phase = 'penalty';
    game.pendingCube = player;
  } else {
    game.log.push(`${nameOf(game, player)} has no legal space left for a cube.`);
    nextTurn(game);
  }
}

// Moves to the next setup placement, skipping anyone with no legal space left.
function advanceSetup(game) {
  do {
    game.setupLeft--;
    game.current = (game.current + 1) % game.names.length;
    if (game.setupLeft === 0) {
      game.phase = 'turn';
      game.current = 0;
      game.lastHex = null; // this log line isn't about a space
      game.log.push('Setup complete. The hunt begins!');
      return;
    }
  } while (!game.map.hexes.some((h) => canPlaceCube(game, game.current, h)));
}

function placeCube(game, player, hexId) {
  const hex = hexOf(game, hexId);
  const expected = game.phase === 'setup' ? game.current : game.pendingCube;
  if ((game.phase !== 'setup' && game.phase !== 'penalty') || player !== expected) {
    throw new RuleError('You cannot place a cube right now.');
  }
  if (game.cubes[hex.id] !== undefined) throw new RuleError('That space already has a cube.');
  if (clueMatches(game.map, game.clues[player], hex)) {
    throw new RuleError('Your clue allows that space, so a cube there would be a lie.');
  }
  game.cubes[hex.id] = player;
  game.lastHex = hex.id;
  game.log.push(`${nameOf(game, player)} placed a cube on ${spaceName(hex)}.`);
  if (game.phase === 'setup') {
    advanceSetup(game);
  } else {
    nextTurn(game);
  }
}

function question(game, player, hexId, target) {
  const hex = hexOf(game, hexId);
  if (game.phase !== 'turn' || player !== game.current) throw new RuleError('It is not your turn.');
  if (!Number.isInteger(target) || target < 0 || target >= game.names.length || target === player) {
    throw new RuleError('Choose another player to question.');
  }
  if (game.cubes[hex.id] !== undefined) throw new RuleError('That space already has a cube.');
  if (game.discs[hex.id]?.includes(target)) throw new RuleError('That player already has a disc there.');
  game.lastHex = hex.id;
  const asked = `${nameOf(game, player)} asked ${nameOf(game, target)} about ${spaceName(hex)}`;
  if (clueMatches(game.map, game.clues[target], hex)) {
    addDisc(game, hex, target);
    game.log.push(`${asked}: maybe (disc).`);
    nextTurn(game);
  } else {
    game.cubes[hex.id] = target;
    game.log.push(`${asked}: no (cube).`);
    requirePenalty(game, player);
  }
}

function search(game, player, hexId) {
  const hex = hexOf(game, hexId);
  if (game.phase !== 'turn' || player !== game.current) throw new RuleError('It is not your turn.');
  if (game.cubes[hex.id] !== undefined) throw new RuleError('That space already has a cube.');
  if (!clueMatches(game.map, game.clues[player], hex)) {
    throw new RuleError('Your own clue rules that space out, so you cannot search it.');
  }
  game.lastHex = hex.id;
  addDisc(game, hex, player);
  game.log.push(`${nameOf(game, player)} searched ${spaceName(hex)}.`);
  const count = game.names.length;
  for (let step = 1; step < count; step++) {
    const other = (player + step) % count;
    if (clueMatches(game.map, game.clues[other], hex)) {
      addDisc(game, hex, other);
      game.log.push(`${nameOf(game, other)} answered about ${spaceName(hex)}: maybe (disc).`);
    } else {
      game.cubes[hex.id] = other;
      game.log.push(`${nameOf(game, other)} answered about ${spaceName(hex)}: no (cube). The search fails.`);
      requirePenalty(game, player);
      return;
    }
  }
  game.winner = player;
  game.phase = 'over';
  game.log.push(`${nameOf(game, player)} found the cryptid on ${spaceName(hex)}!`);
}

export function applyAction(game, player, action) {
  if (game.phase === 'over') throw new RuleError('The game is over.');
  switch (action?.type) {
    case 'placeCube':
      return placeCube(game, player, action.hex);
    case 'question':
      return question(game, player, action.hex, action.target);
    case 'search':
      return search(game, player, action.hex);
    default:
      throw new RuleError('Unknown action.');
  }
}

// What one player may see. Other clues and the habitat stay on the host until the end.
export function viewFor(game, player) {
  const over = game.phase === 'over';
  return {
    names: game.names,
    advanced: game.advanced,
    highlight: game.highlight !== false,
    setupRounds: game.setupRounds ?? 2,
    map: game.map,
    cubes: game.cubes,
    discs: game.discs,
    current: game.current,
    phase: game.phase,
    setupLeft: game.setupLeft,
    pendingCube: game.pendingCube,
    winner: game.winner,
    lastHex: game.lastHex,
    log: game.log,
    me: player,
    myClue: game.clues[player],
    reveal: over ? { clues: game.clues, habitat: game.habitat } : null,
  };
}

export { spaceName };
