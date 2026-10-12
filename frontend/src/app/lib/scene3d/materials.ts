/**
 * Surfaces of the 3D room: the textures, drawn on a canvas so the view needs
 * no image files, and the materials made from them.
 *
 * Every tiling texture is drawn to a real size (`metres`) and every geometry
 * carries its UVs in metres (see `metreUV` in ./parts), so wood grain, floor
 * boards and tiles come out the same size on a bedside table as on a wardrobe.
 */

import * as THREE from "three";

export type Rnd = () => number;

/** A repeatable random source: the same seed always draws the same thing. */
export function seeded(seed: string): Rnd {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

/** A lighter (amount > 0) or darker (amount < 0) shade of a colour. */
export function tone(color: string, amount: number): string {
  const c = new THREE.Color(color);
  c.lerp(new THREE.Color(amount >= 0 ? "#ffffff" : "#000000"), Math.min(Math.abs(amount), 1));
  return `#${c.getHexString()}`;
}

type Draw = (g: CanvasRenderingContext2D, size: number, rnd: Rnd) => void;

function canvas(width: number, height: number, draw: (g: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const el = document.createElement("canvas");
  el.width = width;
  el.height = height;
  draw(el.getContext("2d")!);
  return el;
}

// ─────────────────────────────────────────────
// Texture drawings
// ─────────────────────────────────────────────

/** Wood grain along the texture's U axis, near white so it tints to any timber. */
const drawGrain: Draw = (g, s, rnd) => {
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, s, s);
  for (let i = 0; i < 26; i++) {                       // broad bands of tone
    const y = rnd() * s;
    const t = 6 + rnd() * 40;
    g.fillStyle = `rgba(120, 82, 45, ${0.03 + rnd() * 0.06})`;
    g.fillRect(0, y, s, t);
    g.fillRect(0, y - s, s, t);
  }
  for (let i = 0; i < 150; i++) {                      // the grain itself; whole waves, so it tiles
    const y0 = rnd() * s;
    const amp = 1 + rnd() * 5;
    const waves = 1 + Math.floor(rnd() * 3);
    const phase = rnd() * Math.PI * 2;
    g.strokeStyle = `rgba(96, 62, 30, ${0.05 + rnd() * 0.12})`;
    g.lineWidth = 0.6 + rnd() * 1.4;
    g.beginPath();
    for (let x = 0; x <= s; x += 8) {
      const y = y0 + Math.sin((x / s) * Math.PI * 2 * waves + phase) * amp;
      if (x === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
};

/** Floor boards running along U, each its own shade, ends staggered row to row. */
function drawBoards(base: string): Draw {
  return (g, s, rnd) => {
    const rows = 14;
    const rowH = s / rows;
    for (let r = 0; r < rows; r++) {
      const y = r * rowH;
      const start = rnd() * s;
      const first = s * (0.35 + rnd() * 0.3);
      for (const [x0, length] of [[start, first], [start + first, s - first]] as const) {
        const shade = tone(base, (rnd() - 0.5) * 0.13);
        const grain = Array.from({ length: 9 }, () => ({
          y: y + rnd() * rowH, a: (rnd() - 0.5) * 6, b: (rnd() - 0.5) * 6,
          alpha: 0.04 + rnd() * 0.08, width: 0.6 + rnd() * 1.6,
        }));
        for (const x of [x0, x0 - s, x0 - 2 * s]) {          // drawn again where it wraps round the edge
          g.save();
          g.beginPath();
          g.rect(x, y, length, rowH);
          g.clip();
          g.fillStyle = shade;
          g.fillRect(x, y, length, rowH);
          for (const line of grain) {
            g.strokeStyle = `rgba(70, 44, 20, ${line.alpha})`;
            g.lineWidth = line.width;
            g.beginPath();
            g.moveTo(x, line.y);
            g.bezierCurveTo(x + length * 0.33, line.y + line.a, x + length * 0.66, line.y + line.b, x + length, line.y);
            g.stroke();
          }
          g.fillStyle = "rgba(48, 30, 14, 0.4)";              // the joint at the board's end
          g.fillRect(x + length - 1.5, y, 1.5, rowH);
          g.restore();
        }
      }
      g.fillStyle = "rgba(48, 30, 14, 0.38)";                 // the joint along the row
      g.fillRect(0, y, s, 1.5);
    }
  };
}

interface TileSpec {
  cols: number;
  rows: number;
  /** Real size one repeat of the texture covers, metres. */
  metres: [number, number];
  base: string;
  grout: string;
  /** How far the tiles differ in shade from one to the next. */
  vary?: number;
  /** Width of the grout line, as a share of the texture. */
  joint?: number;
  /** Every other course shifted half a tile. */
  bond?: boolean;
}

function drawTiles(spec: TileSpec): Draw {
  return (g, s, rnd) => {
    const cw = s / spec.cols;
    const ch = s / spec.rows;
    const joint = Math.max(1, s * (spec.joint ?? 0.008));
    g.fillStyle = spec.grout;
    g.fillRect(0, 0, s, s);
    for (let r = 0; r < spec.rows; r++) {
      const shift = spec.bond && r % 2 === 1 ? cw / 2 : 0;
      for (let c = -1; c < spec.cols; c++) {
        const x = c * cw + shift + joint / 2;
        const y = r * ch + joint / 2;
        const shade = tone(spec.base, (rnd() - 0.5) * (spec.vary ?? 0.04));
        g.fillStyle = shade;
        g.fillRect(x, y, cw - joint, ch - joint);
        // a soft cloud across each tile, so it is not one flat colour
        const cloud = g.createRadialGradient(x + cw * rnd(), y + ch * rnd(), 0, x + cw / 2, y + ch / 2, cw * 0.8);
        cloud.addColorStop(0, "rgba(255, 255, 255, 0.06)");
        cloud.addColorStop(1, "rgba(120, 120, 120, 0.04)");
        g.fillStyle = cloud;
        g.fillRect(x, y, cw - joint, ch - joint);
      }
    }
  };
}

/** Polished stone: a base colour scattered with fine dark and light flecks. */
function drawStone(base: string): Draw {
  return (g, s, rnd) => {
    g.fillStyle = base;
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 2600; i++) {
      const x = rnd() * s;
      const y = rnd() * s;
      const r = 0.4 + rnd() * rnd() * 2.2;
      const pick = rnd();
      g.fillStyle = pick < 0.45 ? `rgba(60, 62, 66, ${0.12 + rnd() * 0.3})`
        : pick < 0.8 ? `rgba(255, 255, 255, ${0.25 + rnd() * 0.4})`
          : `rgba(140, 132, 120, ${0.15 + rnd() * 0.3})`;
      for (const dx of x < 3 ? [0, s] : x > s - 3 ? [0, -s] : [0]) {
        for (const dy of y < 3 ? [0, s] : y > s - 3 ? [0, -s] : [0]) {
          g.beginPath();
          g.arc(x + dx, y + dy, r, 0, Math.PI * 2);
          g.fill();
        }
      }
    }
  };
}

/** A plain weave, two pixels to the thread, near white so it tints to any cloth. */
const drawWeave: Draw = (g, s, rnd) => {
  const image = g.createImageData(s, s);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const over = ((x >> 1) + (y >> 1)) % 2 === 0;
      const value = 228 + (over ? 12 : -8) + (rnd() - 0.5) * 22;
      const i = (y * s + x) * 4;
      image.data[i] = image.data[i + 1] = image.data[i + 2] = value;
      image.data[i + 3] = 255;
    }
  }
  g.putImageData(image, 0, 0);
};

// ─────────────────────────────────────────────
// The kit
// ─────────────────────────────────────────────

/** Makes the materials of one room model and owns the textures behind them. */
export class Kit {
  private readonly shared = new Map<string, THREE.CanvasTexture>();
  private readonly pictures: THREE.CanvasTexture[] = [];

  /** A tiling texture, drawn once however many materials use it. */
  private tiling(key: string, size: number, metres: [number, number], draw: Draw): THREE.CanvasTexture {
    let texture = this.shared.get(key);
    if (!texture) {
      texture = new THREE.CanvasTexture(canvas(size, size, (g) => draw(g, size, seeded(key))));
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(1 / metres[0], 1 / metres[1]);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 8;
      this.shared.set(key, texture);
    }
    return texture;
  }

  /** A one-off picture stretched over its surface: a rug's pattern, a print on the wall. */
  picture(width: number, height: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void): THREE.CanvasTexture {
    const w = Math.max(16, Math.round(width));
    const h = Math.max(16, Math.round(height));
    const texture = new THREE.CanvasTexture(canvas(w, h, (g) => draw(g, w, h)));
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    this.pictures.push(texture);
    return texture;
  }

  /** Timber with its grain. */
  wood(color: string, roughness = 0.5): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
      color, map: this.tiling("grain", 512, [0.9, 0.45], drawGrain), roughness, metalness: 0,
    });
  }

  /** A painted, lacquered or moulded surface: no texture of its own. */
  paint(color: string, roughness = 0.55): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0 });
  }

  /** Woven upholstery, with the soft sheen cloth has at a glancing angle. */
  fabric(color: string): THREE.MeshPhysicalMaterial {
    return new THREE.MeshPhysicalMaterial({
      color, map: this.tiling("weave", 64, [0.08, 0.08], drawWeave), roughness: 0.92, metalness: 0,
      sheen: 0.5, sheenRoughness: 0.75, sheenColor: tone(color, 0.4),
    });
  }

  leather(color: string): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color, roughness: 0.46, metalness: 0 });
  }

  /** Not quite a pure metal: a little of its own colour keeps steel bright where the studio it reflects is dark. */
  metal(color: string, roughness = 0.3): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.82 });
  }

  /** Glazed sanitaryware and pottery. */
  ceramic(color = "#fafaf6"): THREE.MeshPhysicalMaterial {
    return new THREE.MeshPhysicalMaterial({
      color, roughness: 0.22, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.1, side: THREE.DoubleSide,
    });
  }

  glass(opacity = 0.2, color = "#d7ecf3"): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
      color, transparent: true, opacity, roughness: 0.04, metalness: 0, envMapIntensity: 1.6,
      depthWrite: false, side: THREE.DoubleSide,
    });
  }

  /** Silvered glass. It is given some light of its own, or it would only show the dark of the studio it reflects. */
  mirror(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
      color: "#e9f1f4", roughness: 0.05, metalness: 0.9, emissive: "#9fb3c0", emissiveIntensity: 0.4,
    });
  }

  /** A polished stone worktop. */
  stone(color: string, roughness = 0.28): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
      map: this.tiling(`stone:${color}`, 256, [0.5, 0.5], drawStone(color)), roughness, metalness: 0,
    });
  }

  /** A lit lamp shade or light fitting. */
  glow(color = "#ffe9c4", intensity = 1.1): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: 0.7 });
  }

  /** A boarded timber floor. */
  boards(color: string): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({
      map: this.tiling(`boards:${color}`, 1024, [2.4, 2.4], drawBoards(color)), roughness: 0.52, metalness: 0,
    });
  }

  /** A tiled floor or wall. */
  tiles(spec: TileSpec, roughness = 0.35): THREE.MeshStandardMaterial {
    const key = `tiles:${spec.cols}x${spec.rows}:${spec.base}:${spec.grout}:${spec.bond ? "bond" : "stack"}`;
    return new THREE.MeshStandardMaterial({
      map: this.tiling(key, 512, spec.metres, drawTiles(spec)), roughness, metalness: 0,
    });
  }

  dispose(): void {
    for (const texture of this.shared.values()) texture.dispose();
    for (const texture of this.pictures) texture.dispose();
    this.shared.clear();
    this.pictures.length = 0;
  }
}
