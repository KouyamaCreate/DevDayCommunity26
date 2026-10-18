import https from 'node:https';
import { lookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
import { AppError } from './errors.mjs';

export async function fetchJSON(url, options = {}) {
  let response;
  try { response = await fetch(url, { ...options, signal: AbortSignal.timeout(20000) }); }
  catch { throw new AppError('UPSTREAM_UNAVAILABLE', '外部サービスに接続できません。ネットワーク接続を確認してください。'); }
  if (!response.ok) throw new AppError('UPSTREAM_HTTP_ERROR', `外部サービスが応答できませんでした（HTTP ${response.status}）。`, { retryable: response.status >= 429 });
  try { return await response.json(); }
  catch { throw new AppError('UPSTREAM_INVALID_DATA', '外部サービスのデータ形式を読み取れません。'); }
}

const PROPERTY_DOMAINS = ['suumo.jp', 'homes.co.jp', 'athome.co.jp', 'zillow.com', 'redfin.com', 'realtor.com', 'apartments.com'];
export function allowedPropertyURL(value) {
  let url;
  try { url = new URL(value); } catch { throw new AppError('INVALID_URL', '物件URLを確認してください。'); }
  const allowed = PROPERTY_DOMAINS.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`));
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !allowed) {
    throw new AppError('URL_NOT_SUPPORTED', 'この物件サイトの自動読取には対応していません。公開されている住所を入力してください。');
  }
  return url;
}
export function isPublicIP(value) {
  try { return ipaddr.process(value).range() === 'unicast'; } catch { return false; }
}
// Resolve once and pin the address to the HTTPS connection. Revalidate every redirect.
export async function fetchPropertyHTML(value, { redirects = 0, resolver = lookup } = {}) {
  const url = allowedPropertyURL(value);
  if (redirects > 3) throw new AppError('URL_UNREADABLE', '物件URLを読み取れません。住所を入力してください。');
  let addresses;
  try { addresses = await resolver(url.hostname, { all: true }); }
  catch { throw new AppError('URL_UNREADABLE', '物件サイトに接続できません。住所を入力してください。'); }
  if (!addresses.length || addresses.some(a => !isPublicIP(a.address))) throw new AppError('URL_NOT_SUPPORTED', 'このURLへは接続できません。住所を入力してください。');
  const address = addresses[0];
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: { 'User-Agent': 'Sokomade/0.1 (user-requested public listing address lookup)', 'Accept': 'text/html' },
      lookup: (_hostname, options, callback) => options.all ? callback(null, [address]) : callback(null, address.address, address.family),
      timeout: 10000,
    }, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        resolve(fetchPropertyHTML(new URL(response.headers.location, url).href, { redirects: redirects + 1, resolver }));
        return;
      }
      if (response.statusCode !== 200 || !response.headers['content-type']?.includes('text/html')) {
        response.resume(); reject(new AppError('URL_UNREADABLE', '物件ページを取得できません。公開住所を入力してください。')); return;
      }
      let size = 0;
      const chunks = [];
      response.on('data', chunk => {
        size += chunk.length;
        if (size > 2_000_000) { response.destroy(); reject(new AppError('URL_TOO_LARGE', '物件ページが大きすぎるため、住所を入力してください。')); }
        else chunks.push(chunk);
      });
      response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      response.on('error', () => reject(new AppError('URL_UNREADABLE', '物件ページを読み取れません。住所を入力してください。')));
    });
    request.on('timeout', () => request.destroy());
    request.on('error', () => reject(new AppError('URL_UNREADABLE', '物件サイトに接続できません。住所を入力してください。')));
  });
}
export function extractListingAddress(html) {
  const candidates = [...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const addresses = new Set();
  const residenceTypes = new Set(['Apartment', 'House', 'Residence', 'SingleFamilyResidence', 'Accommodation', 'ApartmentComplex']);
  function find(value, depth = 0) {
    if (!value || typeof value !== 'object' || depth > 30) return;
    const types = [value['@type']].flat().filter(Boolean).map(t => String(t).split('/').at(-1));
    // Organization/agent addresses are not the listed property's address.
    if (types.some(type => residenceTypes.has(type)) && value.address) {
      const a = value.address;
      let address;
      if (typeof a === 'string') address = a;
      else if (typeof a === 'object' && a.streetAddress) address = [a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode, a.addressCountry].filter(x => typeof x === 'string').join(', ');
      if (address?.trim() && address.length < 400) addresses.add(address.trim());
    }
    for (const nested of Object.values(value)) if (nested && typeof nested === 'object') find(nested, depth + 1);
  }
  for (const match of candidates) { try { find(JSON.parse(match[1])); } catch {} }
  if (addresses.size === 1) return [...addresses][0];
  throw new AppError('ADDRESS_NOT_EXTRACTED', '公開ページから物件住所を確実に抽出できませんでした。住所を入力してください。');
}
