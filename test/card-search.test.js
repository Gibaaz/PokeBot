import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeCardNumber, parseLigaPokemonCardImage, parseLigaPokemonCardRarity, parseLigaPokemonEditionCards, parseLigaPokemonEditions, parseLigaPokemonSearch } from '../src/card-search.js';

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

test('extrai raridade dos detalhes da carta', () => {
  const html = '<section>Detalhes da Carta<div>Raridade</div><div>Rara Futurista</div><div>(30C)</div><div>Tipo</div></section>';
  assert.equal(parseLigaPokemonCardRarity(html), 'Rara Futurista');
});

test('extrai o catálogo de coleções da Liga Pokémon', () => {
  const html = '<script>let jsonEditions = {"main":[{"id":"804","acronym":"30C","name":"Celebração de 30 Anos"}]};</script>';
  assert.deepEqual(parseLigaPokemonEditions(html), [{ id: '804', acronym: '30C', name: 'Celebração de 30 Anos' }]);
});

test('extrai todas as cartas e raridades de uma coleção', () => {
  const html = `<h3 class="editions-middle__title">Celebração de 30 Anos</h3>
    <script>var cardsjson = [{"id":531,"idE":804,"sSigla":"30C","sN":"001","nEN":"Exeggcute (#001/128)","nPT":"Exeggcute","p1a":"0.75","p1b":"1.47","p1c":"4.90","iR":1,"sP":"//arquivos/in/pokemon/card.jpg"}]; edc.edicao = 804;
    edc.raridade = [{"id":1,"label":"C"}]; edc.filters.push('raridade');</script>`;
  assert.deepEqual(parseLigaPokemonEditionCards(html), [{
    name: 'Exeggcute',
    number: '001',
    edition: 'Celebração de 30 Anos',
    rarity: 'C',
    lowestPrice: 0.75,
    averagePrice: 1.47,
    highestPrice: 4.9,
    image: 'https://repositorio.sbrauble.com/arquivos/in/pokemon/card.jpg',
    url: 'https://www.ligapokemon.com.br/?view=cards%2Fcard&ed=804&num=001&card=Exeggcute+%28%23001%2F128%29&aux=Exeggcute',
  }]);
});

test('decodifica entidades HTML no nome da carta da coleção', () => {
  const html = `<h3 class="editions-middle__title">Teste</h3>
    <script>var cardsjson = [{"id":1,"idE":1,"sN":"001","nEN":"Substitui&ccedil;&atilde;o (#001)","nPT":"Substitui&ccedil;&atilde;o","p1a":"1","p1b":"1","p1c":"1","iR":1,"sP":""}]; edc.edicao = 1;
    edc.raridade = [{"id":1,"label":"C"}]; edc.filters.push('raridade');</script>`;
  assert.equal(parseLigaPokemonEditionCards(html)[0].name, 'Substituição');
});
