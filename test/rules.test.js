import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyAction, canPlaceCube, clueCatalog, clueMatches, clueText, createGame, timeoutTurn, generatePuzzle, hexDistance, RuleError, viewFor,
} from '../src/rules.js';

const NAMES = ['Ann', 'Bo', 'Cy', 'Di'];

function finishSetup(game) {
  while (game.phase === 'setup') {
    const hex = game.map.hexes.find((h) => canPlaceCube(game, game.current, h));
    applyAction(game, game.current, { type: 'placeCube', hex: hex.id });
  }
}

test('hex distance on the odd-q grid', () => {
  assert.equal(hexDistance({ c: 0, r: 0 }, { c: 1, r: 0 }), 1);
  assert.equal(hexDistance({ c: 1, r: 0 }, { c: 2, r: 1 }), 1);
  assert.equal(hexDistance({ c: 1, r: 0 }, { c: 0, r: 1 }), 1);
  assert.equal(hexDistance({ c: 0, r: 0 }, { c: 0, r: 2 }), 2);
  assert.equal(hexDistance({ c: 0, r: 0 }, { c: 11, r: 8 }), 14);
});

for (const advanced of [false, true]) {
  for (const players of [3, 4, 5]) {
    test(`puzzles have one answer and no spare clue (${players}p, advanced=${advanced})`, () => {
      for (let seed = 1; seed <= 40; seed++) {
        const { map, habitat, clues } = generatePuzzle(seed * 7919, players, advanced);
        assert.equal(map.hexes.length, 108);
        assert.equal(clues.length, players);
        const hits = (list) => map.hexes.filter((h) => list.every((c) => clueMatches(map, c, h)));
        assert.deepEqual(hits(clues).map((h) => h.id), [habitat]);
        clues.forEach((_, i) => {
          assert.ok(hits(clues.filter((__, j) => j !== i)).length > 1);
        });
        assert.equal(clues.filter((c) => c.negated).length, advanced ? 1 : 0);
        assert.equal(map.hexes.filter((h) => h.structure).length, 6);
      }
    });
  }
}

test('the clue catalog has 24 distinct clues', () => {
  const texts = clueCatalog().map(clueText);
  assert.equal(texts.length, 24);
  assert.equal(new Set(texts).size, 24);
});

test('colour clues reach 3 spaces from either structure type', () => {
  const place = (c, r, structure, structureColor) => ({ id: 0, c, r, terrain: 'forest', structure, structureColor, animal: null });
  const map = { hexes: [place(0, 0, 'stone', 'violet'), place(5, 5, 'shack', 'violet'), place(0, 8, 'stone', 'red')] };
  const clue = { kind: 'nearColor', color: 'violet' };
  const at = (c, r) => ({ c, r });
  assert.equal(clueMatches(map, clue, at(0, 3)), true);
  assert.equal(clueMatches(map, clue, at(5, 8)), true);
  assert.equal(clueMatches(map, clue, at(0, 4)), false);
  assert.equal(clueMatches(map, { ...clue, negated: true }, at(0, 4)), true);
  assert.equal(clueText(clue), 'The habitat is within 3 spaces of a violet structure.');
});

test('colour clues are dealt, and only for colours on the map', () => {
  let dealt = 0;
  for (let seed = 1; seed <= 100; seed++) {
    const { map, clues } = generatePuzzle(seed * 101, 4);
    for (const clue of clues.filter((c) => c.kind === 'nearColor')) {
      dealt++;
      assert.ok(map.hexes.some((h) => h.structureColor === clue.color));
    }
  }
  assert.ok(dealt > 0);
});

test('structures get a colour, with no repeats within a type', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const { map } = generatePuzzle(seed * 31, 3);
    for (const type of ['stone', 'shack']) {
      const colors = map.hexes.filter((h) => h.structure === type).map((h) => h.structureColor);
      assert.equal(colors.length, 3);
      assert.equal(new Set(colors).size, 3);
      assert.ok(colors.every(Boolean));
    }
  }
});

