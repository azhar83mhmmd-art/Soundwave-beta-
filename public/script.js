/**
 * SoundWave v4.0 — Full Vanilla JS
 * YouTube IFrame Player · LRCLIB Lyrics · ytmusicapi metadata
 * Optimized: DocumentFragment, IntersectionObserver, debounce, binary search
 */

/* ═══════════════════════════════════════════════
   CONSTANTS
   ═══════════════════════════════════════════════ */
const PH = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'%3E%3Crect fill='%231a1a2e'/%3E%3C/svg%3E`
const PLAY_IC  = `<svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21"/></svg>`
const PAUSE_IC = `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`
const HEART_IC = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`
const MORE_IC  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="5" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="19" r="1" fill="currentColor"/></svg>`

/* ═══════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════ */
const $ = id => document.getElementById(id)
const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
const fmt = s => { if(!s||isNaN(s)) return '0:00'; const n=Math.round(s); return `${Math.floor(n/60)}:${(n%60).toString().padStart(2,'0')}` }
const debounce = (fn,ms) => { let t; return (...a) => { clearTimeout(t); t=setTimeout(()=>fn(...a),ms) } }

/* Active AbortControllers */
const AC = {}
function mkAC(k) { try{AC[k]?.abort()}catch{}; AC[k]=new AbortController(); return AC[k] }

/* ═══════════════════════════════════════════════
   STORE — lightweight localStorage
   ═══════════════════════════════════════════════ */
const Store = {
  get(k,d=null){ try{const v=localStorage.getItem('sw4_'+k);return v?JSON.parse(v):d}catch{return d} },
  set(k,v){ try{localStorage.setItem('sw4_'+k,JSON.stringify(v))}catch{} },
  rm(k){ try{localStorage.removeItem('sw4_'+k)}catch{} }
}

/* ═══════════════════════════════════════════════
   TOAST
   ═══════════════════════════════════════════════ */
const Toast = {
  _n:0,
  show(msg,type='info',dur=2600){
    if(this._n>2) return; this._n++
    const icons={
      success:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`,
      error:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
      info:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
      warning:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`
    }
    const el = document.createElement('div')
    el.className = `toast toast-${type}`
    el.innerHTML = `${icons[type]||icons.info}<span>${msg}</span>`
    $('toast-root').appendChild(el)
    setTimeout(()=>{ el.classList.add('tout'); setTimeout(()=>{el.remove();this._n--},260) }, dur)
  }
}

/* ═══════════════════════════════════════════════
   LAZY IMAGE — IntersectionObserver
   ═══════════════════════════════════════════════ */
const Lazy = (() => {
  const io = new IntersectionObserver(entries=>{
    entries.forEach(e=>{
      if(!e.isIntersecting) return
      const img=e.target, src=img.dataset.src
      if(!src) return
      img.src=src
      img.onload=()=>img.classList.add('loaded')
      img.onerror=()=>{img.src=PH;img.classList.add('loaded')}
      io.unobserve(img)
    })
  },{rootMargin:'120px 0px',threshold:0.01})
  return { obs:img=>{ if(!img?.dataset?.src) return; if(img.complete&&img.naturalWidth){img.classList.add('loaded');return}; io.observe(img) } }
})()

/* ═══════════════════════════════════════════════
   ROUTER
   ═══════════════════════════════════════════════ */
const Router = {
  cur:'home',
  go(pg){
    if(pg===this.cur) return
    document.querySelectorAll('.pg').forEach(p=>p.classList.remove('active'))
    document.querySelectorAll('.nb').forEach(b=>b.classList.toggle('active',b.dataset.pg===pg))
    document.getElementById('pg-'+pg)?.classList.add('active')
    this.cur=pg
    if(pg==='library') LibCtrl.render()
  },
  init(){
    document.querySelectorAll('.nb').forEach(b=>b.addEventListener('click',()=>this.go(b.dataset.pg)))
    document.querySelector('.nb[data-pg="home"]')?.classList.add('active')
  }
}

/* ═══════════════════════════════════════════════
   YOUTUBE IFRAME PLAYER — Singleton
   ═══════════════════════════════════════════════ */
