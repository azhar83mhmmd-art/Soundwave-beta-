/**
 * SoundWave V2 — Node.js Only Backend
 * YouTube IFrame + LRCLIB + Smart Lyric Search Engine
 * Zero Python. Pure async Node.js.
 */
import express from 'express'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { createServer } from 'http'

const __dirname = dirname(fileURLToPath(import.meta.url))
const app  = express()
const PORT = process.env.PORT || 6999

/* ── Anti-crash ──────────────────────────────────── */
process.on('uncaughtException',  e => console.error('[UNCAUGHT]', e.message))
process.on('unhandledRejection', e => console.error('[UNHANDLED]', e))

/* ── Node-fetch dynamic import ───────────────────── */
let _fetch
async function getFetch() {
  if (!_fetch) {
    try { _fetch = (await import('node-fetch')).default }
    catch { _fetch = globalThis.fetch }
  }
  return _fetch
}

/* ── In-memory cache ─────────────────────────────── */
const NC  = new Map()
const TTL = { search:300000, mood:600000, trending:180000, related:600000,
              lyrics:3600000, lrcSearch:1800000, artist:600000 }
function ncGet(k) {
  const v = NC.get(k)
  if (!v) return null
  if (Date.now() - v.t > v.ttl) { NC.delete(k); return null }
  return v.d
}
function ncSet(k, d, ttl=300000) {
  if (NC.size > 500) { const now=Date.now(); for(const[k,v] of NC) if(now-v.t>v.ttl) NC.delete(k) }
  NC.set(k, { d, t:Date.now(), ttl })
}

/* ── Pending dedup ───────────────────────────────── */
const pending = new Map()
function dedupe(key, fn) {
  if (pending.has(key)) return pending.get(key)
  const p = fn().finally(() => pending.delete(key))
  pending.set(key, p); return p
}

/* ── YouTube Music Search (ytmusic-api free) ─────── */
// We proxy search through ytmusic unofficial API or innertube
const YT_MUSIC_URL = 'https://music.youtube.com'
const YT_CLIENT_KEY = 'AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30' // public ytmusic web key

async function ytMusicSearch(query, limit=20) {
  const fetch = await getFetch()
  const body = {
    query,
    params: 'EgWKAQIIAWoKEAkQAxAEEAoQBQ==', // songs filter
    context: {
      client: { clientName:'WEB_REMIX', clientVersion:'1.20240101.01.00', hl:'id', gl:'ID' }
    }
  }
  const r = await fetch(
    `https://music.youtube.com/youtubei/v1/search?key=${YT_CLIENT_KEY}&prettyPrint=false`,
    { method:'POST', headers:{'Content-Type':'application/json','User-Agent':'Mozilla/5.0','Origin':'https://music.youtube.com','Referer':'https://music.youtube.com/'},
      body:JSON.stringify(body), signal: AbortSignal.timeout(10000) }
  )
  if (!r.ok) throw new Error(`YTMusic search ${r.status}`)
  const data = await r.json()
  return parseYTMusicSearch(data, limit)
}

function parseYTMusicSearch(data, limit) {
  const results = []
  try {
    const tabs = data?.contents?.tabbedSearchResultsRenderer?.tabs || []
    for (const tab of tabs) {
      const sections = tab?.tabRenderer?.content?.sectionListRenderer?.contents || []
      for (const sec of sections) {
        const items = sec?.musicShelfRenderer?.contents || []
        for (const item of items) {
          const r = item?.musicResponsiveListItemRenderer
          if (!r) continue
          const song = parseMusicItem(r)
          if (song) results.push(song)
          if (results.length >= limit) break
        }
        if (results.length >= limit) break
      }
      if (results.length >= limit) break
    }
  } catch {}
  return results
}

