// Finger/mouse signature pad. Usage: const pad = signaturePad(containerEl, existingDataUrl)
// pad.isEmpty(), pad.toDataURL(), pad.clear()
export function signaturePad(host, existing = null) {
  host.classList.add('sigpad');
  host.innerHTML = `<canvas></canvas><button type="button" class="sig-clear">Clear</button><span class="sig-hint">Sign here</span>`;
  const canvas = host.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  let drawing = false, dirty = false, last = null, existingUrl = existing;

  function size() {
    const r = host.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const prev = dirty ? canvas.toDataURL() : existingUrl;
    canvas.width = Math.max(300, r.width) * ratio;
    canvas.height = 170 * ratio;
    canvas.style.height = '170px';
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#0d1b12';
    if (prev) drawImage(prev);
  }
  function drawImage(url) {
    const img = new Image();
    img.onload = () => {
      const w = canvas.width / (window.devicePixelRatio || 1), h = 170;
      const sc = Math.min(w / img.width, h / img.height);
      ctx.drawImage(img, (w - img.width * sc) / 2, (h - img.height * sc) / 2, img.width * sc, img.height * sc);
      host.classList.add('signed');
    };
    img.src = url;
  }
  const pos = e => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  canvas.addEventListener('pointerdown', e => { drawing = true; last = pos(e); canvas.setPointerCapture(e.pointerId); e.preventDefault(); });
  canvas.addEventListener('pointermove', e => {
    if (!drawing) return;
    const p = pos(e);
    ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    last = p; dirty = true; existingUrl = null; host.classList.add('signed');
  });
  const end = () => { drawing = false; };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
  host.querySelector('.sig-clear').onclick = () => { ctx.clearRect(0, 0, canvas.width, canvas.height); dirty = false; existingUrl = null; host.classList.remove('signed'); };
  requestAnimationFrame(size);
  window.addEventListener('resize', () => { if (host.isConnected) size(); });

  return {
    isEmpty: () => !dirty && !existingUrl,
    toDataURL: () => dirty ? trimmed() : existingUrl,
    set: url => { existingUrl = url; dirty = false; ctx.clearRect(0, 0, canvas.width, canvas.height); if (url) drawImage(url); else host.classList.remove('signed'); }
  };

  // Crop to the ink so signatures sit nicely on documents
  function trimmed() {
    const w = canvas.width, h = canvas.height;
    const data = ctx.getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = 0, y1 = 0;
    for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
      if (data[(y * w + x) * 4 + 3] > 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (x1 <= x0) return canvas.toDataURL('image/png');
    const pad = 10;
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w, x1 + pad); y1 = Math.min(h, y1 + pad);
    const c = document.createElement('canvas');
    c.width = x1 - x0; c.height = y1 - y0;
    c.getContext('2d').drawImage(canvas, x0, y0, c.width, c.height, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  }
}