const YTPlayer = {
  player: null,
  ready:  false,
  pendingId: null,
  _pollTimer: null,

  init(){
    // Load YT IFrame API
    if(window.YT?.Player){ this._create(); return }
    const tag=document.createElement('script')
    tag.src='https://www.youtube.com/iframe_api'
    document.head.appendChild(tag)
    window.onYouTubeIframeAPIReady=()=>this._create()
  },

  _create(){
    this.player = new YT.Player('yt-player',{
      height:'1', width:'1',
      playerVars:{ autoplay:1, controls:0, disablekb:1, fs:0, iv_load_policy:3, modestbranding:1, rel:0, playsinline:1 },
      events:{
        onReady:()=>{ this.ready=true; if(this.pendingId){ this.loadVideo(this.pendingId); this.pendingId=null } },
        onStateChange:e=>this._onState(e),
        onError:e=>this._onError(e)
      }
    })
  },

  loadVideo(videoId){
    if(!this.ready){ this.pendingId=videoId; return }
    this.player.loadVideoById(videoId)
    clearInterval(this._pollTimer)
    this._pollTimer = setInterval(()=>PlayerCtrl._onYTProgress(), 400)
  },

  play(){ if(this.ready) this.player.playVideo() },
  pause(){ if(this.ready) this.player.pauseVideo() },
  seek(pct){ if(!this.ready) return; const d=this.getDuration(); if(d>0) this.player.seekTo(d*(pct/100),true) },
  getDuration(){ try{return this.player?.getDuration()||0}catch{return 0} },
  getCurrentTime(){ try{return this.player?.getCurrentTime()||0}catch{return 0} },
  getState(){ try{return this.player?.getPlayerState()??-1}catch{return -1} },

  _onState(e){
    const S=YT.PlayerState
    if(e.data===S.PLAYING){
      PlayerCtrl._setPlay(true)
      PlayerCtrl._setLoad(false)
    } else if(e.data===S.PAUSED){
      PlayerCtrl._setPlay(false)
    } else if(e.data===S.BUFFERING){
      PlayerCtrl._setLoad(true)
    } else if(e.data===S.ENDED){
      PlayerCtrl._onEnded()
    }
  },
  _onError(e){
    console.warn('[YT Error]',e.data)
    PlayerCtrl._setLoad(false)
    Toast.show('Gagal memutar video. Coba lagu lain.','error')
  }
}

/* ═══════════════════════════════════════════════
   PLAYER CONTROLLER
   ═══════════════════════════════════════════════ */
const PlayerCtrl = {
  current: null,
  queue:   [],
  idx:     0,
  shuffle: false,
  repeat:  false, // false|'one'|'all'

  init(){
    this._bindControls()
    this._bindFP()
    this._restore()
    YTPlayer.init()
  },

  _bindControls(){
    $('mp-pp').addEventListener('click',e=>{e.stopPropagation();this.toggle()})
    $('mp-next').addEventListener('click',e=>{e.stopPropagation();this.next()})
    $('fpc-play').addEventListener('click',()=>this.toggle())
    $('fpc-prev').addEventListener('click',()=>this.prev())
    $('fpc-next').addEventListener('click',()=>this.next())
    $('fpc-shuffle').addEventListener('click',()=>this.toggleShuffle())
    $('fpc-repeat').addEventListener('click',()=>this.toggleRepeat())
    $('fp-like').addEventListener('click',()=>this.toggleLike())
    $('hero-like').addEventListener('click',()=>this.toggleLike())

    const seek=$('fp-seek')
    seek.addEventListener('input',()=>{
      seek.style.setProperty('--pct',seek.value+'%')
      YTPlayer.seek(parseFloat(seek.value))
    })

    // Open detail from full player menu btn
    $('fp-detail-open').addEventListener('click',()=>{
      if(this.current) DetailSheet.open(this.current)
    })
  },

  _bindFP(){
    $('fp-down').addEventListener('click',()=>FP.hide())
    $('mp-open').addEventListener('click',e=>{
      if(e.target.closest('.mp-btn')||e.target.closest('#mp-loader')) return
      FP.show()
    })
  },

  play(song, queue=null){
    if(!song) return
    if(queue){ this.queue=[...queue]; this.idx=queue.findIndex(s=>s.id===song.id); if(this.idx<0) this.idx=0 }
    else if(!this.queue.length){ this.queue=[song]; this.idx=0 }
    this.current=song
    this._updateUI(song)
    this._setLoad(true)
    YTPlayer.loadVideo(song.id)
    // Save history non-blocking
    if(window.requestIdleCallback) requestIdleCallback(()=>this._saveHist(song))
    else setTimeout(()=>this._saveHist(song),0)
  },

  toggle(){
    if(!this.current) return
    const s=YTPlayer.getState()
    if(s===1) YTPlayer.pause()     // playing → pause
    else YTPlayer.play()           // paused/stopped → play
  },

  next(){
    if(!this.queue.length) return
    this.idx=this.shuffle ? Math.floor(Math.random()*this.queue.length) : (this.idx+1)%this.queue.length
    this.play(this.queue[this.idx])
  },

  prev(){
    if(!this.queue.length) return
    if(YTPlayer.getCurrentTime()>3){ YTPlayer.seek(0); return }
    this.idx=(this.idx-1+this.queue.length)%this.queue.length
    this.play(this.queue[this.idx])
  },

  toggleShuffle(){
    this.shuffle=!this.shuffle
    $('fpc-shuffle').classList.toggle('active',this.shuffle)
    Toast.show(this.shuffle?'Acak aktif':'Acak nonaktif','info',1400)
  },

  toggleRepeat(){
    const m=[false,'one','all'], c=m.indexOf(this.repeat)
    this.repeat=m[(c+1)%3]
    $('fpc-repeat').classList.toggle('active',!!this.repeat)
    Toast.show({false:'Ulang nonaktif',one:'Ulang satu',all:'Ulang semua'}[this.repeat],'info',1400)
  },

  likeById(song){
    const liked=Store.get('liked',[])
    const has=liked.some(s=>s.id===song.id)
    Store.set('liked', has?liked.filter(s=>s.id!==song.id):[song,...liked])
    Toast.show(has?'Dihapus dari Disukai':'♥ Ditambahkan ke Disukai', has?'info':'success')
    LibCtrl.updateCounts()
  },

  toggleLike(){
    if(this.current) this.likeById(this.current)
    this._syncLike()
  },

  _syncLike(){
    const liked=Store.get('liked',[])
    const is=this.current&&liked.some(s=>s.id===this.current.id)
    $('fp-like').classList.toggle('liked',!!is)
    $('hero-like').classList.toggle('liked',!!is)
  },

  _onEnded(){
    clearInterval(YTPlayer._pollTimer)
    if(this.repeat==='one'){ YTPlayer.seek(0); YTPlayer.play(); return }
    if(this.repeat==='all'||this.idx<this.queue.length-1) this.next()
    else this._setPlay(false)
  },

  _onYTProgress(){
    const dur=YTPlayer.getDuration(), cur=YTPlayer.getCurrentTime()
    if(!dur) return
    const pct=(cur/dur)*100
    const seek=$('fp-seek')
    seek.value=pct
    seek.style.setProperty('--pct',pct+'%')
    $('mp-fill').style.width=pct+'%'
    $('fp-cur').textContent=fmt(cur)
    $('fp-dur').textContent=fmt(dur)
    // Lyrics sync
    LyricsCtrl.syncAt(cur)
  },

  _setLoad(v){
    if(v){ $('mp-loader')?.classList.remove('hidden'); $('mp-pp')?.classList.add('hidden');
           $('fp-buf')?.classList.remove('hidden') }
    else { $('mp-loader')?.classList.add('hidden');    $('mp-pp')?.classList.remove('hidden');
           $('fp-buf')?.classList.add('hidden') }
  },

  _setPlay(playing){
    $('fpc-play').innerHTML=playing?PAUSE_IC:PLAY_IC
    $('mp-pp').innerHTML=playing?PAUSE_IC:PLAY_IC
    $('fp-art')?.classList.toggle('playing',playing)
  },

  _updateUI(song){
    const mp=$('mini-player')
    mp.classList.remove('hidden'); mp.classList.add('show')
    $('mp-thumb').src=song.thumbnail||PH
    $('mp-title').textContent=song.title||''
    $('mp-artist').textContent=song.artist||''
    FP.setSong(song)
    this._syncLike()
    this._setLoad(true)
    requestAnimationFrame(()=>{
      document.querySelectorAll('.mcard,.sitem,.qp-card').forEach(el=>{
        el.classList.toggle('is-playing',el.dataset.id===song.id)
      })
    })
  },

  _saveHist(song){
    const h=Store.get('history',[]).filter(s=>s.id!==song.id)
    h.unshift(song)
    Store.set('history',h.slice(0,80))
    LibCtrl.updateCounts()
    HomeCtrl.refreshRecently()
  },

  _restore(){
    const h=Store.get('history',[])
    if(h.length){ this.current=h[0]; this._updateUI(h[0]); this._setPlay(false); this._setLoad(false) }
  }
}

