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
let initiatedByMe = false, reconnecting = false, pttHeld = false, pttWaiting = false, transmitting = false;
let pairPayload = null;
const remoteAudio = $('remoteAudio');
remoteAudio.autoplay = true;
remoteAudio.playsInline = true;

/* ---------- utilidades ---------- */
function cleanChannel(v) {
  return (v || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24) || 'channel-1';
}
function pack(o) { return 'RMO1.' + LZString.compressToEncodedURIComponent(JSON.stringify(o)); }
/* SDP compacto: el SDP completo son ~1800 caracteres y produce un QR de 177 módulos,
   ilegible de móvil a móvil. Guardamos solo los campos necesarios y lo reconstruimos. */
function hexToB64(h) {
  let s = ''; for (let i = 0; i < h.length; i += 2) s += String.fromCharCode(parseInt(h.substr(i, 2), 16));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64ToHex(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  s += '==='.slice(0, (4 - s.length % 4) % 4);
  const bin = atob(s); let h = '';
  for (const ch of bin) h += ('0' + ch.charCodeAt(0).toString(16)).slice(-2);
  return h;
}
function uuid(h) { return h.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'); }
function compactSDP(sdp) {
  const L = sdp.split(/\r\n|\n/);
  const get = p => (L.find(l => l.startsWith(p)) || '').slice(p.length);
  const fp = (L.find(l => l.startsWith('a=fingerprint:sha-256 ')) || '').slice(22).replace(/:/g, '');
  const msid = get('a=msid:').split(/\s+/);
  const ssrcLine = L.find(l => l.startsWith('a=ssrc:')) || '';
  const sections = []; let cur = null;
  L.forEach(l => {
    if (l.startsWith('m=')) { cur = { type: l.split(' ')[0], mid: '' }; sections.push(cur); }
    else if (cur && l.startsWith('a=mid:')) cur.mid = l.slice(6);
  });
  const cand = L.filter(l => l.startsWith('a=candidate:') && l.includes(' typ host ')).slice(0, 3).map(l => l.slice(12));
  return {
    v: 1, id: (get('o=').match(/^-\s+(\d+)/) || [])[1] || '1',
    u: get('a=ice-ufrag:'), p: get('a=ice-pwd:'), f: hexToB64(fp),
    a: (sections.find(s => s.type === 'm=audio') || {}).mid || '0',
    b: (sections.find(s => s.type === 'm=application') || {}).mid || '1',
    m: hexToB64((msid[0] || '').replace(/-/g, '')), t: hexToB64((msid[1] || '').replace(/-/g, '')),
    s: (ssrcLine.match(/^(\d+)/) || [])[1] || '1',
    c: (ssrcLine.match(/cname:(\S+)/) || [])[1] || 'rm', cand: cand
  };
}
function buildSDP(c, answer) {
  const f = b64ToHex(c.f).toUpperCase().match(/.{2}/g).join(':');
  const m = uuid(b64ToHex(c.m)), t = uuid(b64ToHex(c.t));
  const setup = answer ? 'active' : 'actpass';
  const base = [
    'a=ice-ufrag:' + c.u, 'a=ice-pwd:' + c.p, 'a=ice-options:trickle',
    'a=fingerprint:sha-256 ' + f, 'a=setup:' + setup
  ];
  const L = [
    'v=0', 'o=- ' + c.id + ' 2 IN IP4 127.0.0.1', 's=-', 't=0 0',
    'a=group:BUNDLE ' + c.a + ' ' + c.b, 'a=extmap-allow-mixed', 'a=msid-semantic: WMS ' + m,
    'm=audio 9 UDP/TLS/RTP/SAVPF 111', 'c=IN IP4 0.0.0.0', 'a=rtcp:9 IN IP4 0.0.0.0',
    ...base, 'a=mid:' + c.a, 'a=extmap:4 urn:ietf:params:rtp-hdrext:sdes:mid',
    'a=sendrecv', 'a=msid:' + m + ' ' + t, 'a=rtcp-mux',
    'a=rtpmap:111 opus/48000/2', 'a=fmtp:111 minptime=10;useinbandfec=1',
    'a=ssrc:' + c.s + ' cname:' + c.c, 'a=ssrc:' + c.s + ' msid:' + m + ' ' + t,
    ...(c.cand || []).map(x => 'a=candidate:' + x),
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0', ...base,
    'a=mid:' + c.b, 'a=sctp-port:5000', 'a=max-message-size:262144'
  ];
  return L.join('\r\n') + '\r\n';
}
function packCompact(o) { return 'RMO2.' + LZString.compressToEncodedURIComponent(JSON.stringify(o)); }
function unpack(s) {
  if (!s || !s.startsWith('RMO1.') && !s.startsWith('RMO2.')) throw new Error('Código no reconocido');
  const o = JSON.parse(LZString.decompressFromEncodedURIComponent(s.slice(5)));
  if (s.startsWith('RMO2.')) o.sdp = buildSDP(o.c, o.t === 'answer');
  return o;
}
function fmtTime(ts) { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
function urlFor(code, kind) {
  return location.origin + location.pathname + '?' + kind + '=' + encodeURIComponent(code);
}
function codeFromText(raw) {
  const s = (raw || '').trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      return u.searchParams.get('join') || u.searchParams.get('answer') || null;
    } catch (_) { return null; }
  }
  return s.startsWith('RMO1.') || s.startsWith('RMO2.') ? s : null;
}
function setStatus(text, ok) {
  $('netStatus').innerHTML = '<b style="color:' + (ok ? 'var(--ok)' : 'var(--muted)') + '">●</b> ' + text;
}
function updateNetworkInfo() {
  const hint = $('networkHint');
  if (!navigator.onLine) {
    hint.className = 'net-hint';
    hint.textContent = 'Sin red. Activa el hotspot de un móvil (botón 📶) y une a los dos a esa Wi‑Fi.';
    if (!state.connected) setStatus('Sin red · abre el hotspot', false);
    return;
  }
  const type = (navigator.connection && navigator.connection.type) || 'wifi';
  if (type === 'cellular') {
    hint.className = 'net-hint';
    hint.textContent = 'Estás con datos móviles. Para la versión sin internet, conecta los dos al mismo Wi‑Fi o hotspot.';
    if (!state.connected) setStatus('Datos móviles · cambia a Wi‑Fi local', false);
  } else {
    hint.className = 'net-hint ok';
    hint.textContent = 'Wi‑Fi local detectado. Evita el Wi‑Fi de invitados: puede aislar los móviles.';
    if (!state.connected) setStatus('Sin internet · red local lista', false);
  }
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
  p.addEventListener('iceconnectionstatechange', () => {
    const s = p.iceConnectionState;
    if (s === 'connected' || s === 'completed') {
      reconnecting = false;
      setStatus('Conectado · sin internet', true);
      $('networkHint').className = 'net-hint ok';
      $('networkHint').textContent = 'Conexión local activa. Evita cambiar de Wi‑Fi mientras habléis.';
    } else if ((s === 'disconnected' || s === 'failed') && state.connected) {
      setStatus('Reconectando…', false);
      $('networkHint').className = 'net-hint';
      $('networkHint').textContent = 'Se perdió la red local. Vuelve a conectar los dos móviles al mismo Wi‑Fi o reinicia el hotspot.';
      if (initiatedByMe && !reconnecting) renegotiate();
    }
  });
  return p;
}
async function renegotiate() {
  if (!pc || !dc || dc.readyState !== 'open' || reconnecting) return;
  reconnecting = true;
  try {
    const offer = await pc.createOffer({ iceRestart: true });
    await pc.setLocalDescription(offer);
    await waitIce(pc);
    send({ t: 'renegotiate', sdp: pc.localDescription.sdp });
  } catch (_) { reconnecting = false; }
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
    initiatedByMe = false;
    updateNetworkInfo();
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
      if (m.on) {
        $('voiceNote').textContent = '🔊 ' + m.name + ' está hablando…';
      } else {
        $('voiceNote').textContent = '';
        if (pttWaiting && pttHeld) startTalk();
      }
    } else if (m.t === 'renegotiate') {
      handleRenegotiate(m.sdp).catch(() => { reconnecting = false; });
    } else if (m.t === 'renegotiate-answer') {
      pc.setRemoteDescription({ type: 'answer', sdp: m.sdp })
        .then(() => { reconnecting = false; })
        .catch(() => { reconnecting = false; });
    }
  };
}
async function handleRenegotiate(sdp) {
  if (!pc) return;
  await pc.setRemoteDescription({ type: 'offer', sdp });
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await waitIce(pc);
  send({ t: 'renegotiate-answer', sdp: pc.localDescription.sdp });
}
function send(o) { if (dc && dc.readyState === 'open') dc.send(JSON.stringify(o)); }

