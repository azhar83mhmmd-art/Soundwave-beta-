#!/usr/bin/env python3
"""
SoundWave Python Bridge v4.0
ytmusicapi → JSON for Express.js
Fast, cached, lightweight
"""
import sys
import json
import time
import traceback
from ytmusicapi import YTMusic

yt = YTMusic()

# ── In-memory TTL cache ────────────────────────────────
_cache = {}
CACHE_TTL = {
    'search':  300,   # 5 min
    'song':    600,   # 10 min
    'artist':  600,
    'trending':180,   # 3 min
    'mood':    600,
    'lyrics':  3600,  # 1 hr (static)
    'related': 600,
}

def cache_get(key):
    item = _cache.get(key)
    if not item:
        return None
    if time.time() - item['t'] > item['ttl']:
        del _cache[key]
        return None
    return item['d']

def cache_set(key, data, ttl=300):
    if len(_cache) > 300:
        now = time.time()
        expired = [k for k, v in _cache.items() if now - v['t'] > v['ttl']]
        for k in expired:
            del _cache[k]
    _cache[key] = {'d': data, 't': time.time(), 'ttl': ttl}

def thumb(thumbnails, prefer='mq'):
    """Pick best thumbnail — prefer mq/hq, never maxres"""
    if not thumbnails:
        return ''
    # Sort by width
    sorted_t = sorted(thumbnails, key=lambda x: x.get('width', 0))
    # Try to get around 320px (hqdefault territory)
    for t in sorted_t:
        w = t.get('width', 0)
        if 160 <= w <= 480:
            return t.get('url', '').split('?')[0]
    # fallback: smallest
    return sorted_t[0].get('url', '').split('?')[0]

def safe_str(v, default=''):
    if v is None:
        return default
    return str(v)

# ── SEARCH ────────────────────────────────────────────
def do_search(query, limit=20):
    key = f'search:{query.lower().strip()}:{limit}'
    cached = cache_get(key)
    if cached:
        return cached

    results = yt.search(query, filter='songs', limit=limit)
    out = []
    for r in results:
        try:
            vid = r.get('videoId') or ''
            if not vid:
                continue
            artists = r.get('artists') or []
            artist_name = ', '.join(a.get('name', '') for a in artists) if artists else 'Unknown'
            album = r.get('album') or {}
            duration_s = r.get('duration_seconds') or 0
            out.append({
                'id':       vid,
                'title':    safe_str(r.get('title')),
                'artist':   artist_name,
                'artistId': (artists[0].get('id') or '') if artists else '',
                'album':    safe_str(album.get('name') if isinstance(album, dict) else ''),
                'albumId':  safe_str(album.get('id') if isinstance(album, dict) else ''),
                'duration': safe_str(r.get('duration')),
                'durationS':int(duration_s),
                'thumbnail':thumb(r.get('thumbnails') or []),
                'year':     safe_str(r.get('year') or ''),
                'explicit': bool(r.get('isExplicit')),
            })
        except Exception:
            continue
    cache_set(key, out, CACHE_TTL['search'])
    return out

# ── SONG DETAIL ───────────────────────────────────────
def do_song(video_id):
    key = f'song:{video_id}'
    cached = cache_get(key)
    if cached:
        return cached

    r = yt.get_song(video_id)
    details = r.get('videoDetails') or {}
    micro = r.get('microformat', {}).get('microformatDataRenderer', {})
    
    out = {
        'id':          video_id,
        'title':       safe_str(details.get('title')),
        'artist':      safe_str(details.get('author')),
        'channelId':   safe_str(details.get('channelId')),
        'duration':    safe_str(details.get('lengthSeconds')),
        'thumbnail':   thumb(details.get('thumbnail', {}).get('thumbnails') or []),
        'views':       safe_str(details.get('viewCount')),
        'description': safe_str(details.get('shortDescription', ''))[:200],
        'category':    safe_str(micro.get('category')),
        'publishDate': safe_str(micro.get('publishDate')),
    }
    cache_set(key, out, CACHE_TTL['song'])
    return out

# ── ARTIST ────────────────────────────────────────────
def do_artist(artist_id):
    key = f'artist:{artist_id}'
    cached = cache_get(key)
    if cached:
        return cached

    r = yt.get_artist(artist_id)
    songs_browse = r.get('songs', {}).get('results') or []
    songs = []
    for s in songs_browse[:10]:
        vid = s.get('videoId') or ''
        if not vid:
            continue
        artists = s.get('artists') or []
        songs.append({
            'id':        vid,
            'title':     safe_str(s.get('title')),
            'artist':    ', '.join(a.get('name','') for a in artists),
            'thumbnail': thumb(s.get('thumbnails') or []),
            'album':     safe_str((s.get('album') or {}).get('name') if isinstance(s.get('album'), dict) else ''),
        })
    out = {
        'id':          artist_id,
        'name':        safe_str(r.get('name')),
        'description': safe_str(r.get('description', ''))[:300],
        'thumbnail':   thumb(r.get('thumbnails') or []),
        'subscribers': safe_str(r.get('subscribers')),
        'songs':       songs,
    }
    cache_set(key, out, CACHE_TTL['artist'])
    return out