/* ═══════════════════════════════════════════════
   FULL PLAYER
   ═══════════════════════════════════════════════ */
const FP = {
  show(){ const f=$('full-player'); f.classList.remove('hidden'); f.classList.add('show'); document.body.style.overflow='hidden' },
  hide(){ const f=$('full-player'); f.classList.remove('show'); f.classList.add('hidden'); document.body.style.overflow='' },
  setSong(s){
    $('fp-title').textContent=s.title||''
    $('fp-artist').textContent=s.artist||''
    const a=$('fp-art'); a.src=s.thumbnail||PH; a.onerror=()=>a.src=PH
    $('fp-bg').style.backgroundImage=`url(${s.thumbnail})`
    $('fp-glow').style.backgroundImage=`url(${s.thumbnail})`
    // Load lyrics async
    LyricsCtrl.load(s)
  }
}

/* ═══════════════════════════════════════════════
   LYRICS CONTROLLER
   ═══════════════════════════════════════════════ */
const LyricsCtrl = {
  _lines:  [],   // [{time, text}]
  _curIdx: -1,
  _plain:  null,

  async load(song){
    this._lines=[]; this._curIdx=-1; this._plain=null
    $('fp-lyric-cur').textContent=''
    $('fp-lyric-next').textContent=''
    // Update detail sheet lyrics too if open
    const lc=$('lyrics-container')
    if(lc) lc.innerHTML=`<div class="lyrics-empty"><div class="spin-ring"></div><p>Memuat lirik...</p></div>`

    try {
      const p=new URLSearchParams({
        title: song.title||'',
        artist:song.artist||'',
        duration:song.durationS||''
      })
      const res=await fetch('/api/lyrics?'+p, {signal:mkAC('lyrics').signal})
      const data=await res.json()
      if(data.synced){
        this._lines=this._parse(data.synced)
        this._renderSynced(lc)
      } else if(data.plain){
        this._plain=data.plain
        this._renderPlain(lc)
      } else {
        if(lc) lc.innerHTML=`<div class="lyrics-empty"><p>Lirik tidak ditemukan</p></div>`
      }
    } catch(e){
      if(e.name==='AbortError') return
      if(lc) lc.innerHTML=`<div class="lyrics-empty"><p>Gagal memuat lirik</p></div>`
    }
  },

  _parse(lrc){
    const lines=[]
    const re=/\[(\d{2}):(\d{2})[.::](\d{2,3})\]\s*(.*)/g
    let m
    while((m=re.exec(lrc))!==null){
      const t=parseInt(m[1])*60+parseInt(m[2])+parseInt(m[3].length===3?m[3]:m[3]+'0')/1000
      if(m[4].trim()) lines.push({time:t,text:m[4].trim()})
    }
    return lines.sort((a,b)=>a.time-b.time)
  },

  _renderSynced(container){
    if(!container) return
    const frag=document.createDocumentFragment()
    this._lines.forEach((l,i)=>{
      const div=document.createElement('div')
      div.className='lrc-line'
      div.dataset.idx=i
      div.textContent=l.text
      div.addEventListener('click',()=>{
        const dur=YTPlayer.getDuration()
        if(dur>0) YTPlayer.player?.seekTo(l.time,true)
      },{passive:true})
      frag.appendChild(div)
    })
    container.innerHTML=''
    container.appendChild(frag)
  },

  _renderPlain(container){
    if(!container) return
    container.innerHTML=`<div class="lyrics-plain">${esc(this._plain)}</div>`
  },

  // Binary search for current lyric line
  _findIdx(t){
    let lo=0, hi=this._lines.length-1, res=-1
    while(lo<=hi){
      const mid=(lo+hi)>>1
      if(this._lines[mid].time<=t){ res=mid; lo=mid+1 }
      else hi=mid-1
    }
    return res
  },

  syncAt(t){
    if(!this._lines.length) return
    const idx=this._findIdx(t)
    if(idx===this._curIdx) return  // no change — skip rerender
    this._curIdx=idx

    // Update full player strip
    const cur=$('fp-lyric-cur'), nxt=$('fp-lyric-next')
    if(cur) cur.textContent=idx>=0 ? this._lines[idx].text : ''
    if(nxt) nxt.textContent=(idx+1<this._lines.length) ? this._lines[idx+1].text : ''

    // Update detail sheet — only the active class
    const lc=$('lyrics-container')
    if(!lc) return
    const lines=lc.querySelectorAll('.lrc-line')
    if(!lines.length) return
    lines.forEach((el,i)=>{
      const active=i===idx
      if(active!==el.classList.contains('active')){
        el.classList.toggle('active',active)
        if(active) el.scrollIntoView({behavior:'smooth',block:'center'})
      }
    })
  }
}