async function createGroup() {
  try {
    const stream = await ensureMic();
    initiatedByMe = true;
    pc = newPC();
    dc = pc.createDataChannel('radio');
    bindDC(dc);
    stream.getAudioTracks().forEach(t => pc.addTrack(t, stream));
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitIce(pc);
    const code = packCompact({ t: 'offer', c: compactSDP(pc.localDescription.sdp), name: state.name, channel: state.channel });
    showPair('invite', code,
      '1) Pulsa «Compartir» y envía el enlace al otro móvil. Si no puedes compartir, muestra el código QR. ' +
      '2) Cuando te devuelvan la respuesta, pégala abajo (o escanea su QR).');
  } catch (e) { $('appStatus').textContent = 'No se pudo crear el grupo: ' + e.message; }
}
async function joinGroup(payload) {
  const data = unpack(payload);
  if (data.t !== 'offer') throw new Error('Escanea el código de "Crear grupo"');
  try {
    const stream = await ensureMic();
    initiatedByMe = false;
    pc = newPC();
    pc.ondatachannel = e => bindDC(e.channel);
    stream.getAudioTracks().forEach(t => pc.addTrack(t, stream));
    await pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await waitIce(pc);
    const code = packCompact({ t: 'answer', c: compactSDP(pc.localDescription.sdp), name: state.name, channel: state.channel });
    showPair('answer', code,
      'Pulsa «Compartir» y devuelve el enlace al móvil que te invitó. También puedes mostrarle el código QR. ' +
      'La conexión se hará sola.');
  } catch (e) { throw new Error('No se pudo unir: ' + e.message); }
}

