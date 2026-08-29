/**
 * Hit Song Dashboard - shared song store on Cloudflare Pages Functions.
 *
 *   GET  /api/songs             current song list (public)
 *   GET  /api/songs?history=1   available revision numbers
 *   GET  /api/songs?revision=12 one past revision
 *   PUT  /api/songs             replace the song list (requires X-Edit-Token)
 *
 * Bindings expected on the Pages project:
 *   SONGS_KV    KV namespace binding that stores the data
 *   EDIT_TOKEN  secret used as the edit password
 */

const CURRENT_KEY = 'songs:current';
const REVISION_PREFIX = 'songs:rev:';
const HISTORY_LIMIT = 20;
const MAX_SONGS = 20000;
const SHRINK_GUARD_RATIO = 0.5;

export async function onRequestGet({ env, request }) {
    const store = env.SONGS_KV;
    if (!store) return kvMissing();

    const url = new URL(request.url);
    const editable = Boolean(env.EDIT_TOKEN);

    if (url.searchParams.get('history') === '1') {
        return json({ revisions: await listRevisions(store), editable });
    }

    const wanted = url.searchParams.get('revision');
    if (wanted !== null) {
        const revision = Number(wanted);
        if (!Number.isInteger(revision) || revision < 1) {
            return json({ error: 'invalid_revision' }, 400);
        }
        const snapshot = await store.get(revisionKey(revision), 'json');
        if (!snapshot) return json({ error: 'not_found', revision }, 404);
        return json({ initialized: true, editable, ...snapshot });
    }

    const current = await readCurrent(store);
    if (!current) {
        return json({ initialized: false, editable, revision: 0, count: 0, songs: null, updatedAt: null });
    }
    return json({ initialized: true, editable, ...current });
}

export async function onRequestPut({ request, env }) {
    const store = env.SONGS_KV;
    if (!store) return kvMissing();

    const expected = env.EDIT_TOKEN;
    if (!expected) {
        return json({
            error: 'token_not_configured',
            message: 'EDIT_TOKEN is not set on this Pages project.'
        }, 503);
    }

    if (!tokensMatch(request.headers.get('x-edit-token') || '', expected)) {
        return json({ error: 'unauthorized' }, 401);
    }

    let body;
    try {
        body = await request.json();
    } catch (_error) {
        return json({ error: 'invalid_json' }, 400);
    }

    const current = await readCurrent(store);
    const currentRevision = current ? current.revision : 0;
    const currentCount = current ? current.songs.length : 0;

    // The unlock dialog uses this to check the password without writing.
    if (body && body.verifyOnly === true) {
        return json({ ok: true, revision: currentRevision, count: currentCount });
    }

    const songs = sanitizeSongs(body && body.songs);
    if (!songs) return json({ error: 'invalid_songs', message: 'songs must be an array of objects.' }, 400);

    if (!body.force && Number(body.baseRevision) !== currentRevision) {
        return json({
            error: 'conflict',
            revision: currentRevision,
            count: currentCount,
            updatedAt: current ? current.updatedAt : null
        }, 409);
    }

    // Guards against wiping the shared list by accident.
    if (!body.allowShrink && currentCount > 0) {
        if (songs.length === 0) {
            return json({ error: 'empty_payload', currentCount, newCount: 0 }, 409);
        }
        if (songs.length < currentCount * SHRINK_GUARD_RATIO) {
            return json({ error: 'large_shrink', currentCount, newCount: songs.length }, 409);
        }
    }

    const next = {
        revision: currentRevision + 1,
        updatedAt: new Date().toISOString(),
        count: songs.length,
        songs
    };
    const payload = JSON.stringify(next);

    await store.put(CURRENT_KEY, payload);
    await store.put(revisionKey(next.revision), payload);
    await pruneHistory(store);

    return json({ ok: true, revision: next.revision, updatedAt: next.updatedAt, count: next.count });
}

function kvMissing() {
    return json({
        error: 'kv_not_bound',
        message: 'SONGS_KV binding is missing on this Pages project.'
    }, 503);
}

function json(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store'
        }
    });
}

function revisionKey(revision) {
    return `${REVISION_PREFIX}${String(revision).padStart(6, '0')}`;
}

async function readCurrent(store) {
    const stored = await store.get(CURRENT_KEY, 'json');
    if (!stored || !Array.isArray(stored.songs)) return null;
    return {
        revision: Number(stored.revision) || 0,
        updatedAt: stored.updatedAt || null,
        count: stored.songs.length,
        songs: stored.songs
    };
}

async function listRevisions(store) {
    const listed = await store.list({ prefix: REVISION_PREFIX });
    return listed.keys
        .map(key => Number(key.name.slice(REVISION_PREFIX.length)))
        .filter(Number.isInteger)
        .sort((a, b) => b - a);
}

async function pruneHistory(store) {
    try {
        const listed = await store.list({ prefix: REVISION_PREFIX });
        const names = listed.keys.map(key => key.name).sort();
        for (let i = 0; i < names.length - HISTORY_LIMIT; i++) {
            await store.delete(names[i]);
        }
    } catch (error) {
        console.warn('Revision history could not be pruned:', error);
    }
}

/**
 * Keeps only flat, serializable fields so a malformed client cannot store
 * nested payloads that later break the dashboard.
 */
function sanitizeSongs(input) {
    if (!Array.isArray(input) || input.length > MAX_SONGS) return null;

    const songs = [];
    for (const raw of input) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

        const song = {};
        for (const [key, value] of Object.entries(raw)) {
            if (value === null || value === undefined) {
                song[key] = '';
            } else if (typeof value === 'string' || typeof value === 'boolean') {
                song[key] = value;
            } else if (typeof value === 'number') {
                song[key] = Number.isFinite(value) ? value : '';
            }
        }
        songs.push(song);
    }
    return songs;
}

function tokensMatch(provided, expected) {
    if (typeof provided !== 'string' || typeof expected !== 'string') return false;
    if (provided.length !== expected.length) return false;

    let diff = 0;
    for (let i = 0; i < provided.length; i++) {
        diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
    }
    return diff === 0;
}