/* ═══════════════════════════════════════════════
   CARD + LIST BUILDERS (DocumentFragment)
   ═══════════════════════════════════════════════ */
function buildCards(songs, container, onPlay){
  const frag=document.createDocumentFragment()
  songs.forEach((s,i)=>{
    const liked=Store.get('liked',[]).some(x=>x.id===s.id)
    const d=document.createElement('div')
    d.className='mcard'+(PlayerCtrl.current?.id===s.id?' is-playing':'')
    d.dataset.id=s.id
    d.innerHTML=`
      <div class="mc-thumb">
        <img class="mc-img" data-src="${s.thumbnail||PH}" alt="" loading="lazy"/>
        <div class="mc-ph"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>
        <div class="mc-overlay"><button class="mc-play-btn" aria-label="Play"><svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21"/></svg></button></div>
        <button class="mc-like ${liked?'liked':''}" data-i="${i}" aria-label="Like">${HEART_IC}</button>
        <div class="mc-eq"><div class="mc-eq-b"></div><div class="mc-eq-b"></div><div class="mc-eq-b"></div></div>
      </div>
      <div class="mc-info">
        <p class="mc-title">${esc(s.title)}</p>
        <p class="mc-artist">${esc(s.artist||'Unknown')}</p>
        ${s.duration?`<p class="mc-dur">${s.duration}</p>`:''}
      </div>`
    Lazy.obs(d.querySelector('.mc-img'))
    d.addEventListener('click',e=>{
      const likeBtn=e.target.closest('.mc-like')
      if(likeBtn){ PlayerCtrl.likeById(s); likeBtn.classList.toggle('liked',Store.get('liked',[]).some(x=>x.id===s.id)); return }
      onPlay?onPlay(i):PlayerCtrl.play(s,songs)
    },{passive:true})
    frag.appendChild(d)
  })
  container.innerHTML=''
  container.appendChild(frag)
}

function appendCards(songs, container, baseIdx, allSongs){
  const frag=document.createDocumentFragment()
  songs.forEach((s,i)=>{
    const liked=Store.get('liked',[]).some(x=>x.id===s.id)
    const d=document.createElement('div')
    d.className='mcard'+(PlayerCtrl.current?.id===s.id?' is-playing':'')
    d.dataset.id=s.id
    d.innerHTML=`
      <div class="mc-thumb">
        <img class="mc-img" data-src="${s.thumbnail||PH}" alt="" loading="lazy"/>
        <div class="mc-ph"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>
        <div class="mc-overlay"><button class="mc-play-btn"><svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21"/></svg></button></div>
        <button class="mc-like ${liked?'liked':''}" data-i="${baseIdx+i}">${HEART_IC}</button>
        <div class="mc-eq"><div class="mc-eq-b"></div><div class="mc-eq-b"></div><div class="mc-eq-b"></div></div>
      </div>
      <div class="mc-info">
        <p class="mc-title">${esc(s.title)}</p>
        <p class="mc-artist">${esc(s.artist||'Unknown')}</p>
        ${s.duration?`<p class="mc-dur">${s.duration}</p>`:''}
      </div>`
    Lazy.obs(d.querySelector('.mc-img'))
    d.addEventListener('click',e=>{
      const lb=e.target.closest('.mc-like')
      if(lb){ PlayerCtrl.likeById(s); lb.classList.toggle('liked',Store.get('liked',[]).some(x=>x.id===s.id)); return }
      PlayerCtrl.play(s,allSongs)
    },{passive:true})
    frag.appendChild(d)
  })
  container.appendChild(frag)
}