# ── TRENDING / MOOD ───────────────────────────────────
MOOD_QUERIES = {
    'santai':  'lagu santai indonesia 2025',
    'fokus':   'study focus instrumental 2025',
    'workout': 'workout gym energetic 2025',
    'party':   'party hits viral 2025',
    'jazz':    'jazz cafe lounge smooth',
    'remix':   'DJ remix terbaik viral 2025',
    'pop':     'pop hits indonesia 2025',
    'anime':   'anime opening ost terbaik 2025',
    'rnb':     'r&b soul hits 2025',
    'klasik':  'klasik indonesia nostalgia',
}

def do_mood(mood):
    key = f'mood:{mood}'
    cached = cache_get(key)
    if cached:
        return cached

    q = MOOD_QUERIES.get(mood, mood + ' music 2025')
    results = yt.search(q, filter='songs', limit=20)
    out = []
    for r in results:
        vid = r.get('videoId') or ''
        if not vid:
            continue
        artists = r.get('artists') or []
        out.append({
            'id':        vid,
            'title':     safe_str(r.get('title')),
            'artist':    ', '.join(a.get('name','') for a in artists) if artists else 'Unknown',
            'thumbnail': thumb(r.get('thumbnails') or []),
            'duration':  safe_str(r.get('duration')),
            'durationS': int(r.get('duration_seconds') or 0),
            'album':     safe_str((r.get('album') or {}).get('name') if isinstance(r.get('album'), dict) else ''),
            'year':      safe_str(r.get('year') or ''),
        })
    cache_set(key, out, CACHE_TTL['mood'])
    return out

def do_trending():
    key = 'trending'
    cached = cache_get(key)
    if cached:
        return cached

    queries = [
        'trending musik indonesia 2025',
        'lagu viral tiktok indonesia 2025',
        'top hits indonesia 2025',
    ]
    import random
    q = random.choice(queries)
    results = yt.search(q, filter='songs', limit=20)
    out = []
    for r in results:
        vid = r.get('videoId') or ''
        if not vid:
            continue
        artists = r.get('artists') or []
        out.append({
            'id':        vid,
            'title':     safe_str(r.get('title')),
            'artist':    ', '.join(a.get('name','') for a in artists) if artists else 'Unknown',
            'thumbnail': thumb(r.get('thumbnails') or []),
            'duration':  safe_str(r.get('duration')),
            'durationS': int(r.get('duration_seconds') or 0),
        })
    cache_set(key, out, CACHE_TTL['trending'])
    return out

# ── RELATED ──────────────────────────────────────────
def do_related(video_id):
    key = f'related:{video_id}'
    cached = cache_get(key)
    if cached:
        return cached

    try:
        wl = yt.get_watch_playlist(videoId=video_id, limit=15)
        tracks = wl.get('tracks') or []
        out = []
        for r in tracks[1:]:  # skip first (current song)
            vid = r.get('videoId') or ''
            if not vid:
                continue
            artists = r.get('artists') or []
            out.append({
                'id':        vid,
                'title':     safe_str(r.get('title')),
                'artist':    ', '.join(a.get('name','') for a in artists) if artists else 'Unknown',
                'thumbnail': thumb(r.get('thumbnail') or []),
                'duration':  safe_str(r.get('duration')),
            })
        cache_set(key, out, CACHE_TTL['related'])
        return out
    except Exception:
        return []

# ── DISPATCH ──────────────────────────────────────────
def main():
    try:
        payload = json.loads(sys.argv[1])
        action = payload.get('action')

        if action == 'search':
            result = do_search(payload['query'], payload.get('limit', 20))
        elif action == 'song':
            result = do_song(payload['id'])
        elif action == 'artist':
            result = do_artist(payload['id'])
        elif action == 'mood':
            result = do_mood(payload['mood'])
        elif action == 'trending':
            result = do_trending()
        elif action == 'related':
            result = do_related(payload['id'])
        else:
            result = {'error': f'Unknown action: {action}'}

        print(json.dumps({'ok': True, 'data': result}))
    except Exception as e:
        print(json.dumps({'ok': False, 'error': str(e), 'trace': traceback.format_exc()}))

if __name__ == '__main__':
    main()
