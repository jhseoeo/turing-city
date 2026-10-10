import type { Snapshot } from '@turing-city/core';
import Phaser from 'phaser';
import { consumersOf, heatAlpha, LED_COLORS, ledOf } from '../format.ts';

export const CELL = 34;

const FACILITY_COLORS: Record<string, number> = { power: 0xf2c14e, datacenter: 0xc49bff };

/** The town: drawn from scratch on every snapshot, selection change, and blink. */
export class MapScene extends Phaser.Scene {
  onSelect: (id: string | null) => void = () => {};
  private gfx: Phaser.GameObjects.Graphics | null = null;
  private labels: Phaser.GameObjects.Text[] = [];
  private snapshot: Snapshot | null = null;
  private selected: string | null = null;
  private heatmap = false;
  private blinkOn = true;

  constructor() {
    super('map');
  }

  create(): void {
    this.gfx = this.add.graphics();
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      const x = Math.floor(p.x / CELL);
      const y = Math.floor(p.y / CELL);
      const hit = this.snapshot?.boards.find((b) => b.x === x && b.y === y);
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

  show(snapshot: Snapshot, selected: string | null, heatmap: boolean): void {
    this.snapshot = snapshot;
    this.selected = selected;
    this.heatmap = heatmap;
    this.redraw();
  }

  private text(x: number, y: number, value: string, color: string, size = 11): void {
    this.labels.push(
      this.add.text(x, y, value, {
        fontFamily: 'ui-monospace, Menlo, monospace',
        fontSize: `${size}px`,
        color,
        backgroundColor: '#0c0f13cc',
      }),
    );
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

    const consumers = consumersOf(s, this.selected);
    for (const b of s.boards) {
      const px = b.x * CELL;
      const py = b.y * CELL;
      const led = ledOf(b);
      const dim = led === 'unpowered' || led === 'destroyed';
      const consumer = consumers?.find((c) => c.id === b.id);
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
      g.fillStyle(FACILITY_COLORS[b.kind] ?? 0x9aa7b4, dim ? 0.45 : 1);
      g.fillRect(px + 2, py + 2, CELL - 4, CELL - 4);
      g.fillStyle(LED_COLORS[led], 1);
      g.fillCircle(px + CELL - 5, py + 5, 4);
      if (led === 'error' && !this.blinkOn) {
        g.fillStyle(0x141a20, 1);
        g.fillCircle(px + CELL - 5, py + 5, 4);
      }
      this.text(px + 6, py + 10, b.id, '#ffffff');
      if (b.tempC !== null)
        this.text(px, py + CELL + 1, `${b.tempC}°C${b.processing ? ' ▲' : ''}`, b.tempC >= 85 ? '#ffb020' : '#d7dde4', 10);
      if (b.id === this.selected) {
        g.lineStyle(2, 0xffffff, 1);
        g.strokeRect(px, py, CELL, CELL);
      }
    }

    for (const group of s.luddites) {
      if (this.blinkOn && group.path.length > 0) {
        g.lineStyle(2, 0xff4d4d, 1);
        g.beginPath();
        g.moveTo(group.x * CELL + CELL / 2, group.y * CELL + CELL / 2);
        for (const [x, y] of group.path) g.lineTo(x * CELL + CELL / 2, y * CELL + CELL / 2);
        g.strokePath();
      }
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
