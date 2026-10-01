const LIGA_POKEMON_URL = 'https://www.ligapokemon.com.br/';
const CACHE_TTL_MS = 2 * 60_000;
const cache = new Map();

function decodeHtml(value) {
  return String(value)
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
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

async function cardImage(url, request) {
  try {
    const response = await request(url, {
      headers: {
        'User-Agent': 'PokeBot card price lookup',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    return response.ok ? parseLigaPokemonCardImage(await response.text()) : null;
  } catch {
    return null;
  }
}

export async function searchLigaPokemon(number, request = fetch) {
  const query = normalizeCardNumber(number);
  const cached = cache.get(query);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.results;

  const url = new URL(LIGA_POKEMON_URL);
  url.searchParams.set('view', 'cards/search');
  url.searchParams.set('card', query);

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

  const cards = parseLigaPokemonSearch(await response.text());
  const images = await Promise.all(cards.map((card) => cardImage(card.url, request)));
  const results = cards.map((card, index) => ({ ...card, image: images[index] }));
  cache.set(query, { at: Date.now(), results });
  return results;
}
