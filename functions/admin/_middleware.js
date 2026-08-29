/**
 * Password gate for /admin/*  (Cloudflare Pages Functions middleware)
 *
 * /admin/ 配下へのリクエストは必ずここを通る。
 * 正しいパスワードを入力するまで、静的ファイル（HTML・APK・画像など）は一切返さない。
 *
 * Bindings expected on the Pages project:
 *   ADMIN_PASSWORD  シークレット（Cloudflare ダッシュボードの環境変数で設定する）
 *
 * ログイン成功時は HMAC 署名付き Cookie を発行する。
 * 署名鍵はパスワードそのものなので、パスワードを変更すれば既存セッションは全て無効になる。
 */

const COOKIE_NAME = 'mt_admin';
const SESSION_HOURS = 12;
const SIGN_CONTEXT = 'mt-admin-session';

export async function onRequest(context) {
    const { request, env, next } = context;
    const url = new URL(request.url);
    const password = env.ADMIN_PASSWORD;

    if (!password) {
        return htmlResponse(setupPage(), 503);
    }

    if (url.pathname === '/admin/logout') {
        const res = redirectTo('/admin/');
        res.headers.append('Set-Cookie', expiredCookie());
        return res;
    }

    if (url.pathname === '/admin/login' && request.method === 'POST') {
        const form = await request.formData();
        const supplied = String(form.get('password') || '');
        const target = safeTarget(form.get('next'));

        if (await equals(supplied, password)) {
            const res = redirectTo(target);
            res.headers.append('Set-Cookie', await sessionCookie(password));
            return res;
        }

        // 総当たりを少しだけ遅くする
        await new Promise((resolve) => setTimeout(resolve, 700));
        return htmlResponse(loginPage(target, true), 401);
    }

    if (!(await hasSession(request, password))) {
        return htmlResponse(loginPage(safeTarget(url.pathname + url.search), false), 401);
    }

    const res = await next();
    const guarded = new Response(res.body, res);
    guarded.headers.set('X-Robots-Tag', 'noindex, nofollow');
    guarded.headers.set('Cache-Control', 'private, no-store');
    return guarded;
}

/* ---------- session ---------- */

async function sessionCookie(password) {
    const expiresAt = Date.now() + SESSION_HOURS * 3600 * 1000;
    const signature = await sign(password, SIGN_CONTEXT + ':' + expiresAt);
    return COOKIE_NAME + '=' + expiresAt + '.' + signature +
        '; Path=/admin; Max-Age=' + SESSION_HOURS * 3600 +
        '; HttpOnly; Secure; SameSite=Lax';
}

function expiredCookie() {
    return COOKIE_NAME + '=; Path=/admin; Max-Age=0; HttpOnly; Secure; SameSite=Lax';
}

async function hasSession(request, password) {
    const raw = readCookie(request, COOKIE_NAME);
    if (!raw) return false;

    const dot = raw.indexOf('.');
    if (dot < 1) return false;

    const expiresAt = Number(raw.slice(0, dot));
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;

    const expected = await sign(password, SIGN_CONTEXT + ':' + expiresAt);
    return equals(raw.slice(dot + 1), expected);
}

function readCookie(request, name) {
    const header = request.headers.get('Cookie');
    if (!header) return null;
    for (const part of header.split(';')) {
        const eq = part.indexOf('=');
        if (eq < 0) continue;
        if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
    }
    return null;
}

/* ---------- crypto ---------- */

