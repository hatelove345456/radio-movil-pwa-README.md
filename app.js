/* Radio Móvil PWA — misma interfaz de la maqueta, comunicación directa
   entre móviles con WebRTC (sin internet, sin servidor). */
'use strict';
const $ = id => document.getElementById(id);

const state = {
  id: localStorage.getItem('rm_id') || ('m' + Math.random().toString(36).slice(2, 10)),
  name: localStorage.getItem('rm_name') || ('Móvil ' + Math.random().toString(36).slice(2, 5).toUpperCase()),
  channel: (localStorage.getItem('rm_channel') || 'channel-1').toLowerCase(),
  peers: {}, messages: [], myPos: null, connected: false
};
localStorage.setItem('rm_id', state.id);

let pc = null, dc = null, mic = null, scanStream = null, raf = 0, pairMode = null, deferredPrompt = null;
const remoteAudio = $('remoteAudio');
remoteAudio.autoplay = true;
remoteAudio.playsInline = true;

/* ---------- utilidades ---------- */
function cleanChannel(v) {
  return (v || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24) || 'channel-1';
}
function pack(o) { return 'RMO1.' + LZString.compressToEncodedURIComponent(JSON.stringify(o)); }
function unpack(s) {
  if (!s || !s.startsWith('RMO1.')) throw new Error('Código no reconocido');
  return JSON.parse(LZString.decompressFromEncodedURIComponent(s.slice(5)));
}
function fmtTime(ts) { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
function setStatus(text, ok) {
  $('netStatus').innerHTML = '<b style="color:' + (ok ? 'var(--ok)' : 'var(--muted)') + '">●</b> ' + text;
}
function tab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === name));
  if (name === 'map') drawRadar();
}
function saveChannel() {
  state.channel = cleanChannel($('channelInput').value);
  localStorage.setItem('rm_channel', state.channel);
  $('channelLabel').textContent = 'Canal: ' + state.channel.toUpperCase();
  $('channelBig').textContent = state.channel.toUpperCase();
}

/* ---------- WebRTC ---------- */
function waitIce(p) {
  return new Promise(resolve => {
    if (p.iceGatheringState === 'complete') return resolve();
    const done = () => {
      if (p.iceGatheringState === 'complete') {
        p.removeEventListener('icegatheringstatechange', done);
        clearTimeout(timer); resolve();
      }
    };
    const timer = setTimeout(() => { p.removeEventListener('icegatheringstatechange', done); resolve(); }, 8000);
    p.addEventListener('icegatheringstatechange', done);
  });
}
async function ensureMic() {
  if (mic) return mic;
  mic = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true }, video: false
  });
  mic.getAudioTracks().forEach(t => { t.enabled = false; });
  return mic;
}
function newPC() {
  const p = new RTCPeerConnection({ iceServers: [] });
  p.ontrack = e => {
    remoteAudio.srcObject = e.streams[0];
    remoteAudio.play().catch(() => {});
  };
  return p;
}
function bindDC(channel) {
  dc = channel;
  dc.onopen = () => {
    state.connected = true;
    setStatus('Conectado · sin internet', true);
    send({ t: 'hello', name: state.name, channel: state.channel });
    renderPeers();
    if ($('pairDlg').open) $('pairDlg').close();
  };
  dc.onclose = () => {
    state.connected = false;
    setStatus('Desconectado', false);
  };
  dc.onmessage = e => {
    let m; try { m = JSON.parse(e.data); } catch (_) { return; }
    if (m.t === 'hello') {
      state.peers[m.name] = { name: m.name, channel: m.channel, pos: null, talking: false };
      if (m.channel && m.channel !== state.channel) $('appStatus').textContent = '⚠ El otro móvil usa otro canal (' + m.channel + ').';
      renderPeers();
    } else if (m.t === 'msg') {
      addMessage(m.name || '?', m.text, m.ts || Date.now());
    } else if (m.t === 'pos') {
      const p = state.peers[m.name] || { name: m.name, channel: state.channel, talking: false };
      p.pos = { lat: m.lat, lon: m.lon, ts: m.ts }; state.peers[m.name] = p;
      renderPeers(); drawRadar();
    } else if (m.t === 'ptt') {
      const p = state.peers[m.name]; if (p) { p.talking = !!m.on; renderPeers(); }
      $('voiceNote').textContent = m.on ? '🔊 ' + m.name + ' está hablando…' : '';
    }
  };
}
function send(o) { if (dc && dc.readyState === 'open') dc.send(JSON.stringify(o)); }

