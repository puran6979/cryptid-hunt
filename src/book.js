// Built from the game's own clue list, so the book can't drift from what is dealt.
import { clueCatalog, clueText } from './rules.js';

const CHAPTERS = [
  ['On terrain', ['terrainPair']],
  ['Near terrain', ['nearTerrain']],
  ['Near animals', ['nearAnyAnimal', 'nearAnimal']],
  ['Near structures', ['nearStructure']],
];

const catalog = clueCatalog();
let number = 0;

function chapter(title, kinds, negated) {
  const clues = catalog
    .filter((clue) => kinds.includes(clue.kind))
    .map((clue) => clueText(negated ? { ...clue, negated: true } : clue));
  const start = number + 1;
  number += clues.length;
  return `<h3>${title} <span class="count">(${clues.length})</span></h3>
    <ol start="${start}">${clues.map((text) => `<li>${text}</li>`).join('')}</ol>`;
}

function part(title, note, negated) {
  return `<h2>${title}</h2><p class="fine">${note}</p>
    ${CHAPTERS.map(([name, kinds]) => chapter(name, kinds, negated)).join('')}`;
}

document.getElementById('chapters').innerHTML =
  part('Part 1: Standard clues', 'Used in every game.', false)
  + part('Part 2: "Not" clues', 'Advanced games only.', true);
document.getElementById('total').textContent = number;
document.getElementById('print').addEventListener('click', () => window.print());
