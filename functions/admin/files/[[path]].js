/**
 * 非公開アプリの配信 (/admin/files/*)
 *
 * ファイル本体は Git リポジトリではなく Cloudflare R2 に置く。
 * このルートは functions/admin/_middleware.js の内側なので、
 * ログイン済みのリクエストしかここまで到達しない。
 *
 *   GET /admin/files/            R2 にあるファイルの一覧（JSON）
 *   GET /admin/files/<key>       ファイル本体（Range リクエスト対応）
 *
 * Bindings expected on the Pages project:
 *   ADMIN_FILES  R2 bucket binding
 */

const MAX_LIST = 1000;

const CONTENT_TYPES = {
    apk: 'application/vnd.android.package-archive',
    exe: 'application/octet-stream',
    msi: 'application/octet-stream',
    zip: 'application/zip',
    pdf: 'application/pdf',
    txt: 'text/plain; charset=utf-8',
    json: 'application/json; charset=utf-8',
    png: 'image/png',
    jpg: 'image/jpeg',
    svg: 'image/svg+xml'
};

export async function onRequest(context) {
    const { request, env, params } = context;
    const bucket = env.ADMIN_FILES;

    if (!bucket) {
        return json({ error: 'r2_not_bound', message: 'R2 バケット ADMIN_FILES が未設定です。' }, 503);
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
        return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET, HEAD' });
    }

    const key = decodeKey(params.path);
    if (!key) return listFiles(bucket);
    return sendFile(bucket, key, request);
}

/* ---------- listing ---------- */

async function listFiles(bucket) {
    const files = [];
    let cursor;

    do {
        const page = await bucket.list({ limit: MAX_LIST, cursor });
        for (const object of page.objects) {
            files.push({
                key: object.key,
                name: object.key.split('/').pop(),
                size: object.size,
                uploaded: object.uploaded,
                url: '/admin/files/' + object.key.split('/').map(encodeURIComponent).join('/')
            });
        }
        cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);

    files.sort((a, b) => a.key.localeCompare(b.key, 'ja'));
    return json({ files });
}

/* ---------- download ---------- */

async function sendFile(bucket, key, request) {
    const range = parseRange(request.headers.get('Range'));
    const object = await bucket.get(key, range ? { range } : undefined);

    if (!object) return json({ error: 'not_found', key }, 404);

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('Content-Type', contentType(key, headers.get('Content-Type')));
    headers.set('Content-Disposition', disposition(key));
    headers.set('Accept-Ranges', 'bytes');
    headers.set('ETag', object.httpEtag);

    if (object.range && object.size !== undefined) {
        const start = object.range.offset || 0;
        const length = object.range.length ?? object.size - start;
        const end = start + length - 1;
        headers.set('Content-Range', 'bytes ' + start + '-' + end + '/' + object.size);
        headers.set('Content-Length', String(length));
        return new Response(request.method === 'HEAD' ? null : object.body, { status: 206, headers });
    }

    headers.set('Content-Length', String(object.size));
    return new Response(request.method === 'HEAD' ? null : object.body, { status: 200, headers });
}

/* ---------- helpers ---------- */

// params.path は catch-all の結果。文字列にも配列にもなりうる。
function decodeKey(path) {
    const parts = Array.isArray(path) ? path : (path ? [path] : []);
    return parts
        .map((part) => {
            try {
                return decodeURIComponent(part);
            } catch {
                return part;
            }
        })
        .filter((part) => part && part !== '.' && part !== '..')
        .join('/');
}

function parseRange(header) {
    if (!header) return null;
    const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
    if (!match) return null;

    const [, startRaw, endRaw] = match;
    if (startRaw === '' && endRaw === '') return null;
    if (startRaw === '') return { suffix: Number(endRaw) };

    const offset = Number(startRaw);
    if (endRaw === '') return { offset };
    return { offset, length: Number(endRaw) - offset + 1 };
}

function contentType(key, existing) {
    if (existing && existing !== 'application/octet-stream') return existing;
    const ext = key.split('.').pop().toLowerCase();
    return CONTENT_TYPES[ext] || 'application/octet-stream';
}

function disposition(key) {
    const name = key.split('/').pop();
    const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    return 'attachment; filename="' + ascii + '"; filename*=UTF-8\'\'' + encodeURIComponent(name);
}

function json(body, status, extraHeaders) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8', ...(extraHeaders || {}) }
    });
}
