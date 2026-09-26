/**
 * 非公開アプリ一覧のラベルと並び順 (/admin/layout)
 *
 * R2 の .admin/layout.json に 1 つの JSON として保存する。
 * functions/admin/files/[[path]].js は .admin/ 配下を一覧に出さず、書き込みも拒否する。
 *
 *   GET /admin/layout        → { layout, etag }（未作成なら空のレイアウトと etag: null）
 *   PUT /admin/layout        本文 = { layout, etag }
 *                            etag が保存済みのものと違えば 409（別の画面で先に変更された）
 *
 * layout = {
 *   labels:    [{ id, name, files: [key, ...] }, ...]   ラベルの並び順どおり
 *   unlabeled: [key, ...]                               未分類の並び順
 * }
 * 実在しないキーが残っていても害はない（画面側で無視し、次の保存で消える）。
 */

const LAYOUT_KEY = '.admin/layout.json';
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_LABELS = 200;
const MAX_NAME_LENGTH = 50;

export async function onRequest(context) {
    const { request, env } = context;
    const bucket = env.ADMIN_FILES;

    if (!bucket) {
        return json({ error: 'r2_not_bound', message: 'R2 バケット ADMIN_FILES が未設定です。' }, 503);
    }

    if (request.method === 'GET') return readLayout(bucket);

    if (request.method !== 'PUT') {
        return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET, PUT' });
    }
    if (request.headers.get('X-MT-Admin') !== '1') {
        return json({ error: 'forbidden', message: '管理者ページ以外からの操作は受け付けません。' }, 403);
    }
    return writeLayout(bucket, request);
}

async function readLayout(bucket) {
    const object = await bucket.get(LAYOUT_KEY);
    if (!object) return json({ layout: emptyLayout(), etag: null });

    let layout;
    try {
        layout = normalize(await object.json());
    } catch {
        layout = emptyLayout();
    }
    return json({ layout: layout || emptyLayout(), etag: object.etag });
}

async function writeLayout(bucket, request) {
    const length = Number(request.headers.get('Content-Length'));
    if (Number.isFinite(length) && length > MAX_BODY_BYTES) {
        return json({ error: 'too_large', message: 'レイアウトが大きすぎます。' }, 413);
    }

    let body;
    try {
        body = await request.json();
    } catch {
        return json({ error: 'bad_request', message: '本文が JSON ではありません。' }, 400);
    }

    const layout = normalize(body && body.layout);
    if (!layout) return json({ error: 'bad_request', message: 'レイアウトの形式が不正です。' }, 400);

    const etag = typeof body.etag === 'string' && body.etag ? body.etag : null;
    const conflict = { error: 'conflict', message: '別の画面で先に変更されています。再読み込みしてください。' };

    let saved;
    if (etag) {
        saved = await bucket.put(LAYOUT_KEY, JSON.stringify(layout), {
            onlyIf: { etagMatches: etag },
            httpMetadata: { contentType: 'application/json; charset=utf-8' }
        });
    } else {
        // 初回保存。すでに誰かが作っていたら上書きしない
        if (await bucket.head(LAYOUT_KEY)) return json(conflict, 409);
        saved = await bucket.put(LAYOUT_KEY, JSON.stringify(layout), {
            httpMetadata: { contentType: 'application/json; charset=utf-8' }
        });
    }

    if (!saved) return json(conflict, 409);
    return json({ layout, etag: saved.etag });
}

/* ---------- validation ---------- */

function emptyLayout() {
    return { labels: [], unlabeled: [] };
}

// 形が正しければ整えたレイアウトを、不正なら null を返す。
// 同じキーが複数の場所にあれば、先に出てきた方だけを残す。
function normalize(raw) {
    if (!raw || typeof raw !== 'object') return null;
    if (!Array.isArray(raw.labels) || !Array.isArray(raw.unlabeled)) return null;
    if (raw.labels.length > MAX_LABELS) return null;

    const seenKeys = new Set();
    const seenIds = new Set();
    const keys = (list) => {
        if (!Array.isArray(list)) return null;
        const out = [];
        for (const key of list) {
            if (typeof key !== 'string' || !key || key.length > 1024) return null;
            if (seenKeys.has(key)) continue;
            seenKeys.add(key);
            out.push(key);
        }
        return out;
    };

    const labels = [];
    for (const label of raw.labels) {
        if (!label || typeof label !== 'object') return null;
        const id = typeof label.id === 'string' ? label.id : '';
        const name = typeof label.name === 'string' ? label.name.trim() : '';
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || seenIds.has(id)) return null;
        if (!name || name.length > MAX_NAME_LENGTH) return null;
        const files = keys(label.files);
        if (!files) return null;
        seenIds.add(id);
        labels.push({ id, name, files });
    }

    const unlabeled = keys(raw.unlabeled);
    if (!unlabeled) return null;

    return { labels, unlabeled };
}

function json(body, status = 200, extraHeaders) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8', ...(extraHeaders || {}) }
    });
}
