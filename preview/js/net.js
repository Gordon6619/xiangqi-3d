// 線上對戰 — 以 WebRTC 點對點連線（PeerJS 負責牽線），不需要遊戲伺服器。
const PREFIX = 'xq3d-room-';

export class NetPlay {
  constructor(handlers) {
    this.h = handlers; this.peer = null; this.conn = null; this.role = null; this.code = null;
  }
  get connected() { return !!(this.conn && this.conn.open); }

  _peer(id) {
    if (!window.Peer) throw new Error('PeerJS 未載入');
    // 可改用自架的 PeerJS 牽線伺服器：?peerHost=主機&peerPort=9000&peerPath=/xq
    const q = new URLSearchParams(location.search), opts = { debug: 1 };
    if (q.get('peerHost')) Object.assign(opts, { host: q.get('peerHost'), port: +(q.get('peerPort') || 443), path: q.get('peerPath') || '/', secure: q.get('peerSecure') !== '0' });
    return new window.Peer(id, opts);
  }
  static randomCode() {
    const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = ''; for (let i = 0; i < 6; i++) s += a[Math.floor(Math.random() * a.length)];
    return s;
  }

  host() {
    this.close();
    this.role = 'host'; this.code = NetPlay.randomCode();
    return new Promise((res, rej) => {
      const p = this.peer = this._peer(PREFIX + this.code);
      p.on('open', () => res(this.code));
      p.on('error', e => { if (e.type === 'unavailable-id') { this.host().then(res, rej); } else { this.h.onError?.(e); rej(e); } });
      p.on('connection', c => {
        if (this.connected) { c.on('open', () => { c.send({ t: 'full' }); setTimeout(() => c.close(), 300); }); return; }
        this._bind(c);
      });
      p.on('disconnected', () => { try { p.reconnect(); } catch { /* 忽略 */ } });
    });
  }

  join(code) {
    this.close();
    this.role = 'guest'; this.code = code.toUpperCase().trim();
    return new Promise((res, rej) => {
      const p = this.peer = this._peer();
      p.on('open', () => {
        const c = p.connect(PREFIX + this.code, { reliable: true });
        const timer = setTimeout(() => rej(new Error('連線逾時，請確認房間代碼')), 15000);
        c.on('open', () => { clearTimeout(timer); res(); });
        this._bind(c);
      });
      p.on('error', e => { this.h.onError?.(e); rej(e); });
    });
  }

  _bind(c) {
    this.conn = c;
    c.on('open', () => this.h.onOpen?.(this.role));
    c.on('data', d => this.h.onData?.(d));
    c.on('close', () => { this.h.onClose?.(); this.conn = null; });
    c.on('error', e => this.h.onError?.(e));
  }
  send(msg) { if (this.connected) this.conn.send(msg); }
  close() {
    try { this.conn?.close(); } catch { /* 忽略 */ }
    try { this.peer?.destroy(); } catch { /* 忽略 */ }
    this.conn = null; this.peer = null; this.role = null;
  }
}
