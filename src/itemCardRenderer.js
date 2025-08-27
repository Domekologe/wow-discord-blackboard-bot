// itemCardRenderer.js
import { createCanvas, loadImage } from "@napi-rs/canvas";
// import { createCanvas, loadImage } from "canvas";

const QUALITY_COLORS = {
  0: "#9d9d9d", // poor
  1: "#ffffff", // common
  2: "#1eff00", // uncommon
  3: "#0070dd", // rare
  4: "#a335ee", // epic
  5: "#ff8000", // legendary
  6: "#e6cc80", // artifact
  7: "#00ccff", // heirloom
};

function hex8ToCss(hex8) { // "|cffA335EE" -> "#A335EE"
  const m = String(hex8).match(/^#?([0-9a-fA-F]{8})$/);
  if (!m) return null;
  return "#" + m[1].slice(2); // drop alpha
}

function splitWowColorSegments(s) {
  const out = [];
  let curColor = null, buf = "";
  for (let i=0; i<s.length; ) {
    if (s[i]==="|" && s[i+1]==="c" && /[0-9a-fA-F]{8}/.test(s.slice(i+2,i+10))) {
      if (buf) { out.push({ text: buf, color: curColor }); buf=""; }
      curColor = hex8ToCss("#"+s.slice(i+2,i+10)) || curColor;
      i += 10; continue;
    }
    if (s[i]==="|" && s[i+1]==="r") {
      if (buf) { out.push({ text: buf, color: curColor }); buf=""; }
      curColor = null; i += 2; continue;
    }
    buf += s[i++];
  }
  if (buf) out.push({ text: buf, color: curColor });
  return out;
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w/2, h/2);
  ctx.beginPath();
  ctx.moveTo(x+rr, y);
  ctx.arcTo(x+w, y,   x+w, y+h, rr);
  ctx.arcTo(x+w, y+h, x,   y+h, rr);
  ctx.arcTo(x,   y+h, x,   y,   rr);
  ctx.arcTo(x,   y,   x+w, y,   rr);
  ctx.closePath();
}
function drawShadowBox(ctx, x, y, w, h, radius=12) {
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 6;
  roundRect(ctx, x, y, w, h, radius);
  ctx.fillStyle = "#0d1117";
  ctx.fill();
  ctx.restore();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  roundRect(ctx, x, y, w, h, radius);
  ctx.stroke();
}
function wrapText(ctx, text, maxWidth) {
  const words = (text || "").split(/\s+/);
  const lines = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? cur + " " + w : w;
    const t = ctx.measureText(test).width;
    if (t > maxWidth && cur) { lines.push(cur); cur = w; }
    else cur = test;
  }
  if (cur) lines.push(cur);
  return lines;
}
async function drawRoundedImage(ctx, img, x, y, size, radius=10, borderColor="#222") {
  ctx.save();
  roundRect(ctx, x, y, size, size, radius);
  ctx.clip();
  ctx.drawImage(img, x, y, size, size);
  ctx.restore();
  ctx.lineWidth = 2;
  ctx.strokeStyle = borderColor;
  roundRect(ctx, x, y, size, size, radius);
  ctx.stroke();
}

/**
 * renderItemCard
 * @param {string} title
 * @param {Array<{text:string,color?:string,italic?:boolean,icon?:string}>} tooltipModel
 * @param {{g?:number,s?:number,c?:number}|null} priceBuy
 * @param {{g?:number,s?:number,c?:number}|null} priceSell
 * @param {string|null} iconUrl
 * @param {number} quality 0..7
 * @returns {Buffer} PNG
 */
export async function renderItemCard({ title, tooltipModel, priceBuy, priceSell, iconUrl, quality=1 }) {
  // Layout
  const P = 20;
  const ICON = 96;
  const W = 680;
  const lineH = 24;
  const titleSize = 28;
  const textSize = 18;

  const estLines = (tooltipModel?.length ?? 0)
    + (priceBuy ? 1 : 0)
    + (priceSell ? 1 : 0);
  const H = Math.max(ICON + P*2, P + titleSize + 10 + estLines * lineH + P);

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  drawShadowBox(ctx, 0, 0, W, H, 14);

  // Icon
  let icon = null;
  try { if (iconUrl) icon = await loadImage(iconUrl); } catch {}
  if (icon) await drawRoundedImage(ctx, icon, P, (H-ICON)/2, ICON, 12, "rgba(255,255,255,0.12)");

  // Titel
  const titleX = P + ICON + 16;
  const titleY = P + 6;
  ctx.font = `600 ${titleSize}px system-ui, Arial`;
  ctx.fillStyle = QUALITY_COLORS[quality] ?? "#ffffff";
  ctx.fillText(title, titleX, titleY + titleSize);

  // Body
  ctx.font = `${textSize}px system-ui, Arial`;
  const textMaxW = W - titleX - P;
  let y = titleY + titleSize + 12;

  async function drawLine(line) {
    const x0 = titleX;
    let x = x0;

    if (line.icon) {
      try {
        const ic = await loadImage(line.icon);
        const size = 20;
        ctx.save(); roundRect(ctx, x, y, size, size, 4); ctx.clip();
        ctx.drawImage(ic, x, y, size, size); ctx.restore();
        x += size + 8;
      } catch {}
    }

    ctx.font = `${line.italic ? "italic " : ""}${textSize}px system-ui, Arial`;

    const segs = splitWowColorSegments(String(line.text));
    for (const seg of segs.length ? segs : [{ text: line.text }]) {
      ctx.fillStyle = seg.color || line.color || "#d7dadc";
      const parts = wrapText(ctx, seg.text, textMaxW - (x - x0));
      for (let i=0; i<parts.length; i++) {
        ctx.fillText(parts[i], x, y + textSize);
        if (i < parts.length - 1) { y += lineH; x = x0; }
      }
    }
    y += lineH;
  }

  for (const line of (tooltipModel || [])) {
    await drawLine(line);
  }

  // Preise (optional)
  const fmt = (p) => {
    const bits = [];
    if (p?.g) bits.push(`${p.g} Gold`);
    if (p?.s) bits.push(`${p.s} Silber`);
    if (p?.c) bits.push(`${p.c} Kupfer`);
    return bits.join("  ");
  };

  /*if (priceBuy) {
    ctx.fillStyle = "#ffd700";
    ctx.fillText(`Händler Ankauf: ${fmt(priceBuy)}`, titleX, y + textSize);
    y += lineH;
  }
  if (priceSell) {
    ctx.fillStyle = "#ffd700";
    ctx.fillText(`Händler Verkauf: ${fmt(priceSell)}`, titleX, y + textSize);
    y += lineH;
  }*/

  return canvas.encode("png");
}
