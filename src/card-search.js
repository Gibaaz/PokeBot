const LIGA_POKEMON_URL = 'https://www.ligapokemon.com.br/';
const CARD_CACHE_TTL_MS = 2 * 60_000;
const COLLECTION_CACHE_TTL_MS = 30 * 60_000;
const EDITIONS_CACHE_TTL_MS = 12 * 60 * 60_000;
const cache = new Map();

function decodeHtml(value) {
  const namedEntities = {
    amp: '&', quot: '"', apos: "'", nbsp: ' ',
    aacute: 'á', agrave: 'à', acirc: 'â', atilde: 'ã', auml: 'ä', aring: 'å',
    eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë',
    iacute: 'í', igrave: 'ì', icirc: 'î', iuml: 'ï',
    oacute: 'ó', ograve: 'ò', ocirc: 'ô', otilde: 'õ', ouml: 'ö',
    uacute: 'ú', ugrave: 'ù', ucirc: 'û', uuml: 'ü',
    ccedil: 'ç', ntilde: 'ñ',
  };
  return String(value)
    .replace(/&([a-z]+);/gi, (entity, name) => namedEntities[name.toLowerCase()] ?? entity)
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

function textFromHtml(value) {
  return decodeHtml(String(value).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function priceFromText(value) {
  const match = String(value).match(/R\$\s*([\d.]+,\d{2})/);
  return match ? Number(match[1].replace(/\./g, '').replace(',', '.')) : null;
}

export function normalizeCardNumber(value) {
  const number = String(value || '').trim().replace(/^#/, '').replace(/\s+/g, '').toUpperCase();
  if (!number) throw new Error('Informe o número da carta, por exemplo 158/128.');
  if (!/^[A-Z0-9]+(?:\/[A-Z0-9]+)?$/.test(number)) throw new Error('Use um número de carta válido, como 158/128 ou TG29/TG30.');
  return number;
}

function cardFromLink(href, block) {
  const url = new URL(decodeHtml(href), LIGA_POKEMON_URL);
  const card = url.searchParams.get('card');
  if (!card) return null;

  const cardText = card.replace(/\s*\([^)]*\)\s*$/, '').trim();
  const number = card.match(/\(([^)]+)\)/)?.[1] || url.searchParams.get('num') || '';
  const editionMatch = block.match(/<a\b[^>]*href=["'][^"']*view=cards\/search[^"']*["'][^>]*>([\s\S]*?)<\/a>/i);
  const prices = [...block.matchAll(/R\$\s*[\d.]+,\d{2}/g)].map((match) => priceFromText(match[0]));

  return {
    name: cardText,
    number,
    edition: editionMatch ? textFromHtml(editionMatch[1]) : '',
    lowestPrice: prices[0] ?? null,
    averagePrice: prices[1] ?? null,
    highestPrice: prices[2] ?? null,
    url: url.toString(),
    score: (editionMatch ? 1 : 0) + prices.length,
  };
}

export function parseLigaPokemonSearch(html) {
  const links = [...String(html).matchAll(/<a\b[^>]*href=["']([^"']*view=cards\/card[^"']*)["'][^>]*>/gi)];
  const cards = links.map((match, index) => {
    const nextMatch = links[index + 1];
    const block = String(html).slice(match.index, nextMatch?.index);
    return cardFromLink(match[1], block);
  }).filter((card) => card && card.name && card.number);
  const unique = new Map();
  cards.forEach((card) => {
    const previous = unique.get(card.url);
    if (!previous || card.score > previous.score) unique.set(card.url, card);
  });
  return [...unique.values()].map(({ score, ...card }) => card);
}

export function parseLigaPokemonCardImage(html) {
  const match = String(html).match(/<(?:img)\b[^>]*(?:src|data-src)=["']([^"']*repositorio\.sbrauble\.com[^"']*\.(?:jpg|jpeg|png|webp)[^"']*)["'][^>]*>/i);
  if (!match) return null;
  const imageUrl = decodeHtml(match[1]);
  return imageUrl.startsWith('//') ? `https:${imageUrl}` : imageUrl;
}

export function parseLigaPokemonCardRarity(html) {
  const details = String(html).match(/Detalhes da Carta([\s\S]*?)(?:Últimas Vendas|Comprar no Marketplace|Lojas Vendendo)/i)?.[1] || String(html);
  const text = textFromHtml(details);
  const match = text.match(/\bRaridade\s+(.+?)(?=\s+\([A-Z0-9.-]+\)|\s+(?:Tipo|Edição|Numero|Número|Artista)\b|$)/i);
  return match ? match[1].trim() : '';
}

export function parseLigaPokemonEditions(html) {
  const match = String(html).match(/\b(?:let|var)\s+jsonEditions\s*=\s*(\{[\s\S]*?\})\s*;/);
  if (!match) return [];
  let data;
  try {
    data = JSON.parse(match[1]);
  } catch {
    return [];
  }

  const editions = [];
  const visit = (value) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== 'object') return;
    if (value.id && value.acronym && value.name) {
      editions.push({ id: String(value.id), acronym: String(value.acronym), name: String(value.name) });
    }
    Object.values(value).forEach(visit);
  };
  visit(data);
  const unique = new Map();
  editions.forEach((edition) => unique.set(edition.id, edition));
  return [...unique.values()].sort((first, second) => first.name.localeCompare(second.name, 'pt-BR'));
}

function jsonAssignment(html, pattern) {
  const match = String(html).match(pattern);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

export function parseLigaPokemonEditionCards(html) {
  const cards = jsonAssignment(html, /\bvar\s+cardsjson\s*=\s*(\[[\s\S]*?\])\s*;\s*edc\.edicao/);
  const rarities = jsonAssignment(html, /\bedc\.raridade\s*=\s*(\[[\s\S]*?\])\s*;\s*edc\.filters/);
  if (!cards || !rarities) return [];
  const rarityById = new Map(rarities.map((rarity) => [Number(rarity.id), String(rarity.label || '')]));
  const edition = textFromHtml(String(html).match(/<h3\b[^>]*class=["'][^"']*editions-middle__title[^"']*["'][^>]*>([\s\S]*?)<\/h3>/i)?.[1] || '');
  return cards.map((card) => {
    const name = decodeHtml(card.nPT || card.nEN || '').trim();
    const number = decodeHtml(card.sN || card.nEN?.match(/\(#?([^)]+)\)/)?.[1] || '').trim();
    const url = new URL(LIGA_POKEMON_URL);
    url.searchParams.set('view', 'cards/card');
    url.searchParams.set('ed', String(card.idE || ''));
    url.searchParams.set('num', number);
    url.searchParams.set('card', decodeHtml(card.nEN || name));
    if (card.nPT) url.searchParams.set('aux', decodeHtml(card.nPT));
    const imagePath = String(card.sP || '').replace(/^\/+/, '');
    return {
      name,
      number,
      edition,
      rarity: rarityById.get(Number(card.iR)) || '',
      lowestPrice: Number.isFinite(Number(card.p1a)) ? Number(card.p1a) : null,
      averagePrice: Number.isFinite(Number(card.p1b)) ? Number(card.p1b) : null,
      highestPrice: Number.isFinite(Number(card.p1c)) ? Number(card.p1c) : null,
      image: imagePath ? `https://repositorio.sbrauble.com/${imagePath}` : null,
      url: url.toString(),
    };
  }).filter((card) => card.name && card.number);
}

async function cardDetails(url, request) {
  try {
    const response = await request(url, {
      headers: {
        'User-Agent': 'PokeBot card price lookup',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!response.ok) return { image: null, rarity: '' };
    const html = await response.text();
    return { image: parseLigaPokemonCardImage(html), rarity: parseLigaPokemonCardRarity(html) };
  } catch {
    return { image: null, rarity: '' };
  }
}

async function mapWithConcurrency(items, limit, callback) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await callback(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function enrichCards(cards, request) {
  const details = await mapWithConcurrency(cards, 4, (card) => cardDetails(card.url, request));
  return cards.map((card, index) => ({ ...card, ...details[index] }));
}

async function fetchLigaHtml(url, request) {
  let response;
  try {
    response = await request(url, {
      headers: {
        'User-Agent': 'PokeBot card price lookup',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
  } catch {
    throw new Error('Não foi possível conectar à Liga Pokémon. Tente novamente.');
  }
  if (!response.ok) throw new Error('A Liga Pokémon não aceitou a consulta. Tente novamente em alguns minutos.');
  return response.text();
}

async function fetchSearch(url, request) {
  return parseLigaPokemonSearch(await fetchLigaHtml(url, request));
}

export async function searchLigaPokemon(number, request = fetch) {
  const query = normalizeCardNumber(number);
  const cacheKey = `card:${query}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CARD_CACHE_TTL_MS) return cached.results;

  const url = new URL(LIGA_POKEMON_URL);
  url.searchParams.set('view', 'cards/search');
  url.searchParams.set('card', query);
  const results = await enrichCards(await fetchSearch(url, request), request);
  cache.set(cacheKey, { at: Date.now(), results });
  return results;
}

export async function listLigaPokemonEditions(request = fetch) {
  const cacheKey = 'editions';
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < EDITIONS_CACHE_TTL_MS) return cached.results;
  const url = new URL(LIGA_POKEMON_URL);
  url.searchParams.set('view', 'cards/edicoes');
  let response;
  try {
    response = await request(url, { headers: { 'User-Agent': 'PokeBot card price lookup', Accept: 'text/html,application/xhtml+xml' } });
  } catch {
    throw new Error('Não foi possível carregar as coleções da Liga Pokémon.');
  }
  if (!response.ok) throw new Error('A Liga Pokémon não aceitou a consulta de coleções.');
  const results = parseLigaPokemonEditions(await response.text());
  cache.set(cacheKey, { at: Date.now(), results });
  return results;
}

export async function searchLigaPokemonEdition(edition, request = fetch) {
  const id = String(edition?.id || '');
  const acronym = String(edition?.acronym || '');
  if (!/^\d+$/.test(id) || !/^[A-Z0-9.-]+$/i.test(acronym)) throw new Error('Coleção inválida.');
  const cacheKey = `edition:${id}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < COLLECTION_CACHE_TTL_MS) return cached.results;

  const url = new URL(LIGA_POKEMON_URL);
  url.searchParams.set('view', 'cards/search');
  url.searchParams.set('card', `edid=${id} ed=${acronym}`);
  const results = parseLigaPokemonEditionCards(await fetchLigaHtml(url, request));
  cache.set(cacheKey, { at: Date.now(), results });
  return results;
}
