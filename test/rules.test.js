import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyAction, canPlaceCube, clueMatches, createGame, generatePuzzle, hexDistance, RuleError, viewFor,
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