function parseMusicItem(r) {
  try {
    const columns = r?.flexColumns || []
    const titleRuns = columns[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs
    const title = titleRuns?.[0]?.text
    const navEp = titleRuns?.[0]?.navigationEndpoint?.watchEndpoint
    const videoId = navEp?.videoId || r?.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId
    if (!videoId || !title) return null

    const col2Runs = columns[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || []
    let artist='', album='', durationText=''
    col2Runs.forEach((run,i) => {
      const t = run.text?.trim()
      if (!t || t==='•') return
      if (run.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType === 'MUSIC_PAGE_TYPE_ARTIST') {
        if (!artist) artist = t
      } else if (!artist) {
        artist = t
      } else if (!album && t !== artist) {
        album = t
      }
    })
    // Duration from last column
    const col3 = columns[2]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs
    durationText = col3?.[0]?.text || ''

    const thumb = r?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails
    const thumbnail = (thumb || []).sort((a,b)=>(b.width||0)-(a.width||0))[0]?.url || ''

    return {
      id: videoId,
      title: title.trim(),
      artist: artist || 'Unknown',
      album: album || '',
      duration: durationText,
      thumbnail: thumbnail.replace('w120-h120','w226-h226'),
      source: 'ytmusic'
    }
  } catch { return null }
}

async function ytMusicMood(mood, limit=18) {
  const moodQueries = {
    santai:'chill relax music 2024', fokus:'focus study music lofi', workout:'workout gym music',
    party:'party hits 2024', jazz:'jazz music relax', remix:'dj remix 2024',
    pop:'pop hits 2024 indonesia', rnb:'r&b soul music', anime:'anime opening ost',
    kpop:'kpop 2024', rock:'rock hits', gaming:'gaming music'
  }
  return ytMusicSearch(moodQueries[mood] || mood, limit)
}

async function ytMusicRelated(videoId, limit=12) {
  const fetch = await getFetch()
  const body = {
    videoId,
    context: {
      client: { clientName:'WEB_REMIX', clientVersion:'1.20240101.01.00', hl:'id', gl:'ID' }
    }
  }
  try {
    const r = await fetch(
      `https://music.youtube.com/youtubei/v1/next?key=${YT_CLIENT_KEY}&prettyPrint=false`,
      { method:'POST', headers:{'Content-Type':'application/json','User-Agent':'Mozilla/5.0','Origin':'https://music.youtube.com','Referer':'https://music.youtube.com/'},
        body:JSON.stringify(body), signal: AbortSignal.timeout(10000) }
    )
    if (!r.ok) return []
    const data = await r.json()
    const results = []
    const tabs = data?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer?.watchNextTabbedResultsRenderer?.tabs || []
    for (const tab of tabs) {
      const items = tab?.tabRenderer?.content?.musicQueueRenderer?.content?.playlistPanelRenderer?.contents || []
      for (const item of items) {
        const r = item?.playlistPanelVideoRenderer
        if (!r?.videoId || r.videoId===videoId) continue
        const title = r?.title?.runs?.[0]?.text || ''
        const artist = r?.longBylineText?.runs?.[0]?.text || ''
        const thumb  = r?.thumbnail?.thumbnails?.slice(-1)[0]?.url || ''
        if (title) results.push({ id:r.videoId, title, artist, thumbnail:thumb, duration:'', album:'', source:'ytmusic' })
        if (results.length >= limit) break
      }
      if (results.length > 0) break
    }
    return results
  } catch { return [] }
}

/* ── LRCLIB Lyrics ───────────────────────────────── */
async function fetchLrclib(title, artist, album='', duration='') {
  const fetch = await getFetch()
  const cleanTitle  = cleanSongTitle(title)
  const cleanArtist = (artist||'').replace(/\s*feat\.?.*/i,'').trim()

  // Try direct get first
  const params = new URLSearchParams()
  params.set('track_name', cleanTitle)
  if (cleanArtist) params.set('artist_name', cleanArtist)
  if (album)       params.set('album_name',  album)
  if (duration)    params.set('duration',     String(duration))

  const headers = { 'Lrclib-Client':'SoundWave/2.0', 'User-Agent':'SoundWave/2.0' }
  try {
    const r = await fetch(`https://lrclib.net/api/get?${params}`, { headers, signal:AbortSignal.timeout(8000) })
    if (r.ok) {
      const d = await r.json()
      if (d.syncedLyrics || d.plainLyrics)
        return { synced:d.syncedLyrics||null, plain:d.plainLyrics||null }
    }
  } catch {}

  // Fallback: search endpoint
  try {
    const q = `${cleanTitle} ${cleanArtist}`.trim()
    const r2 = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(q)}`, { headers, signal:AbortSignal.timeout(8000) })
    if (r2.ok) {
      const arr = await r2.json()
      if (arr.length) {
        const best = arr[0]
        return { synced:best.syncedLyrics||null, plain:best.plainLyrics||null }
      }
    }
  } catch {}
  return { synced:null, plain:null }
}

/* ── LRCLIB Lyric Search (for smart search) ──────── */
async function searchByLyric(lyricFragment, limit=8) {
  const fetch = await getFetch()
  try {
    const q = normalizeQuery(lyricFragment)
    const r = await fetch(
      `https://lrclib.net/api/search?q=${encodeURIComponent(q)}`,
      { headers:{'Lrclib-Client':'SoundWave/2.0'}, signal:AbortSignal.timeout(9000) }
    )
    if (!r.ok) return []
    const arr = await r.json()
    // Score each result
    const scored = arr.slice(0,30).map(item => {
      const score = lyricMatchScore(q, item)
      return { ...item, _score:score }
    }).filter(x=>x._score>0).sort((a,b)=>b._score-a._score).slice(0,limit)

    return scored.map(item => ({
      id: item.id,
      trackName: item.trackName,
      artistName: item.artistName,
      albumName: item.albumName || '',
      duration: item.duration || 0,
      _score: item._score,
      matchedLyric: findMatchedLyricLine(q, item.plainLyrics || item.syncedLyrics || '')
    }))
  } catch { return [] }
}