function buildSongList(songs, container, opts={}){
  const frag=document.createDocumentFragment()
  songs.forEach((s,i)=>{
    const d=document.createElement('div')
    d.className='sitem'+(PlayerCtrl.current?.id===s.id?' is-playing':'')
    d.dataset.id=s.id; d.dataset.i=i
    d.innerHTML=`
      <div class="s-thumb">
        <img class="s-img" data-src="${s.thumbnail||PH}" alt="" loading="lazy"/>
        <div class="s-eq"><div class="s-eq-b"></div><div class="s-eq-b"></div><div class="s-eq-b"></div></div>
      </div>
      <div class="s-info">
        <p class="s-title">${esc(s.title)}</p>
        <p class="s-meta">${esc(s.artist||'Unknown')}${s.duration?' · '+s.duration:''}</p>
      </div>
      ${s.duration?`<span class="s-dur">${s.duration}</span>`:''}
      <button class="s-more" aria-label="More">${MORE_IC}</button>`
    Lazy.obs(d.querySelector('.s-img'))
    frag.appendChild(d)
  })
  container.innerHTML=''
  container.appendChild(frag)
  // One delegated listener
  container.addEventListener('click',e=>{
    const item=e.target.closest('.sitem')
    if(!item) return
    const i=parseInt(item.dataset.i), s=songs[i]
    if(!s) return
    if(e.target.closest('.s-more')){ Modal.playlist(s); return }
    PlayerCtrl.play(s,songs)
  },{passive:true})
}

function skCards(n){
  return Array(n).fill(0).map(()=>`<div class="sk-card"><div class="sk-card-t shim"></div><div class="sk-card-i"><div class="sk-line shim" style="height:11px;width:78%"></div><div class="sk-line shim" style="height:9px;width:52%"></div></div></div>`).join('')
}

/* ═══════════════════════════════════════════════
   DETAIL SHEET
   ═══════════════════════════════════════════════ */
const DetailSheet = {
  _song: null,

  open(song){
    this._song=song
    $('detail-title').textContent=song.title||''
    $('detail-artist').textContent=song.artist||''
    $('detail-info').textContent=[song.album,song.year,song.duration].filter(Boolean).join(' · ')
    const t=$('detail-thumb'); t.src=song.thumbnail||PH; t.onerror=()=>t.src=PH
    this._syncLike()

    $('detail-play').onclick=()=>{ PlayerCtrl.play(song); FP.show() }
    $('detail-like').onclick=()=>{ PlayerCtrl.likeById(song); this._syncLike() }
    $('detail-add').onclick=()=>Modal.playlist(song)

    // Switch to lyrics tab
    this._switchTab('lyrics')

    // Lyrics already loaded by FP if same song
    if(PlayerCtrl.current?.id===song.id){
      // re-render if we have lines
      if(LyricsCtrl._lines.length) LyricsCtrl._renderSynced($('lyrics-container'))
      else if(LyricsCtrl._plain)   LyricsCtrl._renderPlain($('lyrics-container'))
    } else {
      LyricsCtrl.load(song)
    }

    // Load related
    this._loadRelated(song.id)

    const sheet=$('detail-sheet'), bd=$('detail-backdrop')
    sheet.classList.remove('hidden'); sheet.classList.add('show')
    bd.classList.remove('hidden')
    document.body.style.overflow='hidden'
  },

  close(){
    $('detail-sheet').classList.add('hidden')
    $('detail-backdrop').classList.add('hidden')
    document.body.style.overflow=''
  },

  _syncLike(){
    const liked=Store.get('liked',[])
    const is=this._song&&liked.some(s=>s.id===this._song.id)
    $('detail-like').classList.toggle('liked',!!is)
  },

  _switchTab(tab){
    document.querySelectorAll('.dtab').forEach(b=>b.classList.toggle('active',b.dataset.dtab===tab))
    document.querySelectorAll('.dtab-panel').forEach(p=>p.classList.toggle('active',p.id==='dtab-'+tab))
  },

  async _loadRelated(id){
    const rl=$('related-list')
    rl.innerHTML=`<div style="padding:16px 0;text-align:center"><div class="spin-ring" style="margin:0 auto"></div></div>`
    try {
      const res=await fetch(`/api/related/${id}`,{signal:mkAC('related').signal})
      const data=await res.json()
      const songs=data.results||[]
      if(!songs.length){ rl.innerHTML=`<div class="lib-empty"><p>Tidak ada rekomendasi</p></div>`; return }
      buildSongList(songs,rl)
    } catch(e){
      if(e.name==='AbortError') return
      rl.innerHTML=`<div class="lib-empty"><p>Gagal memuat</p></div>`
    }
  },

  init(){
    $('detail-close').addEventListener('click',()=>this.close())
    $('detail-backdrop').addEventListener('click',()=>this.close())
    document.querySelectorAll('.dtab').forEach(b=>{
      b.addEventListener('click',()=>this._switchTab(b.dataset.dtab))
    })
  }
}

