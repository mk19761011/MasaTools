/**
 * 非公開アプリの配信 (/admin/files/*)
 *
 * ファイル本体は Git リポジトリではなく Cloudflare R2 に置く。
 * このルートは functions/admin/_middleware.js の内側なので、
 * ログイン済みのリクエストしかここまで到達しない。
 *
 *   GET    /admin/files/                          R2 にあるファイルの一覧（JSON）
 *   GET    /admin/files/<key>                     ファイル本体（Range リクエスト対応）
 *   DELETE /admin/files/<key>                     ファイルを削除
 *
 * 管理者ページからのアップロード（R2 マルチパートアップロード）:
 *   POST   /admin/files/<key>?action=mpu-create                           → { uploadId }
 *   PUT    /admin/files/<key>?action=mpu-part&uploadId=..&partNumber=N    本文 = 分割片
 *   POST   /admin/files/<key>?action=mpu-complete&uploadId=..             本文 = { parts }
 *   DELETE /admin/files/<key>?action=mpu-abort&uploadId=..
 *
 *   Workers / Pages Functions は 1 リクエストの本文が 100MB までなので、
 *   ブラウザ側でファイルを分割して 1 片ずつ送り、R2 側で 1 つのファイルに結合する。
 *   分割片は最後の 1 つを除いて 5MiB 以上が必要（R2 の仕様）。
 *
 * 書き込み系のリクエストには X-MT-Admin: 1 ヘッダーを必須にしている。
 * 独自ヘッダー付きのクロスオリジン fetch はプリフライトで弾かれるので、
 * SameSite=Lax の Cookie と合わせて CSRF を二重に防ぐ。
 *
 * Bindings expected on the Pages project:
 *   ADMIN_FILES  R2 bucket binding
 */

const MAX_LIST = 1000;
const MAX_PART_BYTES = 95 * 1024 * 1024;   // リクエスト本文の上限 100MB より少し下
const MAX_PARTS = 10000;                   // R2 マルチパートの上限
const MAX_KEY_BYTES = 1024;                // R2 のキー長上限
const SYSTEM_PREFIX = '.admin/';           // 管理用データ（functions/admin/layout.js のラベル設定など）。一覧に出さず、ここからは触らせない

const CONTENT_TYPES = {
    apk: 'application/vnd.android.package-archive',
    exe: 'application/octet-stream',
    msi: 'application/octet-stream',
    aab: 'application/octet-stream',
    zip: 'application/zip',
    '7z': 'application/x-7z-compressed',
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

    const key = decodeKey(params.path);
    const method = request.method;

    if (method === 'GET' || method === 'HEAD') {
        if (!key) return listFiles(bucket);
        if (key.startsWith(SYSTEM_PREFIX)) return json({ error: 'not_found', key }, 404);
        return sendFile(bucket, key, request);
    }

    if (method !== 'POST' && method !== 'PUT' && method !== 'DELETE') {
        return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET, HEAD, POST, PUT, DELETE' });
    }

    if (request.headers.get('X-MT-Admin') !== '1') {
        return json({ error: 'forbidden', message: '管理者ページ以外からの操作は受け付けません。' }, 403);
    }

    const problem = checkKey(key);
    if (problem) return json({ error: 'invalid_key', message: problem }, 400);

    const url = new URL(request.url);
    const action = url.searchParams.get('action') || '';

    try {
        if (method === 'DELETE' && action === '') return await deleteFile(bucket, key);
        if (method === 'POST' && action === 'mpu-create') return await createUpload(bucket, key);
        if (method === 'PUT' && action === 'mpu-part') return await uploadPart(bucket, key, url, request);
        if (method === 'POST' && action === 'mpu-complete') return await completeUpload(bucket, key, url, request);
        if (method === 'DELETE' && action === 'mpu-abort') return await abortUpload(bucket, key, url);
    } catch (err) {
        return json({ error: 'r2_error', message: String((err && err.message) || err) }, 500);
    }

    return json({ error: 'bad_request', message: '不明な操作です。' }, 400);
}