function lyricMatchScore(query, item) {
  const words = query.toLowerCase().split(/\s+/).filter(w=>w.length>2)
  const lyricText = ((item.plainLyrics||'')+(item.syncedLyrics||'')).toLowerCase()
  const titleText = (item.trackName||'').toLowerCase()
  let score = 0
  let matchedWords = 0
  for (const w of words) {
    if (lyricText.includes(w)) { score += 3; matchedWords++ }
    if (titleText.includes(w)) score += 1
  }
  // Bonus: consecutive phrase found
  if (words.length >= 3 && lyricText.includes(words.slice(0,3).join(' '))) score += 8
  // Must match at least 40% of meaningful words
  if (words.length > 0 && matchedWords/words.length < 0.4) return 0
  return score
}

function findMatchedLyricLine(query, lyrics) {
  if (!lyrics) return ''
  const words = query.toLowerCase().split(/\s+/).filter(w=>w.length>2)
  const lines = lyrics.replace(/\[\d+:\d+[.:]\d+\]/g,'').split('\n').map(l=>l.trim()).filter(Boolean)
  let best = '', bestScore = 0
  for (const line of lines) {
    const lc = line.toLowerCase()
    let s = words.filter(w=>lc.includes(w)).length
    if (s > bestScore) { bestScore=s; best=line }
  }
  return best.slice(0,120)
}

/* ── Smart Query Detection ───────────────────────── */
function normalizeQuery(q) {
  return q.toLowerCase()
    .replace(/[^\w\s]/g,'')
    .replace(/\s+/g,' ')
    .trim()
}

function cleanSongTitle(title) {
  return title
    .replace(/\s*[\(\[]\s*(official|lyrics?|video|audio|mv|hd|4k|live|feat\.?|ft\.?|explicit|clean|remix|extended|cover|karaoke)[^\)\]]*[\)\]]/gi,'')
    .replace(/\s*-\s*(official|lyrics?|video|audio|mv|hd|4k|live)(\s+version)?/gi,'')
    .replace(/\s{2,}/g,' ')
    .trim()
}