/* ═══════════════════════════════════════════════
   HOME CONTROLLER
   ═══════════════════════════════════════════════ */
const HomeCtrl = {
  moodSongs:[],
  _tint:null,

  init(){
    this._greet()
    this._bindChips()
    this.loadMood('santai')
    setTimeout(()=>this.loadTrending(),100)
    setTimeout(()=>this.loadQuickPicks(),200)
    setTimeout(()=>this.refreshRecently(),300)
    this._tint=setInterval(()=>this.loadTrending(true),3*60*1000)

    $('btn-play-all')?.addEventListener('click',()=>{
      if(this.moodSongs.length) PlayerCtrl.play(this.moodSongs[0],this.moodSongs)
    })
  },

  _greet(){
    const h=new Date().getHours()
    const g=h<11?'☀️ Pagi':h<15?'🌤 Siang':h<18?'🌇 Sore':'🌙 Malam'
    // No greeting element in this version — could add to header-left
  },

  _bindChips(){
    const moodNames={santai:'Pilihan Santai',fokus:'Musik Fokus',workout:'Workout Mix',party:'Party Hits',jazz:'Jazz Lounge',remix:'DJ Remix',pop:'Pop Hits',rnb:'R&B Vibes',anime:'Anime OST'}
    document.querySelectorAll('#mood-chips .chip').forEach(btn=>{
      btn.addEventListener('click',()=>{
        document.querySelectorAll('#mood-chips .chip').forEach(b=>b.classList.remove('active'))
        btn.classList.add('active')
        const mood=btn.dataset.mood
        $('mood-title').textContent=moodNames[mood]||'Pilihan Musik'
        this.loadMood(mood)
      })
    })
  },

  async loadMood(mood){
    const g=$('mood-grid')
    g.innerHTML=skCards(6)
    try {
      const ac=mkAC('mood')
      const res=await fetch(`/api/mood/${mood}`,{signal:ac.signal})
      const data=await res.json()
      this.moodSongs=data.results||[]
      if(this.moodSongs.length){
        this._setHero(this.moodSongs[0])
        buildCards(this.moodSongs.slice(0,9),g)
      } else g.innerHTML=''
    } catch(e){
      if(e.name!=='AbortError'){g.innerHTML='';Toast.show('Gagal memuat mood','warning')}
    }
  },

  _setHero(s){
    $('hero-title').textContent=s.title||''
    $('hero-sub').textContent=s.artist||''
    $('hero-bg').style.backgroundImage=`url(${s.thumbnail})`
    $('hero-play').onclick=()=>PlayerCtrl.play(s,this.moodSongs)
    $('hero-queue').onclick=()=>{ PlayerCtrl.queue=[...this.moodSongs]; Toast.show(`${this.moodSongs.length} lagu ke antrean`,'info') }
  },

  async loadTrending(force=false){
    const g=$('trend-grid')
    if(!force) g.innerHTML=skCards(6)
    try {
      const res=await fetch('/api/trending'+(force?'?t='+Date.now():''))
      const data=await res.json()
      buildCards(data.results?.slice(0,9)||[],g)
    } catch{ if(!force) g.innerHTML='' }
  },

  async loadQuickPicks(){
    const g=$('qp-grid')
    try {
      const res=await fetch('/api/mood/pop')
      const data=await res.json()
      const songs=(data.results||[]).slice(0,6)
      const frag=document.createDocumentFragment()
      songs.forEach(s=>{
        const d=document.createElement('div')
        d.className='qp-card'+(PlayerCtrl.current?.id===s.id?' is-playing':'')
        d.dataset.id=s.id
        d.innerHTML=`<img class="qp-thumb" data-src="${s.thumbnail||PH}" alt="" loading="lazy"/><div class="qp-info"><p class="qp-name">${esc(s.title)}</p><p class="qp-artist">${esc(s.artist||'')}</p></div>`
        Lazy.obs(d.querySelector('.qp-thumb'))
        d.addEventListener('click',()=>PlayerCtrl.play(s,songs))
        frag.appendChild(d)
      })
      g.innerHTML=''; g.appendChild(frag)
    } catch{}
  },

  refreshRecently(){
    const hist=Store.get('history',[]).slice(0,10)
    const sec=$('rec-sec'), scrl=$('rec-scroll')
    if(!hist.length||!sec||!scrl){if(sec)sec.style.display='none';return}
    sec.style.display='block'
    const frag=document.createDocumentFragment()
    hist.forEach(s=>{
      const d=document.createElement('div')
      d.style.cssText='flex-shrink:0;width:90px;scroll-snap-align:start;cursor:pointer'
      d.innerHTML=`<div style="border-radius:12px;overflow:hidden;margin-bottom:6px;aspect-ratio:1;background:var(--bg3)"><img data-src="${s.thumbnail||PH}" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity .3s"/></div><p style="font-size:.69rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.title)}</p><p style="font-size:.62rem;color:var(--t3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.artist||'')}</p>`
      Lazy.obs(d.querySelector('img'))
      d.addEventListener('click',()=>PlayerCtrl.play(s,hist))
      frag.appendChild(d)
    })
    scrl.innerHTML=''; scrl.appendChild(frag)
  }
}