test('timing out on a turn places a legal cube and passes play', () => {
  const game = createGame(NAMES, 31);
  finishSetup(game);
  const before = Object.keys(game.cubes).length;
  timeoutTurn(game, () => 0.5);
  assert.equal(Object.keys(game.cubes).length, before + 1);
  const placed = game.map.hexes[game.lastHex];
  assert.equal(game.cubes[placed.id], 0);
  assert.equal(clueMatches(game.map, game.clues[0], placed), false);
  assert.equal(game.current, 1);
  assert.equal(game.phase, 'turn');
});

test('timing out on a penalty places that cube and passes play', () => {
  const game = createGame(NAMES, 32);
  finishSetup(game);
  const hex = game.map.hexes.find((h) => canPlaceCube(game, 1, h));
  applyAction(game, 0, { type: 'question', hex: hex.id, target: 1 });
  const before = Object.keys(game.cubes).length;
  timeoutTurn(game, () => 0);
  assert.equal(Object.keys(game.cubes).length, before + 1);
  assert.equal(game.cubes[game.lastHex], 0);
  assert.equal(game.current, 1);
  assert.equal(game.phase, 'turn');
  assert.equal(game.pendingCube, null);
});

test('timing out in setup uses up that placement', () => {
  const game = createGame(NAMES, 33);
  const left = game.setupLeft;
  timeoutTurn(game, () => 0.99);
  assert.equal(game.setupLeft, left - 1);
  assert.equal(game.current, 1);
  assert.equal(game.cubes[game.lastHex], 0);
});

test('timing out with no legal space just passes play', () => {
  const game = createGame(NAMES, 34);
  finishSetup(game);
  for (const hex of game.map.hexes) {
    if (!clueMatches(game.map, game.clues[0], hex)) game.cubes[hex.id] = 1;
  }
  const before = Object.keys(game.cubes).length;
  timeoutTurn(game, () => 0);
  assert.equal(Object.keys(game.cubes).length, before);
  assert.equal(game.current, 1);
});

test('invalid turn times are rejected, and the timer is off by default', () => {
  assert.throws(() => createGame(NAMES, 35, { timer: true, timerSeconds: 7 }), RuleError);
  assert.equal(createGame(NAMES, 35).timerSeconds, null);
  assert.equal(viewFor(createGame(NAMES, 35, { timer: true, timerSeconds: 30 }), 0).timerSeconds, 30);
});

test('setup rejects cubes that contradict your clue or come out of turn', () => {
  const game = createGame(NAMES, 11);
  const allowed = game.map.hexes.find((h) => clueMatches(game.map, game.clues[0], h));
  assert.throws(() => applyAction(game, 0, { type: 'placeCube', hex: allowed.id }), RuleError);
  const legal = game.map.hexes.find((h) => canPlaceCube(game, 1, h));
  assert.throws(() => applyAction(game, 1, { type: 'placeCube', hex: legal.id }), RuleError);
  finishSetup(game);
  assert.equal(game.phase, 'turn');
  assert.equal(game.current, 0);
  assert.equal(Object.keys(game.cubes).length, 8);
  assert.equal(game.lastHex, null);
});

for (const setupRounds of [0, 1, 2, 3, 4]) {
  test(`setup places ${setupRounds} round(s) of cubes, then the first player starts`, () => {
    const game = createGame(NAMES, 21, { setupRounds });
    finishSetup(game);
    assert.equal(game.phase, 'turn');
    assert.equal(game.current, 0);
    assert.equal(Object.keys(game.cubes).length, NAMES.length * setupRounds);
  });
}

test('invalid setup rounds are rejected', () => {
  assert.throws(() => createGame(NAMES, 22, { setupRounds: 9 }), RuleError);
});

test('setup skips a player with no legal space left', () => {
  const game = createGame(NAMES, 23, { setupRounds: 2 });
  for (const hex of game.map.hexes) {
    if (!clueMatches(game.map, game.clues[1], hex)) game.cubes[hex.id] = 2;
  }
  const spot = game.map.hexes.find((h) => canPlaceCube(game, 0, h));
  applyAction(game, 0, { type: 'placeCube', hex: spot.id });
  assert.equal(game.current, 2);
  assert.equal(game.setupLeft, NAMES.length * 2 - 2);
});

test('the highlight option reaches every player view', () => {
  assert.equal(viewFor(createGame(NAMES, 24), 0).highlight, true);
  assert.equal(viewFor(createGame(NAMES, 24, { highlight: false }), 0).highlight, false);
});