function detectQueryType(q) {
  const norm = normalizeQuery(q)
  const words = norm.split(' ')
  // Strong lyric signal: 5+ words, common lyric patterns
  if (words.length >= 5) return 'lyric'
  // Contains common lyric words
  const lyricWords = ['i ','you ','me ','my ','your ','we ','love ','heart ','feel ','know ','want ','need ']
  const hasLyricWord = lyricWords.some(w=>norm.includes(w))
  if (words.length >= 3 && hasLyricWord) return 'lyric'
  return 'title'
}

/* ── Middleware ──────────────────────────────────── */
app.set('trust proxy', 1)
app.use(express.json({ limit:'1mb' }))
app.use(express.static(join(__dirname,'public'), {
  maxAge:'7d', etag:true,
  setHeaders(res,path) {
    if (path.endsWith('.html')) res.setHeader('Cache-Control','no-cache')
    else res.setHeader('Cache-Control','public,max-age=604800')
  }
}))
app.use((req,res,next) => { res.setHeader('Connection','keep-alive'); next() })
app.use((req,res,next) => {
  req.setTimeout(20000,()=>{ if(!res.headersSent) res.status(408).json({error:'Timeout',fallback:true}) })
  next()
})

/* ── SEARCH ──────────────────────────────────────── */
app.get('/api/search', async (req,res) => {
  const q = (req.query.q||'').trim()
  if (!q) return res.json({results:[]})
  const key = `search:${q.toLowerCase()}`
  const hit = ncGet(key); if(hit) return res.json({results:hit})
  try {
    const data = await dedupe(key, () => ytMusicSearch(q, 25))
    ncSet(key, data, TTL.search)
    res.json({results:data})
  } catch(e) {
    console.error('[search]', e.message)
    res.status(500).json({error:e.message, fallback:true, results:[]})
  }
})

/* ── SMART SEARCH (lyric + title hybrid) ─────────── */
app.get('/api/smart-search', async (req,res) => {
  const q = (req.query.q||'').trim()
  if (!q) return res.json({results:[], type:'empty'})
  const key = `smart:${q.toLowerCase()}`
  const hit = ncGet(key); if(hit) return res.json(hit)

  const norm = normalizeQuery(q)
  const queryType = detectQueryType(norm)

  try {
    let titleResults = [], lyricResults = [], lyricMatches = []

    if (queryType === 'lyric') {
      // Run both in parallel
      const [tr, lr] = await Promise.allSettled([
        ytMusicSearch(q, 15),
        searchByLyric(q, 8)
      ])
      titleResults = tr.status==='fulfilled' ? tr.value : []
      lyricResults = lr.status==='fulfilled' ? lr.value : []
    } else {
      titleResults = await ytMusicSearch(q, 20)
    }

    // For each lyric match, try to find/verify YT video
    const lyricSongs = []
    for (const lm of lyricResults) {
      if (!lm.trackName) continue
      // Search YT for this song
      const ytQ = `${lm.trackName} ${lm.artistName||''}`
      const ytKey = `ytq:${ytQ.toLowerCase()}`
      let ytHit = ncGet(ytKey)
      if (!ytHit) {
        try {
          const r = await ytMusicSearch(ytQ, 3)
          ytHit = r[0] || null
          if (ytHit) ncSet(ytKey, ytHit, TTL.search)
        } catch {}
      }
      if (ytHit) {
        lyricSongs.push({
          ...ytHit,
          _lyricMatch:true,
          _matchedLine: lm.matchedLyric || '',
          _score: lm._score || 0
        })
      }
    }

    // Merge: lyric matches first (deduplicated), then title results
    const seen = new Set()
    const merged = []
    for (const s of lyricSongs) {
      if (!seen.has(s.id)) { seen.add(s.id); merged.push(s) }
    }
    for (const s of titleResults) {
      if (!seen.has(s.id)) { seen.add(s.id); merged.push(s) }
    }

    const result = { results:merged, type:queryType, lyricCount:lyricSongs.length }
    ncSet(key, result, TTL.lrcSearch)
    res.json(result)
  } catch(e) {
    console.error('[smart-search]', e.message)
    // Fallback to basic search
    try {
      const r = await ytMusicSearch(q, 20)
      res.json({results:r, type:'title', fallback:true})
    } catch {
      res.status(500).json({error:e.message, fallback:true, results:[], type:'error'})
    }
  }
})

