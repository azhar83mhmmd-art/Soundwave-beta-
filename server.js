/**
 * SoundWave v4.0 — Express + Python ytmusicapi + YouTube Iframe + LRCLIB
 */
import express from 'express'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { spawn } from 'child_process'
import { createServer } from 'http'

const __dirname = dirname(fileURLToPath(import.meta.url))
const app  = express()
const PORT = process.env.PORT || 3000

/* ── In-memory cache (Node side) ──────────────────────── */
const NC = new Map()
const NC_TTL = { search:300000, mood:600000, trending:180000, song:600000, artist:600000, related:600000, lyrics:3600000 }
function ncGet(k) { const v=NC.get(k); if(!v) return null; if(Date.now()-v.t>v.ttl){NC.delete(k);return null}; return v.d }
function ncSet(k,d,ttl=300000) {
  if(NC.size>400){const now=Date.now();for(const[k,v]of NC)if(now-v.t>v.ttl)NC.delete(k)}
  NC.set(k,{d,t:Date.now(),ttl})
}

/* ── Python bridge ────────────────────────────────────── */
const PYTHON = process.env.PYTHON || 'python3'
const BRIDGE = join(__dirname, 'python', 'bridge.py')

function pyCall(payload, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let out = '', err = ''
    const py = spawn(PYTHON, [BRIDGE, JSON.stringify(payload)])
    const timer = setTimeout(() => { py.kill(); reject(new Error('Python timeout')) }, timeoutMs)
    py.stdout.on('data', d => { out += d })
    py.stderr.on('data', d => { err += d })
    py.on('close', code => {
      clearTimeout(timer)
      try {
        const parsed = JSON.parse(out.trim())
        if (parsed.ok) resolve(parsed.data)
        else reject(new Error(parsed.error || 'Python error'))
      } catch {
        reject(new Error(`Parse fail (code ${code}): ${err.slice(0,200)}`))
      }
    })
    py.on('error', e => { clearTimeout(timer); reject(e) })
  })
}

/* ── Pending dedup ────────────────────────────────────── */
const pending = new Map()
function dedupe(key, fn) {
  if (pending.has(key)) return pending.get(key)
  const p = fn().finally(() => pending.delete(key))
  pending.set(key, p); return p
}

/* ── Middleware ───────────────────────────────────────── */
app.set('trust proxy', 1)
app.use(express.json({ limit: '1mb' }))
app.use(express.static(join(__dirname, 'public'), {
  maxAge: '7d', etag: true,
  setHeaders(res, path) {
    if (path.endsWith('.html')) res.setHeader('Cache-Control','no-cache')
    else res.setHeader('Cache-Control','public,max-age=604800')
  }
}))
app.use((req,res,next)=>{ res.setHeader('Connection','keep-alive'); next() })

/* ── Timeout ──────────────────────────────────────────── */
app.use((req,res,next)=>{ req.setTimeout(18000,()=>{ if(!res.headersSent) res.status(408).json({error:'Timeout'}) }); next() })

/* ── SEARCH ───────────────────────────────────────────── */
app.get('/api/search', async (req,res) => {
  const q = (req.query.q||'').trim()
  if (!q) return res.json({results:[]})
  const key = `search:${q.toLowerCase()}`
  const hit = ncGet(key); if(hit) return res.json({results:hit})
  try {
    const data = await dedupe(key, () => pyCall({action:'search',query:q,limit:20}))
    ncSet(key, data, NC_TTL.search)
    res.json({results: data})
  } catch(e) {
    console.error('[search]', e.message)
    res.status(500).json({error:e.message, results:[]})
  }
})

/* ── MOOD ─────────────────────────────────────────────── */
app.get('/api/mood/:mood', async (req,res) => {
  const mood = req.params.mood.toLowerCase()
  const key  = `mood:${mood}`
  const hit  = ncGet(key); if(hit) return res.json({results:hit})
  try {
    const data = await dedupe(key, () => pyCall({action:'mood',mood}))
    ncSet(key, data, NC_TTL.mood)
    res.json({results: data})
  } catch(e) {
    res.status(500).json({error:e.message, results:[]})
  }
})

/* ── TRENDING ─────────────────────────────────────────── */
app.get('/api/trending', async (req,res) => {
  const force = req.query.t ? true : false
  const key   = force ? `trending:${Math.floor(Date.now()/180000)}` : 'trending'
  const hit   = ncGet(key); if(hit) return res.json({results:hit})
  try {
    const data = await dedupe(key, () => pyCall({action:'trending'}))
    ncSet(key, data, NC_TTL.trending)
    res.json({results: data})
  } catch(e) {
    res.status(500).json({error:e.message, results:[]})
  }
})