async function sign(secret, data) {
    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    const buf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// 長さの違いや先頭一致から情報が漏れないよう、使い捨て鍵でハッシュしてから比較する
async function equals(a, b) {
    const nonce = crypto.getRandomValues(new Uint8Array(32));
    const key = await crypto.subtle.importKey('raw', nonce, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const encoder = new TextEncoder();
    const [ha, hb] = await Promise.all([
        crypto.subtle.sign('HMAC', key, encoder.encode(a)),
        crypto.subtle.sign('HMAC', key, encoder.encode(b))
    ]);
    const va = new Uint8Array(ha);
    const vb = new Uint8Array(hb);
    let diff = 0;
    for (let i = 0; i < va.length; i += 1) diff |= va[i] ^ vb[i];
    return diff === 0;
}

/* ---------- helpers ---------- */

// オープンリダイレクト防止：/admin/ 配下のパスしか受け付けない
function safeTarget(value) {
    const path = String(value || '');
    if (!path.startsWith('/admin/') || path.startsWith('/admin//')) return '/admin/';
    if (path.startsWith('/admin/login') || path.startsWith('/admin/logout')) return '/admin/';
    return path;
}

function redirectTo(location) {
    return new Response(null, {
        status: 303,
        headers: { Location: location, 'Cache-Control': 'no-store' }
    });
}

function htmlResponse(body, status) {
    return new Response(body, {
        status,
        headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Robots-Tag': 'noindex, nofollow',
            'Referrer-Policy': 'no-referrer'
        }
    });
}

function escapeHtml(value) {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return String(value).replace(/[&<>"']/g, (c) => map[c]);
}

/* ---------- pages ---------- */

function shell(title, inner) {
    const css = [
        ':root{--bg:#f3f7fb;--bg-soft:#edf4f6;--text:#1f2937;--muted:#5f6f82;--line:rgba(30,41,59,.12);--accent:#2563eb;--accent-dark:#1d4ed8;--shadow:0 18px 50px rgba(15,23,42,.10)}',
        '*{box-sizing:border-box}',
        'body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Hiragino Sans","Hiragino Kaku Gothic ProN","Yu Gothic",Meiryo,sans-serif;color:var(--text);line-height:1.75;font-size:17px;background:radial-gradient(circle at 12% 8%,rgba(37,99,235,.13),transparent 30%),radial-gradient(circle at 88% 0%,rgba(20,184,166,.16),transparent 28%),linear-gradient(135deg,var(--bg),var(--bg-soft))}',
        '.box{width:min(100%,420px);background:rgba(255,255,255,.86);border:1px solid var(--line);border-radius:22px;padding:32px 30px;box-shadow:var(--shadow)}',
        '.mark{width:38px;height:38px;border-radius:12px;background:linear-gradient(135deg,var(--accent),#14b8a6);box-shadow:0 10px 24px rgba(37,99,235,.24);margin-bottom:16px}',
        'h1{margin:0 0 6px;font-size:22px;letter-spacing:-.02em}',
        'p{margin:0 0 20px;color:var(--muted);font-size:15px}',
        'label{display:block;font-size:14px;font-weight:700;margin-bottom:7px}',
        'input[type=password]{width:100%;min-height:48px;padding:0 14px;font-size:16px;border-radius:12px;border:1px solid var(--line);background:#fff;color:var(--text)}',
        'input[type=password]:focus{outline:2px solid rgba(37,99,235,.45);outline-offset:1px}',
        'button{width:100%;min-height:48px;margin-top:16px;border:0;border-radius:12px;font-size:16px;font-weight:700;color:#fff;cursor:pointer;background:linear-gradient(135deg,var(--accent),var(--accent-dark))}',
        '.error{margin:0 0 16px;padding:11px 14px;border-radius:12px;font-size:14px;color:#991b1b;background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.28)}',
        '.back{display:block;margin-top:20px;font-size:14px;color:var(--muted);text-align:center}',
        'code{font-size:13px;background:rgba(30,41,59,.07);padding:2px 6px;border-radius:6px}'
    ].join('');

    return '<!DOCTYPE html>\n<html lang="ja">\n<head>\n' +
        '<meta charset="UTF-8">\n' +
        '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
        '<meta name="robots" content="noindex, nofollow">\n' +
        '<title>' + title + ' | MasaTools</title>\n' +
        '<style>' + css + '</style>\n' +
        '</head>\n<body>\n<main class="box">\n' + inner + '\n</main>\n</body>\n</html>\n';
}

function loginPage(target, failed) {
    return shell('管理者ページ',
        '<div class="mark" aria-hidden="true"></div>' +
        '<h1>管理者ページ</h1>' +
        '<p>このページは非公開です。パスワードを入力してください。</p>' +
        (failed ? '<p class="error">パスワードが違います。</p>' : '') +
        '<form method="POST" action="/admin/login">' +
        '<input type="hidden" name="next" value="' + escapeHtml(target) + '">' +
        '<label for="password">パスワード</label>' +
        '<input id="password" name="password" type="password" autocomplete="current-password" autofocus required>' +
        '<button type="submit">ログイン</button>' +
        '</form>' +
        '<a class="back" href="/">MasaTools トップへ戻る</a>'
    );
}

function setupPage() {
    return shell('設定が未完了です',
        '<div class="mark" aria-hidden="true"></div>' +
        '<h1>設定が未完了です</h1>' +
        '<p>Cloudflare Pages のプロジェクト設定で、環境変数 <code>ADMIN_PASSWORD</code> をシークレットとして登録してください。登録するまで、このページは開けません。</p>' +
        '<a class="back" href="/">MasaTools トップへ戻る</a>'
    );
}
