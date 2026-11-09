const APPS = new Map([
  ['multiliblink', 'MultiLibLink'], ['aitalknotes', 'AI Talk Notes'],
  ['volumeac', 'Volume Area Controller'], ['medicaldict', '医療用語辞書'],
  ['wintimelock', 'WinTimeLock'], ['other', 'その他'],
]);
const KINDS = new Map([['question', '使い方の質問'], ['bug', '不具合の報告'], ['request', 'ご意見・ご要望'], ['other', 'その他']]);
const MAX_BYTES = 24000;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {status, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  }});
}
function ready(env) {
  return env.CONTACT_ENABLED === 'true' && Boolean(env.CONTACT_RECIPIENT && env.CONTACT_TURNSTILE_SECRET && env.CONTACT_TURNSTILE_SITEKEY);
}
export function onRequestGet({env}) {
  return json({ready: ready(env), sitekey: env.CONTACT_TURNSTILE_SITEKEY || ''});
}
export async function onRequestPost({request, env}) {
  const url = new URL(request.url);
  if (request.headers.get('Origin') !== url.origin) return json({error: 'このページから送信し直してください。'}, 403);
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) return json({error: '送信形式を確認してください。'}, 415);
  if (!ready(env)) return json({error: '現在、フォームを準備しています。時間をおいてご利用ください。'}, 503);
  let data;
  try {
    const body = await readLimited(request);
    data = JSON.parse(body);
  } catch {
    return json({error: '入力内容が長すぎるか、送信形式が正しくありません。'}, 400);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return json({error: '入力内容を確認してください。'}, 400);
  if (data.website) return json({ok: true});
  const text = (key) => typeof data[key] === 'string' ? data[key].trim() : '';
  const app = APPS.get(text('app')), kind = KINDS.get(text('kind'));
  const email = text('email'), name = text('name'), version = text('version');
  const subject = text('subject'), message = text('message'), token = text('token');
  if (!app || !kind || data.consent !== true || (email && !/^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/.test(email)) || email.length > 254 ||
      !subject || subject.length > 100 || /[\r\n]/.test(subject) || !message || message.length > 5000 || name.length > 60 || version.length > 60 ||
      /[\r\n]/.test(name + version) || !token || token.length > 2048) {
    return json({error: '必須項目と文字数を確認してください。'}, 400);
  }
  try {
    const verification = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({secret: env.CONTACT_TURNSTILE_SECRET, response: token}),
      signal: AbortSignal.timeout(15000),
    });
    if (!verification.ok) throw new Error('verification unavailable');
    const verified = await verification.json();
    if (!verified.success || verified.hostname !== url.hostname || verified.action !== 'contact') {
      return json({error: '送信確認の有効期限が切れた可能性があります。もう一度お試しください。'}, 400);
    }
    // The destination is fixed server-side. Never accept a recipient or mail options from the visitor.
    const response = await fetch('https://formsubmit.co/ajax/' + encodeURIComponent(env.CONTACT_RECIPIENT), {
      method: 'POST', headers: {'Content-Type': 'application/json', Accept: 'application/json', Origin: url.origin, Referer: url.origin + '/contact/', 'User-Agent': 'MasaToolsContact/1.0'},
      body: JSON.stringify({
        _subject: `[MasaTools] ${app}：${subject}`, _template: 'table', _captcha: 'false',
        _url: url.origin + '/contact/', email, 'お名前': name || '未記入',
        'アプリ': app, '種類': kind, 'バージョン': version || '未記入', '件名': subject, 'お問い合わせ内容': message,
      }), signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error('delivery unavailable');
    const result = await response.json();
    if (!(result.success === true || result.success === 'true') || /activat/i.test(String(result.message || ''))) throw new Error('delivery not accepted');
    return json({ok: true});
  } catch {
    // Do not log the visitor's email, message, delivery endpoint, or upstream response.
    return json({error: '送信完了を確認できませんでした。入力内容は残しています。時間をおいてお試しください。'}, 502);
  }
}
async function readLimited(request) {
  if (Number(request.headers.get('Content-Length')) > MAX_BYTES) throw new Error('size');
  if (!request.body) throw new Error('empty');
  const reader = request.body.getReader();
  const chunks = []; let size = 0;
  while (true) {
    const {value, done} = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {await reader.cancel(); throw new Error('size');}
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.byteLength;}
  return new TextDecoder().decode(bytes);
}