/* ── SONG DETAIL ──────────────────────────────────────── */
app.get('/api/song/:id', async (req,res) => {
  const id  = req.params.id
  const key = `song:${id}`
  const hit = ncGet(key); if(hit) return res.json(hit)
  try {
    const data = await dedupe(key, () => pyCall({action:'song',id}))
    ncSet(key, data, NC_TTL.song)
    res.json(data)
  } catch(e) {
    res.status(500).json({error:e.message})
  }
})

/* ── ARTIST ───────────────────────────────────────────── */
app.get('/api/artist/:id', async (req,res) => {
  const id  = req.params.id
  const key = `artist:${id}`
  const hit = ncGet(key); if(hit) return res.json(hit)
  try {
    const data = await dedupe(key, () => pyCall({action:'artist',id}))
    ncSet(key, data, NC_TTL.artist)
    res.json(data)
  } catch(e) {
    res.status(500).json({error:e.message})
  }
})

/* ── RELATED ──────────────────────────────────────────── */
app.get('/api/related/:id', async (req,res) => {
  const id  = req.params.id
  const key = `related:${id}`
  const hit = ncGet(key); if(hit) return res.json({results:hit})
  try {
    const data = await dedupe(key, () => pyCall({action:'related',id}))
    ncSet(key, data, NC_TTL.related)
    res.json({results: data})
  } catch(e) {
    res.status(500).json({error:e.message, results:[]})
  }
})

/* ── LYRICS (LRCLIB proxy) ────────────────────────────── */
app.get('/api/lyrics', async (req,res) => {
  const { title, artist, album, duration } = req.query
  if (!title) return res.json({synced:null, plain:null})

  const key = `lyrics:${title}:${artist||''}`.toLowerCase()
  const hit = ncGet(key); if(hit) return res.json(hit)

  try {
    // Build LRCLIB query
    const params = new URLSearchParams()
    if (artist)   params.set('artist_name',   artist)
    if (title)    params.set('track_name',     title)
    if (album)    params.set('album_name',     album)
    if (duration) params.set('duration',       duration)

    // fetch from LRCLIB — this runs server-side (Termux has internet)
    const { default: fetch } = await import('node-fetch')
    const url = `https://lrclib.net/api/get?${params}`
    const r = await fetch(url, { headers: { 'Lrclib-Client': 'SoundWave/4.0' }, signal: AbortSignal.timeout(8000) })

    if (!r.ok) {
      // Try search endpoint as fallback
      const r2 = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(title+' '+(artist||''))}`, {
        headers: { 'Lrclib-Client': 'SoundWave/4.0' }, signal: AbortSignal.timeout(8000)
      })
      if (r2.ok) {
        const arr = await r2.json()
        if (arr.length) {
          const best = arr[0]
          const result = { synced: best.syncedLyrics || null, plain: best.plainLyrics || null }
          ncSet(key, result, NC_TTL.lyrics)
          return res.json(result)
        }
      }
      return res.json({ synced: null, plain: null })
    }

    const data = await r.json()
    const result = { synced: data.syncedLyrics || null, plain: data.plainLyrics || null }
    ncSet(key, result, NC_TTL.lyrics)
    res.json(result)
  } catch(e) {
    console.error('[lyrics]', e.message)
    res.json({ synced: null, plain: null })
  }
})

/* ── HEALTH ───────────────────────────────────────────── */
app.get('/api/health', (req,res) => res.json({
  status:'ok', uptime:Math.floor(process.uptime()),
  cache:NC.size, mem:Math.round(process.memoryUsage().heapUsed/1024/1024)+'MB'
}))

/* ── SPA ──────────────────────────────────────────────── */
app.get('*', (req,res) => {
  res.setHeader('Cache-Control','no-cache')
  res.sendFile(join(__dirname,'public','index.html'))
})

app.use((err,req,res,next) => {
  console.error('[err]', err.message)
  if (!res.headersSent) res.status(500).json({error:'Internal error'})
})
process.on('unhandledRejection', r => console.error('[unhandled]', r))

const server = createServer(app)
server.keepAliveTimeout = 65000
server.headersTimeout   = 66000
server.listen(PORT, () => console.log(`🎵 SoundWave v4.0 → http://localhost:${PORT}`))
