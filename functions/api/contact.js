const APPS = new Map([
  ['multiliblink', 'MultiLibLink（図書館 連携ツール）'], ['aitalknotes', 'AI Talk Notes'],
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
  return env.CONTACT_ENABLED === 'true' && configured(env);
}
function configured(env) {
  return Boolean(env.CONTACT_RECIPIENT && env.RESEND_API_KEY && env.CONTACT_EMAIL_FROM && env.CONTACT_TURNSTILE_SECRET && env.CONTACT_TURNSTILE_SITEKEY);
}
function testReady(env) {
  return env.CONTACT_TEST_ENABLED === 'true' && configured(env);
}
export function onRequestGet({env}) {
  return json({ready: ready(env), testReady: testReady(env), sitekey: env.CONTACT_TURNSTILE_SITEKEY || ''});
}
export async function onRequestPost({request, env}) {
  const url = new URL(request.url);
  if (request.headers.get('Origin') !== url.origin) return json({error: 'このページから送信し直してください。'}, 403);
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) return json({error: '送信形式を確認してください。'}, 415);
  if (!ready(env) && !testReady(env)) return json({error: '現在、フォームを準備しています。時間をおいてご利用ください。'}, 503);
  let data;
  try {
    const body = await readLimited(request);
    data = JSON.parse(body);
  } catch {
    return json({error: '入力内容が長すぎるか、送信形式が正しくありません。'}, 400);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return json({error: '入力内容を確認してください。'}, 400);
  const isTest = data.mode === 'delivery-test';
  if (isTest ? !testReady(env) : !ready(env)) return json({error: '現在、フォームを準備しています。時間をおいてご利用ください。'}, 503);
  if (data.website) return json({ok: true});
  const text = (key) => typeof data[key] === 'string' ? data[key].trim() : '';
  const app = APPS.get(text('app')), kind = KINDS.get(text('kind'));
  const email = text('email'), name = text('name'), version = text('version');
  const subject = text('subject'), message = text('message'), token = text('token');
  if (!token || token.length > 2048 || (!isTest && (!app || !kind || data.consent !== true || (email && !/^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/.test(email)) || email.length > 254 ||
      !subject || subject.length > 100 || /[\r\n]/.test(subject) || !message || message.length > 5000 || name.length > 60 || version.length > 60 ||
      /[\r\n]/.test(name + version)))) {
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
    // A preparation test sends only this fixed text. It cannot submit an inquiry or change recipients.
    const mail = isTest ? {
      subject: '[MasaTools] お問い合わせフォームの受信テスト',
      text: 'MasaToolsのお問い合わせフォームからの受信テストです。\nこのメールが届けば、設定済みの問い合わせ先で受信できています。\n利用者が入力した情報・個人情報・読書履歴は含んでいません。',
    } : {
      subject: `[MasaTools] ${app}：${subject}`,
      text: `アプリ：${app}\n種類：${kind}\nお名前：${name || '未記入'}\n返信先：${email || '未記入'}\nバージョン：${version || '未記入'}\n件名：${subject}\n\n${message}`,
      ...(email ? {reply_to: email} : {}),
    };
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Idempotency-Key': 'contact-' + await tokenKey(token)},
      body: JSON.stringify({from: env.CONTACT_EMAIL_FROM, to: [env.CONTACT_RECIPIENT], ...mail}), signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      if (isTest) return json({error: [401, 403].includes(response.status)
        ? 'テストメールを送信できませんでした。メール配信サービスの送信設定を確認する必要があります。'
        : 'テストメールを送信できませんでした。時間をおいてお試しください。'}, 502);
      throw new Error('delivery unavailable');
    }
    const result = await response.json();
    if (typeof result.id !== 'string' || !result.id) throw new Error('delivery not accepted');
    return json({ok: true, ...(isTest ? {test: true} : {})});
  } catch {
    // Do not log the visitor's email, message, delivery endpoint, or upstream response.
    return json({error: '送信完了を確認できませんでした。入力内容は残しています。時間をおいてお試しください。'}, 502);
  }
}
async function tokenKey(token) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (v) => v.toString(16).padStart(2, '0')).join('');
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