async function createGroup() {
  try {
    const stream = await ensureMic();
    pc = newPC();
    dc = pc.createDataChannel('radio');
    bindDC(dc);
    stream.getAudioTracks().forEach(t => pc.addTrack(t, stream));
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitIce(pc);
    showQR(pack({ t: 'offer', sdp: pc.localDescription.sdp, name: state.name, channel: state.channel }), 'waitAnswer');
  } catch (e) { $('appStatus').textContent = 'No se pudo crear el grupo: ' + e.message; }
}
async function joinGroup(payload) {
  const data = unpack(payload);
  if (data.t !== 'offer') throw new Error('Escanea el código de "Crear grupo"');
  try {
    const stream = await ensureMic();
    pc = newPC();
    pc.ondatachannel = e => bindDC(e.channel);
    stream.getAudioTracks().forEach(t => pc.addTrack(t, stream));
    await pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await waitIce(pc);
    showQR(pack({ t: 'answer', sdp: pc.localDescription.sdp, name: state.name, channel: state.channel }), 'answer');
  } catch (e) { throw new Error('No se pudo unir: ' + e.message); }
}

/* ---------- QR / escáner ---------- */
function showQR(text, mode) {
  pairMode = mode;
  $('pairTitle').textContent = mode === 'waitAnswer' ? '1/2 · Muestra este código' : '2/2 · Muestra este código';
  const qr = qrcode(0, 'L'); qr.addData(text); qr.make();
  $('qr').src = qr.createDataURL(5, 2);
  $('qr').style.display = 'block';
  $('scanVideo').style.display = 'none';
  $('pairErr').textContent = '';
  $('pairScan').textContent = mode === 'waitAnswer' ? 'Escanear respuesta' : 'Cerrar';
  $('pairDlg').showModal();
}
function openScanner(mode) {
  pairMode = mode;
  $('pairTitle').textContent = 'Escanea el código del otro móvil';
  $('qr').style.display = 'none';
  $('pairErr').textContent = '';
  $('pairScan').textContent = 'Reintentar';
  $('pairDlg').showModal();
  startScan();
}
async function startScan() {
  $('pairErr').textContent = '';
  $('qr').style.display = 'none';
  $('scanVideo').style.display = 'block';
  try {
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    const v = $('scanVideo'); v.srcObject = scanStream; v.playsInline = true; await v.play();
    const c = $('scanCanvas'); const ctx = c.getContext('2d', { willReadFrequently: true });
    const loop = () => {
      if (v.readyState === v.HAVE_ENOUGH_DATA) {
        c.width = v.videoWidth; c.height = v.videoHeight;
        ctx.drawImage(v, 0, 0, c.width, c.height);
        const img = ctx.getImageData(0, 0, c.width, c.height);
        const code = typeof jsQR === 'function' ? jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' }) : null;
        if (code) { stopScan(); onScanned(code.data); return; }
      }
      raf = requestAnimationFrame(loop);
    };
    loop();
  } catch (e) {
    stopScan(); $('pairErr').textContent = 'No se pudo abrir la cámara: ' + e.message;
  }
}
function stopScan() {
  cancelAnimationFrame(raf);
  if (scanStream) scanStream.getTracks().forEach(t => t.stop());
  scanStream = null; $('scanVideo').style.display = 'none';
}
async function onScanned(text) {
  try {
    if (pairMode === 'waitAnswer') {
      const data = unpack(text);
      if (data.t !== 'answer') throw new Error('Escanea la respuesta del otro móvil');
      await pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
      $('pairErr').textContent = 'Conectando…';
    } else if (pairMode === 'join') {
      await joinGroup(text);
    } else if (pairMode === 'answer') {
      $('pairDlg').close();
    }
  } catch (e) { $('pairErr').textContent = e.message; }
}

