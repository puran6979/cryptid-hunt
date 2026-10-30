import { clueMatches, clueText, COLS, MIN_PLAYERS, ROWS, spaceName } from './rules.js';
import { GuestSession, hasSavedRoom, HostSession, newRoomCode } from './net.js';

const app = document.getElementById('app');
const SIZE = 30;
const H = Math.sqrt(3) * SIZE;
const CORNERS = [0, 1, 2, 3, 4, 5].map((i) => {
  const a = (Math.PI / 3) * i;
  return [Math.cos(a), Math.sin(a)];
});
const STATUS = {
  connecting: 'Connecting…',
  online: 'Connected',
  offline: 'Connection lost. Retrying…',
  'host-away': 'Waiting for the host to come back…',
  'not-found': 'Looking for that room…',
};

let session = null;
let view = null;
let status = 'connecting';
let selected = null;
let showClue = false;
let message = '';
let homeError = '';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const storedName = () => {
  try {
    return localStorage.getItem('cryptid-name') ?? '';
  } catch {
    return '';
  }
};
const rememberName = (name) => {
  try {
    localStorage.setItem('cryptid-name', name);
  } catch {
    // Storage may be blocked; the name just won't be prefilled next time.
  }
};
const roomFromHash = () => location.hash.slice(1).toUpperCase().replace(/[^A-Z]/g, '');

const listener = {
  state(next) {
    view = next;
    render();
  },
  status(next) {
    status = next;
    render();
  },
  error(text) {
    message = text;
    render();
  },
  denied(text) {
    session = null;
    view = null;
    homeError = text;
    history.replaceState(null, '', location.pathname);
    render();
  },
};

function enterRoom(code, name, asHost) {
  rememberName(name);
  location.hash = code;
  session = asHost ? new HostSession(code, name, listener) : new GuestSession(code, name, listener);
  render();
}

function renderHome() {
  const code = roomFromHash();
  app.innerHTML = `
    <main class="home">
      <p class="eyebrow">A hidden-clue deduction game for 3–5 hunters</p>
      <h1>Cryptid Hunt</h1>
      <p class="lede">Everyone holds one clue to where the creature lives. Question your friends, read the
      board, and work out their clues before they work out yours.</p>
      ${homeError ? `<p class="error" role="alert">${esc(homeError)}</p>` : ''}
      <form id="home-form" class="card">
        <label for="name">Your name</label>
        <input id="name" maxlength="16" autocomplete="off" value="${esc(storedName())}" required>
        ${code
          ? `<p>Joining room <strong class="code">${esc(code)}</strong></p>
             <button class="primary" name="join">Join room</button>
             <button type="button" class="link" data-act="leave-code">Start a different room</button>`
          : `<button class="primary" name="create">Create a room</button>
             <div class="divider">or join one</div>
             <label for="code">Room code</label>
             <div class="row">
               <input id="code" maxlength="5" autocomplete="off" autocapitalize="characters" placeholder="ABCDE">
               <button name="join">Join</button>
             </div>`}
      </form>
      <details class="card rules"><summary>How to play</summary>${rulesHtml()}</details>
      <p class="fine">Unofficial fan project, not affiliated with or endorsed by the publishers of Cryptid.</p>
    </main>`;
}

function rulesHtml() {
  return `<ol>
    <li><strong>Setup.</strong> Each player places two cubes on spaces their clue rules out.</li>
    <li><strong>Question.</strong> On your turn, pick a space and ask another player. They answer automatically
      and truthfully: a disc means their clue allows it, a cube means it doesn't.</li>
    <li><strong>Penalty.</strong> If you get a cube, you must place one of your own on a space your clue rules out, which gives information away.</li>
    <li><strong>Search.</strong> Or, pick a space your clue allows and search it. Each player answers in turn. The first cube ends the search and you take a penalty.</li>
    <li><strong>Win.</strong> If every player answers with a disc, you've found the habitat.</li>
  </ol>`;
}

function renderLobby() {
  const { code, roster, isHost } = view;
  const url = `${location.origin}${location.pathname}#${code}`;
  const enough = roster.length >= MIN_PLAYERS;
  app.innerHTML = `
    <main class="home">
      <p class="eyebrow">Room</p>
      <h1 class="code big">${esc(code)}</h1>
      <div class="card">
        <label for="share">Send this link to your friends</label>
        <div class="row">
          <input id="share" readonly value="${esc(url)}">
          <button data-act="copy">Copy</button>
        </div>
      </div>
      <div class="card">
        <h2>Hunters (${roster.length}/5)</h2>
        <ul class="roster">${roster.map((p, i) => `
          <li><span class="swatch p${i}">${i + 1}</span>${esc(p.name)}
          ${p.online ? '' : '<em>away</em>'}</li>`).join('')}</ul>
        ${isHost ? `
          <label class="check"><input type="checkbox" id="advanced"> Advanced: one clue says where the habitat is <em>not</em></label>
          <button class="primary" data-act="start" ${enough ? '' : 'disabled'}>
            ${enough ? 'Start the hunt' : `Need ${MIN_PLAYERS - roster.length} more to start`}
          </button>
          <p class="fine">Keep this tab open while you play. Your browser is running the game.</p>`
        : `<p>Waiting for the host to start… (${esc(STATUS[status] ?? '')})</p>`}
      </div>
      <details class="card rules"><summary>How to play</summary>${rulesHtml()}</details>
    </main>`;
}