/* ---------- emparejamiento: enlace compartible o QR ---------- */
function showPair(mode, code, help) {
  pairMode = mode;
  pairPayload = code || null;
  $('pairTitle').textContent =
    mode === 'invite' ? '1/2 · Invitación' :
    mode === 'answer' ? '2/2 · Respuesta' : 'Únete al grupo';
  $('pairHelp').textContent = help || '';
  $('pairErr').textContent = '';
  if (code) {
    try {
      const qr = qrcode(0, 'L'); qr.addData(code); qr.make();
      $('qr').src = qr.createDataURL(5, 2);
      $('qr').style.display = 'block';
    } catch (_) { $('qr').style.display = 'none'; }
    stopScan();
    $('pairShare').style.display = ''; $('pairCopy').style.display = '';
  } else {
    $('qr').style.display = 'none';
    $('pairShare').style.display = 'none'; $('pairCopy').style.display = 'none';
  }
  const pasteBox = $('pasteBox');
  if (mode === 'invite' || mode === 'join') {
    pasteBox.style.display = 'block';
    $('pasteLabel').textContent = mode === 'invite'
      ? 'Pega aquí la respuesta que te envíe el otro móvil:'
      : 'Pega aquí la invitación que te enviaron:';
    $('pairPaste').value = '';
  } else {
    pasteBox.style.display = 'none';
  }
  $('pairScan').textContent = mode === 'invite' ? 'Escanear respuesta'
    : mode === 'answer' ? 'Cerrar' : 'Escanear invitación';
  if (!$('pairDlg').open) $('pairDlg').showModal();
}
function openScanner(mode) {
  showPair(mode, null, mode === 'join'
    ? 'Escanea el código del móvil que creó el grupo, o pega su enlace abajo.'
    : 'Escanea la respuesta del otro móvil, o pégala abajo.');
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
    let frames = 0;
    const loop = () => {
      if (v.readyState === v.HAVE_ENOUGH_DATA) {
        c.width = v.videoWidth; c.height = v.videoHeight;
        ctx.drawImage(v, 0, 0, c.width, c.height);
        const img = ctx.getImageData(0, 0, c.width, c.height);
        const code = typeof jsQR === 'function' ? jsQR(img.data, img.width, img.height) : null;
        if (code) { stopScan(); onScanned(code.data); return; }
        if (++frames === 150) $('pairErr').textContent = 'Si no lo detecta, aleja un poco el móvil y que el código ocupe casi toda la pantalla.';
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
    if (pairMode === 'invite' || pairMode === 'waitAnswer') {
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
async function applyPasted() {
  const code = codeFromText($('pairPaste').value);
  if (!code) { $('pairErr').textContent = 'Pega un enlace de Radio Móvil válido.'; return; }
  stopScan();
  try {
    const data = unpack(code);
    if (pairMode === 'invite') {
      if (data.t !== 'answer') throw new Error('Ese enlace no es una respuesta');
      await pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
      $('pairErr').textContent = 'Conectando…';
    } else if (pairMode === 'join') {
      if (data.t !== 'offer') throw new Error('Ese enlace no es una invitación');
      await joinGroup(code);
    }
  } catch (e) { $('pairErr').textContent = e.message; }
}
async function sharePair() {
  if (!pairPayload) return;
  const url = urlFor(pairPayload, pairMode === 'invite' ? 'join' : 'answer');
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Radio Móvil', text: 'Únete a mi canal de Radio Móvil', url });
      return;
    } catch (e) { if (e.name === 'AbortError') return; }
  }
  await copyPair();
}
async function copyPair() {
  if (!pairPayload) return;
  const url = urlFor(pairPayload, pairMode === 'invite' ? 'join' : 'answer');
  try {
    await navigator.clipboard.writeText(url);
    $('pairErr').textContent = 'Enlace copiado. Pégalo en el otro móvil.';
  } catch (_) {
    $('pairErr').textContent = 'No se pudo copiar. Usa el botón «Compartir».';
  }
}
async function handleIncomingUrl() {
  const u = new URL(location.href);
  const join = u.searchParams.get('join'), answer = u.searchParams.get('answer');
  if (!join && !answer) return;
  history.replaceState(null, '', location.pathname);
  if (join) {
    try { await joinGroup(join); }
    catch (e) { $('appStatus').textContent = e.message; }
  } else if (answer) {
    if (!pc) {
      $('appStatus').textContent = 'Abre la app donde pulsaste «Crear grupo» y pega allí la respuesta.';
      return;
    }
    try {
      const data = unpack(answer);
      if (data.t !== 'answer') throw new Error('Enlace de respuesta no válido');
      await pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
      $('appStatus').textContent = 'Conectando…';
    } catch (e) { $('appStatus').textContent = e.message; }
  }
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

/* ---------- PTT con turno ---------- */
function startTalk() {
  if (!pttHeld) return;
  const other = Object.values(state.peers).find(p => p.talking);
  if (other) {
    pttWaiting = true;
    $('voiceNote').textContent = '⏳ Espera a que ' + other.name + ' termine…';
    return;
  }
  pttWaiting = false;
  if (!transmitting) {
    transmitting = true;
    if (mic) mic.getAudioTracks().forEach(t => { t.enabled = true; });
    send({ t: 'ptt', on: true, name: state.name });
  }
  $('voiceNote').textContent = '';
}
function stopTalk() {
  pttHeld = false;
  pttWaiting = false;
  if (transmitting) {
    transmitting = false;
    if (mic) mic.getAudioTracks().forEach(t => { t.enabled = false; });
    send({ t: 'ptt', on: false, name: state.name });
  }
  if (!Object.values(state.peers).some(p => p.talking)) $('voiceNote').textContent = '';
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
$('pasteGo').addEventListener('click', applyPasted);
$('pairPaste').addEventListener('keydown', e => { if (e.key === 'Enter') applyPasted(); });
$('pairShare').addEventListener('click', sharePair);
$('pairCopy').addEventListener('click', copyPair);
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
  pttHeld = true;
  startTalk();
});
['pointerup', 'pointercancel', 'lostpointercapture'].forEach(ev => ptt.addEventListener(ev, () => {
  ptt.classList.remove('down');
  stopTalk();
}));
$('hotspotBtn').addEventListener('click', () => $('hotspotDlg').showModal());
$('hotspotClose').addEventListener('click', () => $('hotspotDlg').close());
window.addEventListener('online', updateNetworkInfo);
window.addEventListener('offline', updateNetworkInfo);
if (navigator.connection && navigator.connection.addEventListener) {
  navigator.connection.addEventListener('change', updateNetworkInfo);
}
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredPrompt = e; });

/* ---------- arranque ---------- */
saveChannel(); renderPeers(); updateNetworkInfo();
handleIncomingUrl();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
