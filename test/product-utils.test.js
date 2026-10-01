import test from 'node:test';
import assert from 'node:assert/strict';
import { matches } from '../src/bot.js';
import { amazonAsinFromUrl, copagProductCodeFromUrl, mercadoLivreCodeFromUrl, normalizeText, priceFromText, shippingFromText, storeFromUrl } from '../src/product-utils.js';

test('converte preço brasileiro', () => {
  assert.equal(priceFromText('Por R$ 1.299,90'), 1299.9);
  assert.equal(priceFromText('indisponível'), null);
});

test('identifica frete grátis e frete pago', () => {
  assert.equal(shippingFromText('Frete grátis'), 0);
  assert.equal(shippingFromText('Frete R$ 19,90'), 19.9);
});

test('normaliza texto e ASIN da Amazon', () => {
  assert.equal(normalizeText('Amazon.com.br'), 'amazon.com.br');
  assert.equal(amazonAsinFromUrl('https://www.amazon.com.br/dp/B0H78BB9TY?tag=test'), 'B0H78BB9TY');
  assert.equal(amazonAsinFromUrl('https://www.amazon.com.br/gp/product/B0H78BB9TY'), 'B0H78BB9TY');
});

test('identifica lojas e código do Mercado Livre', () => {
  assert.equal(storeFromUrl('https://www.amazon.com.br/dp/B0H78BB9TY'), 'amazon');
  assert.equal(storeFromUrl('https://www.mercadolivre.com.br/MLB-123456789-produto/p/MLB123'), 'mercadolivre');
  assert.equal(mercadoLivreCodeFromUrl('https://www.mercadolivre.com.br/MLB-123456789-produto/p/MLB123'), 'MLB123456789');
});

test('identifica produto individual da Copag', () => {
  const url = 'https://www.copagloja.com.br/blister-triplo-pokemon-me05-escuridao-absoluta/p';
  assert.equal(storeFromUrl(url), 'copag');
  assert.equal(copagProductCodeFromUrl(url), 'blister-triplo-pokemon-me05-escuridao-absoluta');
  assert.equal(copagProductCodeFromUrl('https://www.copagloja.com.br/pokemon'), null);
});

test('vota nos termos configurados e em variações próximas', () => {
  const terms = ['meu', 'seu', 'aqui', 'meuu', 'aquii', 'aqui é seu'];
  assert.equal(matches('meu 0', terms), true);
  assert.equal(matches('aqui é seu 0', terms), true);
  assert.equal(matches('meuu 0', terms), true);
  assert.equal(matches('aquii 0', terms), true);
  assert.equal(matches('meuz 0', terms), true);
  assert.equal(matches('testee 0', terms), false);
});