/* ── MOOD ─────────────────────────────────────────── */
app.get('/api/mood/:mood', async (req,res) => {
  const mood = req.params.mood.toLowerCase()
  const key  = `mood:${mood}`
  const hit  = ncGet(key); if(hit) return res.json({results:hit})
  try {
    const data = await dedupe(key, () => ytMusicMood(mood, 18))
    ncSet(key, data, TTL.mood)
    res.json({results:data})
  } catch(e) {
    res.status(500).json({error:e.message, fallback:true, results:[]})
  }
})

/* ── TRENDING ─────────────────────────────────────── */
app.get('/api/trending', async (req,res) => {
  const key = 'trending'
  const hit = ncGet(key); if(hit) return res.json({results:hit})
  try {
    const data = await dedupe(key, () => ytMusicSearch('trending songs 2024 indonesia', 20))
    ncSet(key, data, TTL.trending)
    res.json({results:data})
  } catch(e) {
    res.status(500).json({error:e.message, fallback:true, results:[]})
  }
})

/* ── RELATED ──────────────────────────────────────── */
app.get('/api/related/:id', async (req,res) => {
  const id  = req.params.id
  const key = `related:${id}`
  const hit = ncGet(key); if(hit) return res.json({results:hit})
  try {
    let data = await dedupe(key, () => ytMusicRelated(id, 15))
    if (!data.length) data = await ytMusicSearch('chill pop songs 2024', 15)
    ncSet(key, data, TTL.related)
    res.json({results:data})
  } catch(e) {
    res.status(500).json({error:e.message, fallback:true, results:[]})
  }
})

/* ── LYRICS ───────────────────────────────────────── */
app.get('/api/lyrics', async (req,res) => {
  const { title, artist, album, duration } = req.query
  if (!title) return res.json({synced:null, plain:null})
  const key = `lyrics:${title}:${artist||''}`.toLowerCase().slice(0,200)
  const hit = ncGet(key); if(hit) return res.json(hit)
  try {
    const result = await dedupe(key, () => fetchLrclib(title, artist, album, duration))
    ncSet(key, result, TTL.lyrics)
    res.json(result)
  } catch(e) {
    console.error('[lyrics]', e.message)
    res.json({synced:null, plain:null})
  }
})

/* ── LYRIC SEARCH (standalone for smart search) ───── */
app.get('/api/lyric-search', async (req,res) => {
  const q = (req.query.q||'').trim()
  if (!q) return res.json({results:[]})
  const key = `lrcsearch:${q.toLowerCase().slice(0,150)}`
  const hit = ncGet(key); if(hit) return res.json({results:hit})
  try {
    const results = await searchByLyric(q, 10)
    ncSet(key, results, TTL.lrcSearch)
    res.json({results})
  } catch(e) {
    res.status(500).json({error:e.message, fallback:true, results:[]})
  }
})

/* ── HEALTH ───────────────────────────────────────── */
app.get('/api/health', (req,res) => res.json({
  status:'ok', uptime:Math.floor(process.uptime()),
  cache:NC.size, mem:Math.round(process.memoryUsage().heapUsed/1024/1024)+'MB',
  version:'2.0'
}))

/* ── SPA ──────────────────────────────────────────── */
app.get('*', (req,res) => {
  res.setHeader('Cache-Control','no-cache')
  res.sendFile(join(__dirname,'public','index.html'))
})

app.use((err,req,res,next) => {
  console.error('[err]', err.message)
  if (!res.headersSent) res.status(500).json({error:'Internal error', fallback:true})
})

const server = createServer(app)
server.keepAliveTimeout = 65000
server.headersTimeout   = 66000
server.listen(PORT, '0.0.0.0', () => console.log(`🎵 SoundWave V2 → http://localhost:${PORT}`))