function hexCenter(hex) {
  return [SIZE + 1.5 * SIZE * hex.c + 4, H / 2 + H * hex.r + (hex.c & 1 ? H / 2 : 0) + 4];
}

function hexPoints(x, y, scale = 1) {
  return CORNERS.map(([cx, cy]) => `${(x + cx * SIZE * scale).toFixed(1)},${(y + cy * SIZE * scale).toFixed(1)}`).join(' ');
}

function needsCube(game) {
  return (game.phase === 'setup' && game.current === game.me)
    || (game.phase === 'penalty' && game.pendingCube === game.me);
}

function legalCube(game, hex) {
  return game.cubes[hex.id] === undefined && !clueMatches(game.map, game.myClue, hex);
}

function renderBoard(game) {
  const width = 1.5 * SIZE * COLS + SIZE / 2 + 8;
  const height = H * ROWS + H / 2 + 8;
  const placing = needsCube(game);
  // SVG paints in order, so emphasised hexes go last to keep their outlines on top.
  const emphasis = (hex) => [game.lastHex, selected, game.reveal?.habitat].indexOf(hex.id) + 1;
  const ordered = [...game.map.hexes].sort((a, b) => emphasis(a) - emphasis(b));
  const cells = ordered.map((hex) => {
    const [x, y] = hexCenter(hex);
    const excluded = !clueMatches(game.map, game.myClue, hex);
    const dim = (placing && !legalCube(game, hex)) || (showClue && !placing && excluded);
    const classes = ['hex', dim ? 'dim' : '', selected === hex.id ? 'selected' : '',
      game.lastHex === hex.id ? 'last' : '', game.reveal?.habitat === hex.id ? 'habitat' : ''].join(' ');
    const animal = hex.animal
      ? `<polygon class="territory ${hex.animal}" points="${hexPoints(x, y, 0.86)}"/>
         <text class="glyph" x="${x + 13}" y="${y - 12}">${hex.animal === 'bear' ? '🐻' : '🐆'}</text>` : '';
    const structure = hex.structure
      ? `<text class="glyph big" x="${x - 11}" y="${y - 6}">${hex.structure === 'stone' ? '🗿' : '🏚️'}</text>` : '';
    const cube = game.cubes[hex.id];
    const cubeEl = cube === undefined ? '' : `
      <rect class="p${cube} token" x="${x - 11}" y="${y - 11}" width="22" height="22" rx="3"/>
      <text class="token-num" x="${x}" y="${y + 5}">${cube + 1}</text>`;
    const discs = (game.discs[hex.id] ?? []).map((p, i, all) => {
      const dx = x + (i - (all.length - 1) / 2) * Math.min(13, 40 / Math.max(all.length - 1, 1));
      return `<circle class="p${p} token" cx="${dx}" cy="${y + 16}" r="7"/>
        <text class="token-num small" x="${dx}" y="${y + 19.5}">${p + 1}</text>`;
    }).join('');
    return `<g class="${classes}" data-hex="${hex.id}" role="button" tabindex="0"
      aria-label="${spaceName(hex)}, ${hex.terrain}${hex.structure ? `, ${hex.structure}` : ''}${hex.animal ? `, ${hex.animal} territory` : ''}">
      <polygon class="cell" fill="url(#t-${hex.terrain})" points="${hexPoints(x, y)}"/>
      ${animal}${structure}
      <text class="coord" x="${x}" y="${y + 26}">${spaceName(hex)}</text>
      ${game.reveal?.habitat === hex.id ? `<text class="glyph big" x="${x + 2}" y="${y + 3}">🐾</text>` : ''}
      ${discs}${cubeEl}
    </g>`;
  }).join('');
  return `<svg class="board" viewBox="0 0 ${width.toFixed(0)} ${height.toFixed(0)}" role="group" aria-label="Game map">
    <defs>
      ${pattern('forest', '#2f6b45', '<path d="M8 3l4 8H4z" fill="#255a39"/>')}
      ${pattern('desert', '#d9b56c', '<path d="M1 10q4-3 7 0t7 0" stroke="#c49d52" fill="none"/>')}
      ${pattern('swamp', '#6f7d3a', '<path d="M5 13V6M9 13V4M13 13V7" stroke="#59662c"/>')}
      ${pattern('mountain', '#837d8a', '<path d="M2 13l5-8 5 8" stroke="#6b6572" fill="none"/>')}
      ${pattern('water', '#3f7fb5', '<path d="M1 6q3-3 6 0t6 0M1 12q3-3 6 0t6 0" stroke="#336c9c" fill="none"/>')}
    </defs>
    ${cells}
  </svg>`;
}

