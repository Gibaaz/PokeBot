export function priceFromText(text) {
  const match = String(text).match(/R\$\s*([\d.]+,\d{2})/);
  return match ? Number(match[1].replace(/\./g, '').replace(',', '.')) : null;
}

export function normalizeText(text) {
  return String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export function shippingFromText(text) {
  if (/frete gr[aá]tis/i.test(text)) return 0;
  return priceFromText(text);
}

export function amazonAsinFromUrl(url) {
  return new URL(url).pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i)?.[1]?.toUpperCase() || null;
}

export function storeFromUrl(url) {
  const hostname = new URL(url).hostname.toLowerCase();
  if (hostname === 'amazon.com.br' || hostname.endsWith('.amazon.com.br')) return 'amazon';
  if (hostname === 'mercadolivre.com.br' || hostname.endsWith('.mercadolivre.com.br')) return 'mercadolivre';
  if (hostname === 'copagloja.com.br' || hostname.endsWith('.copagloja.com.br')) return 'copag';
  return null;
}

export function mercadoLivreCodeFromUrl(url) {
  const match = new URL(url).pathname.match(/\/(MLB-?\d+)/i);
  return match ? match[1].replace('-', '').toUpperCase() : null;
}

export function copagProductCodeFromUrl(url) {
  const match = new URL(url).pathname.match(/^\/(.+)\/p\/?$/i);
  return match ? match[1].toLowerCase() : null;
}