/* ═══════════════════════════════════════════════
   SEARCH CONTROLLER — debounce + infinite scroll
   ═══════════════════════════════════════════════ */
const SearchCtrl = {
  _all:[], _rendered:0, _BATCH:10,
  _cache:new Map(), _io:null,

  init(){
    const inp=$('search-input'), clr=$('search-clear')
    const doSearch=debounce(q=>this.search(q),400)

    inp.addEventListener('input',()=>{
      const q=inp.value.trim()
      clr.classList.toggle('hidden',!q)
      if(!q){this._setState('empty');mkAC('search').abort();return}
      this._setState('loading'); this._showSkel()
      doSearch(q)
    })

    inp.addEventListener('keydown',e=>{
      if(e.key==='Enter'){const q=inp.value.trim();if(q) this.search(q)}
    })

    clr.addEventListener('click',()=>{
      inp.value=''; clr.classList.add('hidden')
      this._setState('empty'); mkAC('search').abort(); inp.focus()
    })

    // Infinite scroll
    this._io=new IntersectionObserver(entries=>{
      if(entries[0].isIntersecting) this._renderMore()
    },{rootMargin:'80px'})
    this._io.observe($('s-sentinel'))

    document.querySelectorAll('#pg-search .chips .chip').forEach(b=>{
      b.addEventListener('click',()=>{
        document.querySelectorAll('#pg-search .chips .chip').forEach(x=>x.classList.remove('active'))
        b.classList.add('active')
      })
    })
  },

  async search(q){
    if(!q) return
    if(this._cache.has(q)){this._setResults(this._cache.get(q));return}
    this._setState('loading'); this._showSkel()
    try {
      const ac=mkAC('search')
      const res=await fetch(`/api/search?q=${encodeURIComponent(q)}`,{signal:ac.signal})
      const data=await res.json()
      const results=data.results||[]
      if(this._cache.size>25) this._cache.delete(this._cache.keys().next().value)
      this._cache.set(q,results)
      this._setResults(results)
    } catch(e){
      if(e.name==='AbortError') return
      Toast.show('Pencarian gagal','error'); this._setState('empty')
    }
  },

  _setResults(results){
    this._all=results; this._rendered=0
    const g=$('s-grid'); g.innerHTML=''
    if(!results.length){this._setState('noresult');return}
    this._setState('results')
    this._renderMore()
  },

  _renderMore(){
    const batch=this._all.slice(this._rendered,this._rendered+this._BATCH)
    if(!batch.length) return
    const g=$('s-grid')
    if(this._rendered===0) buildCards(batch,g,(i)=>PlayerCtrl.play(batch[i],this._all))
    else appendCards(batch,g,this._rendered,this._all)
    this._rendered+=batch.length
  },

  _showSkel(){
    const sl=$('s-loading')
    sl.innerHTML=Array(5).fill(0).map(()=>`<div class="sk-song"><div class="sk-st shim"></div><div class="sk-si"><div class="sk-t1 shim"></div><div class="sk-t2 shim"></div></div></div>`).join('')
  },

  _setState(s){
    ['s-empty','s-loading','s-results','s-noresult'].forEach(id=>$(id)?.classList.add('hidden'))
    const map={empty:'s-empty',loading:'s-loading',results:'s-results',noresult:'s-noresult'}
    $(map[s])?.classList.remove('hidden')
  }
}

/* ═══════════════════════════════════════════════
   LIBRARY CONTROLLER
   ═══════════════════════════════════════════════ */
const LibCtrl = {
  init(){
    document.querySelectorAll('.ltab').forEach(b=>{
      b.addEventListener('click',()=>{
        document.querySelectorAll('.ltab').forEach(x=>x.classList.remove('active'))
        document.querySelectorAll('.ltab-panel').forEach(p=>p.classList.remove('active'))
        b.classList.add('active')
        document.getElementById('lt-'+b.dataset.tab)?.classList.add('active')
      })
    })
    $('lsp-liked')?.addEventListener('click',()=>{this._openTab('songs');this._renderSongs()})
    $('lsp-history')?.addEventListener('click',()=>{
      const h=Store.get('history',[]); if(!h.length){Toast.show('Belum ada riwayat','info');return}
      PlayerCtrl.play(h[0],h); Toast.show(`${h.length} lagu dari riwayat`,'success')
    })
    $('lsp-top50')?.addEventListener('click',()=>{
      const h=Store.get('history',[]); if(!h.length){Toast.show('Belum ada data','warning');return}
      PlayerCtrl.play(h[0],h.slice(0,50))
    })
    $('btn-new-pl')?.addEventListener('click',()=>{
      Modal.input('Nama Playlist Baru','',name=>{
        if(!name.trim()) return
        const pl=Store.get('playlists',[]); pl.unshift({id:Date.now()+'',name:name.trim(),songs:[],created:Date.now()})
        Store.set('playlists',pl); Toast.show('Playlist dibuat!','success'); this.renderPlaylists()
      })
    })
    this.render()
  },

  render(){this.updateCounts();this.renderPlaylists();this._renderSongs()},

  updateCounts(){
    const lc=$('liked-cnt'); if(lc) lc.textContent=Store.get('liked',[]).length+' lagu'
    const hc=$('hist-cnt');  if(hc) hc.textContent=Store.get('history',[]).length+' lagu'
  },

  renderPlaylists(){
    const pl=Store.get('playlists',[]), con=$('pl-list')
    if(!pl.length){con.innerHTML='';return}
    const frag=document.createDocumentFragment()
    pl.forEach(p=>{
      const d=document.createElement('div'); d.className='pl-item'; d.dataset.pid=p.id
      d.innerHTML=`<div class="pl-thumb"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div><div><p class="pl-name">${esc(p.name)}</p><p class="pl-cnt">${p.songs.length} lagu</p></div><button class="pl-more">${MORE_IC}</button>`
      d.addEventListener('click',e=>{
        if(e.target.closest('.pl-more')) return
        const pls=Store.get('playlists',[]),found=pls.find(x=>x.id===p.id)
        if(found?.songs.length) PlayerCtrl.play(found.songs[0],found.songs)
        else Toast.show('Playlist kosong','warning')
      })
      frag.appendChild(d)
    })
    con.innerHTML=''; con.appendChild(frag)
  },

  _renderSongs(){
    const liked=Store.get('liked',[]),el=$('lib-songs'),em=$('lib-songs-empty')
    if(!liked.length){el.innerHTML='';em?.classList.remove('hidden');return}
    em?.classList.add('hidden'); buildSongList(liked,el)
  },

  _openTab(tab){
    document.querySelectorAll('.ltab').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab))
    document.querySelectorAll('.ltab-panel').forEach(p=>p.classList.toggle('active',p.id==='lt-'+tab))
  }
}