function pattern(id, base, marks) {
  return `<pattern id="t-${id}" width="16" height="16" patternUnits="userSpaceOnUse">
    <rect width="16" height="16" fill="${base}"/>${marks}</pattern>`;
}

function hexDescription(hex) {
  const parts = [hex.terrain];
  if (hex.structure) parts.push(hex.structure === 'stone' ? 'standing stone' : 'abandoned shack');
  if (hex.animal) parts.push(`${hex.animal} territory`);
  return `${spaceName(hex)}: ${parts.join(', ')}`;
}

function turnLine(game) {
  const name = (i) => esc(game.names[i]);
  if (game.phase === 'over') return `${name(game.winner)} found the cryptid!`;
  if (needsCube(game)) {
    return game.phase === 'setup'
      ? `Your turn: place a setup cube (${Math.ceil(game.setupLeft / game.names.length)} of 2 rounds left)`
      : 'Place a cube on a space your clue rules out';
  }
  if (game.phase === 'penalty') return `Waiting for ${name(game.pendingCube)} to place a cube`;
  if (game.current === game.me) {
    return game.phase === 'setup' ? 'Your turn' : 'Your turn: pick a space, then question or search';
  }
  return `Waiting for ${name(game.current)}`;
}

function renderActions(game) {
  if (game.phase === 'over') {
    return `<div class="card reveal"><h2>The clues</h2><ul>
      ${game.reveal.clues.map((clue, i) => `<li><strong>${esc(game.names[i])}:</strong> ${esc(clueText(clue))}</li>`).join('')}
      </ul>${view.isHost ? '<button class="primary" data-act="lobby">Back to lobby</button>' : '<p>The host can start a new game.</p>'}</div>`;
  }
  const hex = selected === null ? null : game.map.hexes[selected];
  const heading = hex ? `<p class="picked">${esc(hexDescription(hex))}</p>` : '';
  if (needsCube(game)) {
    if (!hex) return '<div class="card"><p>Tap a bright space on the map.</p></div>';
    const legal = legalCube(game, hex);
    return `<div class="card">${heading}
      <button class="primary" data-act="cube" ${legal ? '' : 'disabled'}>Place cube here</button>
      ${legal ? '' : '<p class="fine">Your clue allows this space, or it already has a cube.</p>'}</div>`;
  }
  if (game.phase !== 'turn' || game.current !== game.me) {
    return `<div class="card">${heading || '<p>Tap a space to inspect it.</p>'}</div>`;
  }
  if (!hex) return '<div class="card"><p>Tap a space on the map.</p></div>';
  if (game.cubes[hex.id] !== undefined) {
    return `<div class="card">${heading}<p class="fine">This space has a cube, so it can't be the habitat.</p></div>`;
  }
  const discs = game.discs[hex.id] ?? [];
  const canSearch = clueMatches(game.map, game.myClue, hex);
  return `<div class="card">${heading}
    <h3>Question</h3>
    <div class="ask">${game.names.map((name, i) => (i === game.me ? '' : `
      <button data-act="ask" data-target="${i}" ${discs.includes(i) ? 'disabled' : ''}>
        <span class="swatch p${i}">${i + 1}</span>${esc(name)}</button>`)).join('')}</div>
    <h3>Or search</h3>
    <button class="primary" data-act="search" ${canSearch ? '' : 'disabled'}>Search this space</button>
    ${canSearch ? '' : '<p class="fine">Your own clue rules this space out.</p>'}
  </div>`;
}