/* ---------- listing ---------- */

async function listFiles(bucket) {
    const files = [];
    let cursor;

    do {
        const page = await bucket.list({ limit: MAX_LIST, cursor });
        for (const object of page.objects) {
            if (object.key.startsWith(SYSTEM_PREFIX)) continue;
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

/* ---------- delete ---------- */

async function deleteFile(bucket, key) {
    const existing = await bucket.head(key);
    if (!existing) return json({ error: 'not_found', key }, 404);
    await bucket.delete(key);
    return json({ deleted: key });
}

/* ---------- upload (multipart) ---------- */

async function createUpload(bucket, key) {
    const upload = await bucket.createMultipartUpload(key, {
        httpMetadata: { contentType: contentType(key) }
    });
    return json({ key: upload.key, uploadId: upload.uploadId });
}

async function uploadPart(bucket, key, url, request) {
    const uploadId = url.searchParams.get('uploadId');
    const partNumber = Number(url.searchParams.get('partNumber'));
    if (!uploadId) return json({ error: 'bad_request', message: 'uploadId がありません。' }, 400);
    if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > MAX_PARTS) {
        return json({ error: 'bad_request', message: 'partNumber が不正です。' }, 400);
    }

    const length = Number(request.headers.get('Content-Length'));
    if (!request.body || !Number.isFinite(length) || length <= 0) {
        return json({ error: 'bad_request', message: '分割片が空です。' }, 400);
    }
    if (length > MAX_PART_BYTES) {
        return json({ error: 'too_large', message: '1 回に送れるのは ' + (MAX_PART_BYTES / 1048576) + 'MiB までです。' }, 413);
    }

    const upload = bucket.resumeMultipartUpload(key, uploadId);
    const part = await upload.uploadPart(partNumber, request.body);
    return json({ partNumber: part.partNumber, etag: part.etag });
}

async function completeUpload(bucket, key, url, request) {
    const uploadId = url.searchParams.get('uploadId');
    if (!uploadId) return json({ error: 'bad_request', message: 'uploadId がありません。' }, 400);

    let body;
    try {
        body = await request.json();
    } catch {
        return json({ error: 'bad_request', message: '本文が JSON ではありません。' }, 400);
    }

    const parts = Array.isArray(body && body.parts) ? body.parts : [];
    const valid = parts.length > 0 && parts.length <= MAX_PARTS && parts.every((p) =>
        p && Number.isInteger(p.partNumber) && typeof p.etag === 'string' && p.etag);
    if (!valid) return json({ error: 'bad_request', message: 'parts が不正です。' }, 400);

    const upload = bucket.resumeMultipartUpload(key, uploadId);
    const object = await upload.complete(parts.map((p) => ({ partNumber: p.partNumber, etag: p.etag })));
    return json({ key: object.key, size: object.size, uploaded: object.uploaded });
}

async function abortUpload(bucket, key, url) {
    const uploadId = url.searchParams.get('uploadId');
    if (!uploadId) return json({ error: 'bad_request', message: 'uploadId がありません。' }, 400);
    await bucket.resumeMultipartUpload(key, uploadId).abort();
    return json({ aborted: true });
}

/* ---------- helpers ---------- */

// 書き込み・削除に使うキーの検査。問題があれば理由を返す。
function checkKey(key) {
    if (!key) return 'ファイル名がありません。';
    if (key.startsWith(SYSTEM_PREFIX)) return 'この名前は管理用に予約されています。';
    if (new TextEncoder().encode(key).length > MAX_KEY_BYTES) return 'ファイル名が長すぎます。';
    if (/[\u0000-\u001f\u007f\\]/.test(key)) return 'ファイル名に使えない文字が含まれています。';
    return null;
}


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
