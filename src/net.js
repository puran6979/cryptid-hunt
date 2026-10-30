// Host-authoritative rooms over WebRTC. The host's browser runs the rules and
// sends each player a personal view, so clues never reach other players' devices.
import { applyAction, createGame, DEFAULT_OPTIONS, makeRng, MAX_PLAYERS, MIN_PLAYERS, RuleError, shuffle, viewFor } from './rules.js';

const PREFIX = 'cryptid-hunt-v1-';
const CODE_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ';
const RETRY_MS = 3000;

export function newRoomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return [...bytes].map((b) => CODE_LETTERS[b % CODE_LETTERS.length]).join('');
}

export function tokenFor(code) {
  const key = `cryptid-token-${code}`;
  let token = load(key);
  if (!token) {
    token = crypto.randomUUID();
    save(key, token);
  }
  return token;
}

function load(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private windows may block storage; the game still works without resume.
  }
}

export function hasSavedRoom(code) {
  return load(`cryptid-host-${code}`) !== null;
}

function cleanName(name) {
  return String(name ?? '').trim().slice(0, 16) || 'Player';
}

export class HostSession {
  constructor(code, hostName, listener) {
    this.code = code;
    this.listener = listener;
    this.token = tokenFor(code);
    this.conns = new Map(); // token -> connection
    this.closed = false;
    const saved = load(`cryptid-host-${code}`);
    this.room = saved
      ? JSON.parse(saved)
      : { players: [{ name: cleanName(hostName), token: this.token }], game: null };
    this.room.options = { ...DEFAULT_OPTIONS, ...this.room.options };
    this.publish();
    this.openPeer();
  }

  openPeer() {
    if (this.closed) return;
    this.listener.status('connecting');
    this.peer = new Peer(PREFIX + this.code);
    this.peer.on('open', () => this.listener.status('online'));
    this.peer.on('connection', (conn) => this.accept(conn));
    this.peer.on('disconnected', () => {
      if (!this.peer.destroyed) this.peer.reconnect();
    });
    this.peer.on('error', (err) => {
      if (err.type === 'unavailable-id') {
        // After a reload the broker may still hold our id for a few seconds.
        this.peer.destroy();
        this.listener.status('connecting');
        setTimeout(() => this.openPeer(), RETRY_MS);
      } else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) {
        this.listener.status('offline');
      }
    });
  }

  accept(conn) {
    let token = null;
    conn.on('data', (msg) => {
      if (msg?.t === 'join' && token === null && typeof msg.token === 'string') {
        const failure = this.join(msg.token, msg.name, conn);
        if (failure) {
          conn.send({ t: 'denied', message: failure });
          setTimeout(() => conn.close(), 500);
        } else {
          token = msg.token;
          this.publish();
        }
      } else if (msg?.t === 'action' && token !== null) {
        this.act(token, msg.action);
      }
    });
    conn.on('close', () => {
      if (token !== null && this.conns.get(token) === conn) {
        this.conns.delete(token);
        this.publish();
      }
    });
  }

  join(token, name, conn) {
    const { players, game } = this.room;
    if (!players.some((p) => p.token === token)) {
      if (game) return 'This game has already started.';
      if (players.length >= MAX_PLAYERS) return 'This room is full.';
      players.push({ name: cleanName(name), token });
    }
    const previous = this.conns.get(token);
    this.conns.set(token, conn);
    if (previous && previous !== conn) previous.close();
    return null;
  }

  act(token, action) {
    const seat = this.room.players.findIndex((p) => p.token === token);
    if (seat < 0 || !this.room.game) return;
    try {
      applyAction(this.room.game, seat, action);
      this.publish();
    } catch (err) {
      if (!(err instanceof RuleError)) throw err;
      this.notify(token, err.message);
    }
  }

  notify(token, message) {
    if (token === this.token) this.listener.error(message);
    else this.conns.get(token)?.send({ t: 'error', message });
  }

  // Local UI entry points; only the host can start or reset a game.
  send(action) {
    this.act(this.token, action);
  }

  setOptions(changes) {
    this.room.options = { ...this.room.options, ...changes };
    this.publish();
  }

  start() {
    if (this.room.players.length < MIN_PLAYERS) return;
    const [orderSeed, seed] = crypto.getRandomValues(new Uint32Array(2));
    // Seats are the turn order, so shuffling them means joining first gives no advantage.
    this.room.players = shuffle(this.room.players, makeRng(orderSeed));
    this.room.game = createGame(this.room.players.map((p) => p.name), seed, this.room.options);
    this.publish();
  }

  backToLobby() {
    this.room.game = null;
    this.publish();
  }

  viewFor(seat) {
    const { players, game } = this.room;
    const roster = players.map((p) => ({
      name: p.name,
      online: p.token === this.token || this.conns.has(p.token),
    }));
    return {
      code: this.code,
      roster,
      isHost: players[seat].token === this.token,
      options: this.room.options,
      game: game ? viewFor(game, seat) : null,
    };
  }

  publish() {
    save(`cryptid-host-${this.code}`, JSON.stringify(this.room));
    this.room.players.forEach((player, seat) => {
      const message = { t: 'state', view: this.viewFor(seat) };
      if (player.token === this.token) this.listener.state(message.view);
      else this.conns.get(player.token)?.send(message);
    });
  }
}

export class GuestSession {
  constructor(code, name, listener) {
    this.code = code;
    this.name = name;
    this.listener = listener;
    this.token = tokenFor(code);
    this.closed = false;
    this.listener.status('connecting');
    this.peer = new Peer();
    this.peer.on('open', () => this.connect());
    this.peer.on('disconnected', () => {
      if (!this.peer.destroyed) this.peer.reconnect();
    });
    this.peer.on('error', (err) => {
      if (err.type === 'peer-unavailable') {
        this.listener.status(this.seen ? 'host-away' : 'not-found');
        this.scheduleRetry();
      } else if (['network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) {
        this.listener.status('offline');
        this.scheduleRetry();
      }
    });
  }

  scheduleRetry() {
    if (this.closed || this.retry) return;
    this.retry = setTimeout(() => {
      this.retry = null;
      if (this.peer.open) this.connect();
      else this.scheduleRetry();
    }, RETRY_MS);
  }

  connect() {
    if (this.closed) return;
    const conn = this.peer.connect(PREFIX + this.code, { reliable: true });
    this.conn = conn;
    conn.on('open', () => conn.send({ t: 'join', name: this.name, token: this.token }));
    conn.on('data', (msg) => {
      if (msg?.t === 'state') {
        this.seen = true;
        this.listener.status('online');
        this.listener.state(msg.view);
      } else if (msg?.t === 'error') {
        this.listener.error(msg.message);
      } else if (msg?.t === 'denied') {
        this.closed = true;
        this.listener.denied(msg.message);
      }
    });
    conn.on('close', () => {
      if (this.conn !== conn || this.closed) return;
      this.listener.status('host-away');
      this.scheduleRetry();
    });
  }

  send(action) {
    if (this.conn?.open) this.conn.send({ t: 'action', action });
    else this.listener.error('Not connected to the host right now.');
  }
}
