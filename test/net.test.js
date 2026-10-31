import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

globalThis.Peer = class {
  on() {}
};
const { HostSession } = await import('../src/net.js');
const { canPlaceCube } = await import('../src/rules.js');

function hostRoom() {
  const views = [];
  const listener = { state: (v) => views.push(v), status() {}, error() {} };
  const host = new HostSession(`T${Math.random()}`, 'Host', listener);
  for (const name of ['Bo', 'Cy', 'Di']) {
    host.join(`token-${name}`, name, { send() {}, close() {} });
  }
  return { host, views };
}

test('starting a game randomises the turn order', () => {
  const firsts = new Set();
  for (let i = 0; i < 60; i++) {
    const { host } = hostRoom();
    host.start();
    const names = host.room.game.names;
    assert.deepEqual([...names].sort(), ['Bo', 'Cy', 'Di', 'Host']);
    assert.deepEqual(names, host.room.players.map((p) => p.name));
    firsts.add(names[0]);
  }
  assert.equal(firsts.size, 4);
});

test('the host keeps host controls and their own clue from any seat', () => {
  for (let i = 0; i < 20; i++) {
    const { host, views } = hostRoom();
    host.start();
    const seat = host.room.players.findIndex((p) => p.token === host.token);
    const view = views.at(-1);
    assert.equal(view.isHost, true);
    assert.equal(view.game.me, seat);
    assert.deepEqual(view.game.myClue, host.room.game.clues[seat]);
    host.room.players.forEach((_, other) => {
      assert.equal(host.viewFor(other).isHost, other === seat);
    });
  }
});

test('actions apply to the seat a player was shuffled into', () => {
  const { host } = hostRoom();
  host.start();
  const game = host.room.game;
  const before = game.setupLeft;
  const wrongSeat = (game.current + 1) % game.names.length;
  const legal = game.map.hexes.find((h) => canPlaceCube(game, wrongSeat, h));
  host.act(host.room.players[wrongSeat].token, { type: 'placeCube', hex: legal.id });
  assert.equal(game.setupLeft, before);
  const spot = game.map.hexes.find((h) => canPlaceCube(game, game.current, h));
  host.act(host.room.players[game.current].token, { type: 'placeCube', hex: spot.id });
  assert.equal(game.setupLeft, before - 1);
});

test('the host clock places a cube on timeout and restarts for the next player', () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  try {
    const { host, views } = hostRoom();
    host.setOptions({ timer: true, timerSeconds: 15 });
    host.start();
    const game = host.room.game;
    assert.equal(views.at(-1).game.timeLeftMs, 15000);
    mock.timers.tick(14999);
    assert.equal(game.current, 0);
    mock.timers.tick(1);
    assert.equal(game.current, 1);
    assert.equal(Object.keys(game.cubes).length, 1);
    assert.equal(views.at(-1).game.timeLeftMs, 15000);
    mock.timers.tick(5000);
    const spot = game.map.hexes.find((h) => canPlaceCube(game, 1, h));
    host.act(host.room.players[1].token, { type: 'placeCube', hex: spot.id });
    assert.equal(game.current, 2);
    mock.timers.tick(14999);
    assert.equal(game.current, 2);
    host.backToLobby();
    mock.timers.tick(60000);
    assert.equal(Object.keys(game.cubes).length, 2);
  } finally {
    mock.timers.reset();
  }
});

test('no clock runs when the timer is off', () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  try {
    const { host, views } = hostRoom();
    host.start();
    assert.equal(views.at(-1).game.timeLeftMs, null);
    mock.timers.tick(600000);
    assert.equal(Object.keys(host.room.game.cubes).length, 0);
  } finally {
    mock.timers.reset();
  }
});
