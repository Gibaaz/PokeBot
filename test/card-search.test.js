import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeCardNumber, parseLigaPokemonCardImage, parseLigaPokemonSearch } from '../src/card-search.js';

const searchHtml = `
  <a href="/?view=cards/card&amp;card=Mew+ex+(158%2F128)&amp;ed=30C&amp;num=158">Mew ex</a>
  <a href="/?view=cards/card&amp;card=Mew+ex+(158%2F128)&amp;ed=30C&amp;num=158">Mew ex</a>
  <a href="/?view=cards/search&amp;card=edid=804">30th Celebration</a>
  R$ 488,90 R$ 854,90 R$ 5.000,00
`;

test('normaliza número de carta', () => {
  assert.equal(normalizeCardNumber(' #tg29 / tg30 '), 'TG29/TG30');
  assert.throws(() => normalizeCardNumber('158?128'), /número de carta válido/);
});

test('extrai e consolida cartas da busca da Liga Pokémon', () => {
  assert.deepEqual(parseLigaPokemonSearch(searchHtml), [{
    name: 'Mew ex',
    number: '158/128',
    edition: '30th Celebration',
    lowestPrice: 488.9,
    averagePrice: 854.9,
    highestPrice: 5000,
    url: 'https://www.ligapokemon.com.br/?view=cards/card&card=Mew+ex+(158%2F128)&ed=30C&num=158',
  }]);
});

test('extrai a imagem da página da carta', () => {
  const html = '<img class="card" src="//repositorio.sbrauble.com/arquivos/in/pokemon/card.jpg" alt="Mew ex">';
  assert.equal(parseLigaPokemonCardImage(html), 'https://repositorio.sbrauble.com/arquivos/in/pokemon/card.jpg');
});