/* ---------- interfaz ---------- */
function addMessage(who, text, ts) {
  state.messages.push({ who, text, ts });
  const box = $('messages');
  const el = document.createElement('div'); el.className = 'msg';
  el.innerHTML = '<div class="who"></div><div class="body"></div><div class="time"></div>';
  el.querySelector('.who').textContent = who;
  el.querySelector('.body').textContent = text;
  el.querySelector('.time').textContent = fmtTime(ts);
  box.appendChild(el); box.scrollTop = box.scrollHeight;
}
function renderPeers() {
  const entries = Object.values(state.peers);
  $('peerCount').textContent = entries.length + (entries.length === 1 ? ' cercano' : ' cercanos');
  const peers = $('peers'), near = $('nearby');
  peers.innerHTML = ''; near.innerHTML = '';
  if (!entries.length) {
    peers.innerHTML = '<p class="hint">Aún no hay nadie. Abre la app en otro móvil con el mismo canal y cerca.</p>';
    near.innerHTML = '<p class="hint">Sin posiciones compartidas todavía.</p>';
    return;
  }
  entries.forEach(p => {
    const el = document.createElement('div'); el.className = 'peer';
    let meta = 'en el canal';
    if (p.pos && state.myPos) meta = Math.round(distance(state.myPos, p.pos)) + ' m · ' + compass(state.myPos, p.pos);
    if (p.talking) meta = '🔊 hablando';
    el.innerHTML = '<div class="avatar"></div><div><div class="name"></div><div class="meta"></div></div><div class="spacer"></div><div class="sig">●●●</div>';
    el.querySelector('.avatar').textContent = p.name.slice(0, 1).toUpperCase();
    el.querySelector('.name').textContent = p.name;
    el.querySelector('.meta').textContent = meta;
    peers.appendChild(el);
    const row = document.createElement('div'); row.className = 'peer';
    row.innerHTML = '<div class="name"></div><div class="meta"></div>';
    row.querySelector('.name').textContent = p.name;
    row.querySelector('.meta').textContent = meta;
    near.appendChild(row);
  });
}
function distance(a, b) {
  const R = 6371000, dLat = (b.lat - a.lat) * Math.PI / 180, dLon = (b.lon - a.lon) * Math.PI / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
function compass(a, b) {
  const y = Math.sin((b.lon - a.lon) * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180);
  const x = Math.cos(a.lat * Math.PI / 180) * Math.sin(b.lat * Math.PI / 180) - Math.sin(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.cos((b.lon - a.lon) * Math.PI / 180);
  const d = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  return ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'][Math.round(d / 45) % 8];
}
function drawRadar() {
  const c = $('radar'), x = c.getContext('2d'), w = c.width, h = c.height, cx = w / 2, cy = h / 2;
  x.clearRect(0, 0, w, h);
  x.strokeStyle = '#2A3543'; x.lineWidth = 2;
  [0.25, 0.5, 0.75, 1].forEach(r => { x.beginPath(); x.arc(cx, cy, r * (h / 2 - 20), 0, 7); x.stroke(); });
  x.beginPath(); x.moveTo(cx, 20); x.lineTo(cx, h - 20); x.moveTo(20, cy); x.lineTo(w - 20, cy); x.stroke();
  x.fillStyle = '#4FC3F7'; x.beginPath(); x.arc(cx, cy, 8, 0, 7); x.fill();
  Object.values(state.peers).forEach((p, i) => {
    if (!p.pos || !state.myPos) return;
    const d = distance(state.myPos, p.pos), max = 200;
    const a = (Math.atan2(p.pos.lon - state.myPos.lon, p.pos.lat - state.myPos.lat));
    const r = Math.min(d / max, 1) * (h / 2 - 24);
    x.fillStyle = '#D9FF5C'; x.beginPath();
    x.arc(cx + Math.sin(a) * r, cy - Math.cos(a) * r, 7, 0, 7); x.fill();
    x.fillStyle = '#8D9AAC'; x.font = '18px sans-serif';
    x.fillText(p.name, cx + Math.sin(a) * r + 10, cy - Math.cos(a) * r + 6);
  });
}

/* ---------- eventos ---------- */
document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => tab(t.dataset.tab)));
$('channelCard').addEventListener('click', () => { $('channelInput').value = state.channel; $('channelDlg').showModal(); });
$('channelSave').addEventListener('click', () => { saveChannel(); $('channelDlg').close(); });
$('channelCancel').addEventListener('click', () => $('channelDlg').close());
$('menuBtn').addEventListener('click', () => $('menuDlg').showModal());
$('menuClose').addEventListener('click', () => $('menuDlg').close());
$('menuChannel').addEventListener('click', () => { $('menuDlg').close(); $('channelInput').value = state.channel; $('channelDlg').showModal(); });
$('menuHelp').addEventListener('click', () => { $('menuDlg').close(); $('helpDlg').showModal(); });
$('helpClose').addEventListener('click', () => $('helpDlg').close());
$('menuInstall').addEventListener('click', () => {
  $('menuDlg').close();
  if (deferredPrompt) { deferredPrompt.prompt(); deferredPrompt = null; }
  else alert('En iPhone: botón Compartir → "Añadir a la pantalla de inicio".\nEn Android: menú del navegador → "Instalar aplicación".');
});
$('createBtn').addEventListener('click', createGroup);
$('joinBtn').addEventListener('click', () => openScanner('join'));
$('pairScan').addEventListener('click', () => {
  if (pairMode === 'answer') $('pairDlg').close();
  else startScan();
});
$('pairCancel').addEventListener('click', () => { stopScan(); $('pairDlg').close(); });
$('writeBtn').addEventListener('click', () => { tab('msgs'); $('draft').focus(); });
$('sendBtn').addEventListener('click', sendDraft);
$('draft').addEventListener('keydown', e => { if (e.key === 'Enter') sendDraft(); });
function sendDraft() {
  const t = $('draft').value.trim(); if (!t) return;
  send({ t: 'msg', name: state.name, text: t, ts: Date.now() });
  addMessage(state.name, t, Date.now()); $('draft').value = '';
}
$('posBtn').addEventListener('click', () => {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(pos => {
    state.myPos = { lat: pos.coords.latitude, lon: pos.coords.longitude };
    send({ t: 'pos', name: state.name, lat: state.myPos.lat, lon: state.myPos.lon, ts: Date.now() });
    renderPeers(); drawRadar();
  }, () => { $('appStatus').textContent = 'No se pudo obtener la ubicación.'; }, { enableHighAccuracy: true, timeout: 8000 });
});
const ptt = $('ptt');
ptt.addEventListener('pointerdown', e => {
  e.preventDefault(); ptt.setPointerCapture(e.pointerId); ptt.classList.add('down');
  remoteAudio.play().catch(() => {});
  if (mic) mic.getAudioTracks().forEach(t => { t.enabled = true; });
  send({ t: 'ptt', on: true, name: state.name });
});
['pointerup', 'pointercancel', 'lostpointercapture'].forEach(ev => ptt.addEventListener(ev, () => {
  ptt.classList.remove('down');
  if (mic) mic.getAudioTracks().forEach(t => { t.enabled = false; });
  send({ t: 'ptt', on: false, name: state.name });
}));
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; });

/* ---------- arranque ---------- */
saveChannel(); renderPeers(); setStatus('Sin internet · listo', false);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