function renderGame() {
  const game = view.game;
  const active = game.phase === 'penalty' ? game.pendingCube : game.current;
  const mine = game.phase !== 'over' && active === game.me;
  document.title = mine ? '● Your turn - Cryptid Hunt' : 'Cryptid Hunt';
  const logScroll = app.querySelector('.log')?.scrollTop;
  const mapScroll = app.querySelector('.map-scroll')?.scrollLeft ?? 0;
  app.innerHTML = `
    <header class="top">
      <strong>Cryptid Hunt</strong>
      <span class="code">${esc(view.code)}</span>
      ${status === 'online' ? '' : `<span class="warn" role="status">${esc(STATUS[status] ?? '')}</span>`}
    </header>
    <div class="banner ${mine ? 'mine' : ''} ${game.phase === 'over' ? 'won' : ''}" aria-live="polite">${turnLine(game)}</div>
    ${message ? `<p class="error" role="alert">${esc(message)}</p>` : ''}
    <div class="layout">
      <section class="map-wrap"><div class="map-scroll">${renderBoard(game)}</div>
        <p class="legend">🗿 standing stone · 🏚️ shack · 🐻 bear · 🐆 cougar · ■ cube = no · ● disc = maybe</p>
      </section>
      <aside>
        <div class="card clue"><h2>Your secret clue</h2><p>${esc(clueText(game.myClue))}</p>
          <label class="check"><input type="checkbox" id="show-clue" ${showClue ? 'checked' : ''}> Dim spaces my clue rules out</label>
        </div>
        <div class="actions">${renderActions(game)}</div>
        <div class="card"><h2>Hunters</h2><ul class="roster">${view.roster.map((p, i) => `
          <li class="${i === active && game.phase !== 'over' ? 'active' : ''}"><span class="swatch p${i}">${i + 1}</span>
          ${esc(p.name)}${i === game.me ? ' <em>you</em>' : ''}${p.online ? '' : ' <em class="warn">away</em>'}</li>`).join('')}</ul></div>
        <div class="card"><h2>Log</h2><ol class="log">${game.log.map((l) => `<li>${esc(l)}</li>`).join('')}</ol></div>
      </aside>
    </div>`;
  app.querySelector('.map-scroll').scrollLeft = mapScroll;
  const log = app.querySelector('.log');
  log.scrollTop = logScroll && logScroll + log.clientHeight < log.scrollHeight - 40 ? logScroll : log.scrollHeight;
}

function render() {
  if (!session) {
    document.title = 'Cryptid Hunt';
    renderHome();
  } else if (!view) {
    app.innerHTML = `<main class="home"><h1>Cryptid Hunt</h1><p role="status">${esc(STATUS[status] ?? 'Connecting…')}</p>
      <button data-act="leave">Back</button></main>`;
  } else if (!view.game) {
    selected = null;
    renderLobby();
  } else {
    renderGame();
  }
}

function perform(action) {
  message = '';
  session.send(action);
  selected = null;
  render();
}

app.addEventListener('submit', (event) => {
  event.preventDefault();
  const name = app.querySelector('#name').value.trim();
  if (!name) return;
  homeError = '';
  const hashCode = roomFromHash();
  if (event.submitter?.name === 'create') {
    enterRoom(newRoomCode(), name, true);
  } else {
    const code = hashCode || app.querySelector('#code').value.toUpperCase().replace(/[^A-Z]/g, '');
    if (code.length !== 5) {
      homeError = 'Room codes have 5 letters.';
      render();
      return;
    }
    enterRoom(code, name, hasSavedRoom(code));
  }
});

function pickHex(id) {
  selected = selected === id ? null : id;
  message = '';
  render();
}

app.addEventListener('click', (event) => {
  const hexEl = event.target.closest('[data-hex]');
  if (hexEl) {
    pickHex(Number(hexEl.dataset.hex));
    return;
  }
  const button = event.target.closest('[data-act]');
  if (!button) return;
  switch (button.dataset.act) {
    case 'copy': {
      const input = app.querySelector('#share');
      navigator.clipboard?.writeText(input.value).catch(() => input.select());
      button.textContent = 'Copied';
      break;
    }
    case 'start':
      session.start(app.querySelector('#advanced').checked);
      break;
    case 'lobby':
      session.backToLobby();
      break;
    case 'cube':
      perform({ type: 'placeCube', hex: selected });
      break;
    case 'ask':
      perform({ type: 'question', hex: selected, target: Number(button.dataset.target) });
      break;
    case 'search':
      perform({ type: 'search', hex: selected });
      break;
    case 'leave':
    case 'leave-code':
      location.href = location.pathname;
      break;
  }
});

app.addEventListener('keydown', (event) => {
  const hexEl = event.target.closest?.('[data-hex]');
  if (hexEl && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault();
    const id = hexEl.dataset.hex;
    pickHex(Number(id));
    app.querySelector(`[data-hex="${id}"]`)?.focus();
  }
});

app.addEventListener('change', (event) => {
  if (event.target.id === 'show-clue') {
    showClue = event.target.checked;
    render();
  }
});

// A returning host or guest rejoins their room from the link without retyping anything.
const initial = roomFromHash();
if (initial && hasSavedRoom(initial)) enterRoom(initial, storedName(), true);
else if (initial && storedName() && localStorageHasToken(initial)) enterRoom(initial, storedName(), false);
else render();

function localStorageHasToken(code) {
  try {
    return localStorage.getItem(`cryptid-token-${code}`) !== null;
  } catch {
    return false;
  }
}
