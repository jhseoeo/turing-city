import type { Snapshot } from '@turing-city/core';
import Phaser from 'phaser';
import { consumersOf, heatAlpha, LED_COLORS, ledOf } from '../format.ts';
import { cellCaption, FACILITY_COLORS, routesFor, type Tone, truckLabel, trucksByCell } from '../map-rules.ts';

export const CELL = 34;

const TONE_COLORS: Record<Tone, string> = { normal: '#d7dde4', warn: '#ffb020', good: '#7fe08a' };
const TRUCK_COLOR = 0xff9f43;
/** How far the caption of every other column sits below the first line. */
const CAPTION_LINE = 11;

/** The town: drawn from scratch on every snapshot, selection change, and blink. */
export class MapScene extends Phaser.Scene {
  onSelect: (id: string | null) => void = () => {};
  private gfx: Phaser.GameObjects.Graphics | null = null;
  private labels: Phaser.GameObjects.Text[] = [];
  private snapshot: Snapshot | null = null;
  private selected: string | null = null;
  private heatmap = false;
  private overheatC = 85;
  private blinkOn = true;

  constructor() {
    super('map');
  }

  create(): void {
    this.gfx = this.add.graphics();
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      const x = Math.floor(p.x / CELL);
      const y = Math.floor(p.y / CELL);
      const hit = this.snapshot?.facilities.find((f) => f.x === x && f.y === y);
      this.onSelect(hit?.id ?? null);
    });
    this.time.addEvent({
      delay: 450,
      loop: true,
      callback: () => {
        this.blinkOn = !this.blinkOn;
        this.redraw();
      },
    });
    this.redraw();
  }

  show(snapshot: Snapshot, selected: string | null, heatmap: boolean, overheatC: number): void {
    this.snapshot = snapshot;
    this.selected = selected;
    this.heatmap = heatmap;
    this.overheatC = overheatC;
    this.redraw();
  }

  private text(x: number, y: number, value: string, color: string, size = 11, background = '#0c0f13cc'): void {
    this.labels.push(
      this.add.text(x, y, value, {
        fontFamily: 'ui-monospace, Menlo, monospace',
        fontSize: `${size}px`,
        color,
        backgroundColor: background,
      }),
    );
  }

  /** A line through the centres of the cells. */
  private path(
    g: Phaser.GameObjects.Graphics,
    cells: ReadonlyArray<readonly [number, number]>,
    color: number,
    width: number,
    alpha = 1,
  ): void {
    const [first, ...rest] = cells;
    if (!first) return;
    g.lineStyle(width, color, alpha);
    g.beginPath();
    g.moveTo(first[0] * CELL + CELL / 2, first[1] * CELL + CELL / 2);
    for (const [x, y] of rest) g.lineTo(x * CELL + CELL / 2, y * CELL + CELL / 2);
    g.strokePath();
  }

  private redraw(): void {
    const s = this.snapshot;
    const g = this.gfx;
    if (!s || !g) return;
    g.clear();
    for (const t of this.labels) t.destroy();
    this.labels = [];
    const { width, height } = s.grid;

    g.fillStyle(0x141a20, 1);
    g.fillRect(0, 0, width * CELL, height * CELL);
    g.lineStyle(1, 0x232b34, 1);
    for (let x = 0; x <= width; x++) g.lineBetween(x * CELL, 0, x * CELL, height * CELL);
    for (let y = 0; y <= height; y++) g.lineBetween(0, y * CELL, width * CELL, y * CELL);

    if (this.heatmap) {
      s.emf.forEach((units, i) => {
        const alpha = heatAlpha(units);
        if (alpha > 0) {
          g.fillStyle(0xff5a28, alpha);
          g.fillRect((i % width) * CELL, Math.floor(i / width) * CELL, CELL, CELL);
        }
      });
    }

    // Routine paths, only with a related block selected: the trucks' legs (a returning leg drawn fainter).
    for (const route of routesFor(s, this.selected)) this.path(g, route.cells, TRUCK_COLOR, 2, route.status === 'outbound' ? 0.9 : 0.45);

    const consumers = consumersOf(s, this.selected);
    for (const f of s.facilities) {
      const px = f.x * CELL;
      const py = f.y * CELL;
      const consumer = consumers?.find((c) => c.id === f.id);
      if (consumer) {
        g.lineStyle(2, consumer.shed ? 0x59636f : 0xf2c14e, 1);
        g.strokeRect(px, py, CELL, CELL);
        this.text(
          px + CELL + 2,
          py + 2,
          `−${consumer.demand} · ${consumer.rank}순위${consumer.shed ? ' · 정전' : ''}`,
          consumer.shed ? '#9aa3ad' : '#f2c14e',
        );
      }
      const down = f.condition !== 'ok';
      g.fillStyle(down ? 0x2a2f36 : FACILITY_COLORS[f.kind], down || !f.powered ? 0.55 : 1);
      g.fillRect(px + 2, py + 2, CELL - 4, CELL - 4);
      if (f.condition === 'wrecked') {
        g.lineStyle(2, 0xff4d4d, 1);
        g.lineBetween(px + 7, py + 7, px + CELL - 7, py + CELL - 7);
        g.lineBetween(px + CELL - 7, py + 7, px + 7, py + CELL - 7);
      } else if (f.condition === 'repairing') {
        g.lineStyle(1, 0xffb020, 0.8);
        // Diagonals across the whole cell, each cut at its edges (x + y = c).
        for (let c = 8; c < 2 * CELL - 8; c += 7) {
          const lo = Math.max(2, c - (CELL - 2));
          const hi = Math.min(CELL - 2, c - 2);
          g.lineBetween(px + lo, py + c - lo, px + hi, py + c - hi);
        }
      }
      if (f.farm && !down) {
        // A ripeness bar along the bottom of the cell: green once ripe.
        g.fillStyle(0x0c0f13, 0.6);
        g.fillRect(px + 4, py + CELL - 5, CELL - 8, 2);
        g.fillStyle(f.farm.ripe ? 0x3fd07a : 0xe6d34a, 1);
        g.fillRect(px + 4, py + CELL - 5, Math.round(((CELL - 8) * f.farm.ripeness) / 100), 2);
      }
      const led = ledOf(f);
      if (led !== null) {
        g.fillStyle(LED_COLORS[led], 1);
        g.fillCircle(px + CELL - 5, py + 5, 4);
        if (led === 'error' && !this.blinkOn) {
          g.fillStyle(0x141a20, 1);
          g.fillCircle(px + CELL - 5, py + 5, 4);
        }
      }
      // The cell, from the top: the tier mark of a facility with a board, the id, and the trucks at the bottom right.
      if (f.tier > 0) this.text(px + 3, py + 3, `T${f.tier}`, '#0c0f13', 9, '#c9d3dc');
      this.text(px + 4, py + (f.tier > 0 ? 14 : 9), f.id, '#ffffff');
      const caption = cellCaption(f, this.overheatC);
      // A caption is wider than its cell, so the captions of neighbours sit on alternate lines, as in a row of farms.
      if (caption) this.text(px, py + CELL + 1 + (f.x % 2) * CAPTION_LINE, caption.text, TONE_COLORS[caption.tone], 10);
      if (f.id === this.selected) {
        g.lineStyle(2, 0xffffff, 1);
        g.strokeRect(px, py, CELL, CELL);
      }
    }

    // The trucks, at their cells, side by side when two share one; an idle one waits in its warehouse's cell.
    for (const [, trucks] of trucksByCell(s)) {
      trucks.forEach((t, k) => {
        const tx = t.x * CELL + CELL - 13 - k * 11;
        const ty = t.y * CELL + CELL - 12;
        g.fillStyle(TRUCK_COLOR, 1);
        g.fillRect(tx, ty, 10, 7);
        // Outlined, so that a truck waiting in its warehouse's cell shows against the warehouse's own colour.
        g.lineStyle(1, 0x0c0f13, 1);
        g.strokeRect(tx, ty, 10, 7);
        if (t.status !== 'idle') this.text(tx, ty + 8, truckLabel(t), '#ffcf99', 9);
      });
    }

    // Threats show whatever is selected: the Luddites, their path blinking.
    for (const group of s.luddites) {
      if (this.blinkOn && group.path.length > 0) this.path(g, [[group.x, group.y], ...group.path], 0xff4d4d, 2);
      g.fillStyle(0xff4d4d, 1);
      for (let k = 0; k < group.size; k++) g.fillCircle(group.x * CELL + 9 + (k % 2) * 10, group.y * CELL + 10 + Math.floor(k / 2) * 12, 4);
      this.text(
        group.x * CELL + CELL + 2,
        group.y * CELL,
        `러다이트 ${group.size}${group.targetId ? ` → ${group.targetId}` : ''}`,
        '#ff4d4d',
      );
    }
  }
}

/** Creates the Phaser game for the map, sized to the scenario's grid. */
export function mountMap(parent: HTMLElement, snapshot: Snapshot, onSelect: (id: string | null) => void): MapScene {
  const scene = new MapScene();
  scene.onSelect = onSelect;
  new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: snapshot.grid.width * CELL + 140,
    height: snapshot.grid.height * CELL + 14,
    backgroundColor: '#11151a',
    scene,
  });
  return scene;
}