/* ═══════════════════════════════════════════════
   MODAL
   ═══════════════════════════════════════════════ */
const Modal = {
  playlist(song){
    const m=$('pl-modal'),list=$('pl-modal-list')
    const pl=Store.get('playlists',[])
    const frag=document.createDocumentFragment()
    if(!pl.length){list.innerHTML='<p style="padding:10px 0;color:var(--t3);font-size:.82rem">Belum ada playlist</p>'}
    else{
      list.innerHTML=''
      pl.forEach(p=>{
        const d=document.createElement('div');d.className='modal-li';d.dataset.pid=p.id
        d.innerHTML=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg><span>${esc(p.name)}</span>`
        d.onclick=()=>{
          m.classList.add('hidden')
          const pls=Store.get('playlists',[]),found=pls.find(x=>x.id===p.id)
          if(!found) return
          if(!found.songs.find(s=>s.id===song.id)){found.songs.push(song);Store.set('playlists',pls);Toast.show(`Ditambahkan ke ${found.name}`,'success')}
          else Toast.show('Sudah ada di playlist','warning')
          LibCtrl.renderPlaylists()
        }
        frag.appendChild(d)
      })
      list.appendChild(frag)
    }
    m.classList.remove('hidden')
    $('pl-modal-new').onclick=()=>{
      m.classList.add('hidden')
      this.input('Nama Playlist Baru','',name=>{
        if(!name.trim()) return
        const pls=Store.get('playlists',[]),np={id:Date.now()+'',name:name.trim(),songs:[song],created:Date.now()}
        pls.unshift(np);Store.set('playlists',pls);Toast.show(`Playlist "${np.name}" dibuat!`,'success');LibCtrl.renderPlaylists()
      })
    }
    $('pl-modal-cancel').onclick=()=>m.classList.add('hidden')
    m.onclick=e=>{if(e.target===m)m.classList.add('hidden')}
  },

  input(title,def,cb){
    const m=$('input-modal'),f=$('input-modal-field')
    $('input-modal-title').textContent=title; f.value=def||''; m.classList.remove('hidden')
    setTimeout(()=>f.focus(),150)
    const ok=()=>{m.classList.add('hidden');cb(f.value)}
    const no=()=>m.classList.add('hidden')
    $('input-ok').onclick=ok; $('input-cancel').onclick=no
    f.onkeydown=e=>{if(e.key==='Enter')ok()}
    m.onclick=e=>{if(e.target===m)no()}
  }
}

/* ═══════════════════════════════════════════════
   PWA
   ═══════════════════════════════════════════════ */
let _dP=null
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();_dP=e})
$('pwa-install')?.addEventListener('click',async()=>{
  if(!_dP){Toast.show('Gunakan menu browser untuk install','info');return}
  _dP.prompt()
  const{outcome}=await _dP.userChoice
  if(outcome==='accepted') Toast.show('Aplikasi diinstall!','success')
  _dP=null
})

/* ═══════════════════════════════════════════════
   HEADER BUTTONS
   ═══════════════════════════════════════════════ */
$('btn-history')?.addEventListener('click',()=>{
  const h=Store.get('history',[]); if(!h.length){Toast.show('Belum ada riwayat','info');return}
  PlayerCtrl.play(h[0],h)
})
$('btn-profile')?.addEventListener('click',()=>Router.go('developer'))

/* ═══════════════════════════════════════════════
   SERVICE WORKER
   ═══════════════════════════════════════════════ */
if('serviceWorker' in navigator){
  window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}),{passive:true})
}

/* ═══════════════════════════════════════════════
   BOOT
   ═══════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded',()=>{
  Router.init()
  PlayerCtrl.init()
  SearchCtrl.init()
  LibCtrl.init()
  DetailSheet.init()
  HomeCtrl.init()
  document.getElementById('pg-home')?.classList.add('active')
},{once:true})