test('a "no" answer places the target cube and costs the asker a cube', () => {
  const game = createGame(NAMES, 12);
  finishSetup(game);
  const hex = game.map.hexes.find((h) => canPlaceCube(game, 1, h));
  applyAction(game, 0, { type: 'question', hex: hex.id, target: 1 });
  assert.equal(game.cubes[hex.id], 1);
  assert.equal(game.phase, 'penalty');
  assert.equal(game.pendingCube, 0);
  assert.throws(() => applyAction(game, 2, { type: 'question', hex: 0, target: 1 }), RuleError);
  const spot = game.map.hexes.find((h) => canPlaceCube(game, 0, h));
  applyAction(game, 0, { type: 'placeCube', hex: spot.id });
  assert.equal(game.current, 1);
  assert.equal(game.phase, 'turn');
});

test('a "maybe" answer places a disc, passes the turn, and blocks repeats', () => {
  const game = createGame(NAMES, 13);
  finishSetup(game);
  const hex = game.map.hexes.find(
    (h) => game.cubes[h.id] === undefined && clueMatches(game.map, game.clues[1], h),
  );
  applyAction(game, 0, { type: 'question', hex: hex.id, target: 1 });
  assert.deepEqual(game.discs[hex.id], [1]);
  assert.equal(game.current, 1);
  applyAction(game, 1, { type: 'search', hex: game.habitat }); // ends the game via the true habitat
  assert.equal(game.winner, 1);
});

test('questioning a player who already has a disc there is rejected', () => {
  const game = createGame(NAMES, 13);
  finishSetup(game);
  const hex = game.map.hexes.find(
    (h) => game.cubes[h.id] === undefined && clueMatches(game.map, game.clues[1], h),
  );
  applyAction(game, 0, { type: 'question', hex: hex.id, target: 1 });
  game.current = 0;
  assert.throws(() => applyAction(game, 0, { type: 'question', hex: hex.id, target: 1 }), RuleError);
});

test('search stops at the first player who rules the space out', () => {
  const game = createGame(NAMES, 14);
  finishSetup(game);
  const hex = game.map.hexes.find(
    (h) => h.id !== game.habitat && game.cubes[h.id] === undefined
      && clueMatches(game.map, game.clues[0], h),
  );
  applyAction(game, 0, { type: 'search', hex: hex.id });
  assert.equal(game.winner, null);
  assert.equal(game.phase, 'penalty');
  assert.notEqual(game.cubes[hex.id], undefined);
  assert.equal(game.lastHex, hex.id);
  assert.ok(game.log.at(-1).includes(`${String.fromCharCode(65 + hex.c)}${hex.r + 1}`));
  assert.ok(game.discs[hex.id].includes(0));
});

test('searching a space your own clue excludes is rejected', () => {
  const game = createGame(NAMES, 15);
  finishSetup(game);
  const hex = game.map.hexes.find(
    (h) => game.cubes[h.id] === undefined && !clueMatches(game.map, game.clues[0], h),
  );
  assert.throws(() => applyAction(game, 0, { type: 'search', hex: hex.id }), RuleError);
});

test('malformed actions are rejected without changing state', () => {
  const game = createGame(NAMES, 16);
  finishSetup(game);
  const before = JSON.stringify(game);
  for (const action of [null, {}, { type: 'search', hex: 999 }, { type: 'search', hex: '1' },
    { type: 'question', hex: 0, target: 0 }, { type: 'question', hex: 0, target: 9 }]) {
    assert.throws(() => applyAction(game, 0, action), RuleError);
  }
  assert.equal(JSON.stringify(game), before);
});

test('views hide other clues and the habitat until the game ends', () => {
  const game = createGame(NAMES, 17);
  const view = viewFor(game, 2);
  assert.deepEqual(view.myClue, game.clues[2]);
  assert.equal(view.reveal, null);
  assert.equal('clues' in view, false);
  assert.equal('habitat' in view, false);
  finishSetup(game);
  applyAction(game, 0, { type: 'search', hex: game.habitat });
  assert.equal(game.winner, 0);
  assert.equal(viewFor(game, 2).reveal.habitat, game.habitat);
});
