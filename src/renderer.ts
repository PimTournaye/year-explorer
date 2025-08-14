import { GPUSystem } from './systems/GPUSystem';
import { TrailSystem } from './systems/TrailSystem';
import { ParticleSystem } from './systems/ParticleSystem';

export class Renderer {
  private canvas: HTMLCanvasElement;
  private overlayCanvas: HTMLCanvasElement;
  private overlayCtx: CanvasRenderingContext2D;
  private trailSystem: TrailSystem;
  private gpuSystem: GPUSystem;
  private particleSystem: ParticleSystem;

  private width: number;
  private height: number;

  constructor(
    canvas: HTMLCanvasElement,
    trailSystem: TrailSystem,
    gpuSystem: GPUSystem,
    particleSystem: ParticleSystem,
    width: number,
    height: number
  ) {
    this.canvas = canvas;
    this.trailSystem = trailSystem;
    this.gpuSystem = gpuSystem;
    this.particleSystem = particleSystem;
    this.width = width;
    this.height = height;

    // Create overlay canvas for 2D elements (particles, UI) on top of WebGL
    this.overlayCanvas = document.createElement('canvas');
    this.overlayCanvas.style.position = 'absolute';
    this.overlayCanvas.style.top = '0';
    this.overlayCanvas.style.left = '0';
    this.overlayCanvas.style.pointerEvents = 'none';
    this.overlayCanvas.style.zIndex = '10';
    this.canvas.parentElement?.appendChild(this.overlayCanvas);

    this.overlayCtx = this.overlayCanvas.getContext('2d')!;
    this.setupOverlayCanvas();
  }

  private setupOverlayCanvas(): void {
    this.overlayCanvas.width = this.width;
    this.overlayCanvas.height = this.height;
    this.overlayCanvas.style.width = this.width + 'px';
    this.overlayCanvas.style.height = this.height + 'px';
  }

  public resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.setupOverlayCanvas();
  }

  public render(showParticles: boolean): void {
    // Clear overlay canvas for 2D elements on top of WebGL
    this.overlayCtx.clearRect(0, 0, this.width, this.height);

    // Render WebGL trails first (background)
    this.trailSystem.renderToCanvas();

    // Render GPU agents directly on WebGL canvas
    this.gpuSystem.renderToCanvas();

    // Render particles and clusters using overlay canvas (on top of WebGL)
    this.overlayCtx.save();
    this.particleSystem.render(this.overlayCtx, showParticles);
    this.overlayCtx.restore();
  }

  private renderFrontierLabels(): void {
    const frontierAgents = this.gpuSystem.getFrontierAgentMirrors();
    if (frontierAgents.length === 0) {
      return;
    }

    this.overlayCtx.save();
    this.overlayCtx.font = '12px NectoMono, sans-serif';
    this.overlayCtx.textAlign = 'center';
    this.overlayCtx.textBaseline = 'middle';

    const placedLabelBounds: { x: number; y: number; width: number; height: number }[] = [];

    for (const agent of frontierAgents) {
      if (!agent.isActive) continue;

      const textMetrics = this.overlayCtx.measureText(agent.label);
      const bgWidth = textMetrics.width + 10;
      const bgHeight = 18; // Slightly larger for padding

      let labelY = agent.y - 25; // Initial position above agent
      let labelX = agent.x;
      
      let currentBounds = { x: labelX - bgWidth / 2, y: labelY - bgHeight / 2, width: bgWidth, height: bgHeight };
      let overlaps = false;
      let attempts = 0;

      // Simple greedy collision avoidance
      do {
        overlaps = false;
        for (const placed of placedLabelBounds) {
          if (
            currentBounds.x < placed.x + placed.width &&
            currentBounds.x + currentBounds.width > placed.x &&
            currentBounds.y < placed.y + placed.height &&
            currentBounds.y + currentBounds.height > placed.y
          ) {
            overlaps = true;
            labelY -= 5; // Nudge label up
            currentBounds.y = labelY - bgHeight / 2;
            break;
          }
        }
        attempts++;
      } while (overlaps && attempts < 10);

      placedLabelBounds.push(currentBounds);

      // Draw label background
      this.overlayCtx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      this.overlayCtx.fillRect(currentBounds.x, currentBounds.y, currentBounds.width, currentBounds.height);

      // Draw label text
      this.overlayCtx.fillStyle = '#FFE066'; // Bright yellow for visibility
      this.overlayCtx.fillText(agent.label, labelX, labelY);

      // Draw connection line from label to agent
      this.overlayCtx.strokeStyle = 'rgba(255, 224, 102, 0.5)';
      this.overlayCtx.lineWidth = 1;
      this.overlayCtx.beginPath();
      this.overlayCtx.moveTo(labelX, labelY + bgHeight / 2);
      this.overlayCtx.lineTo(agent.x, agent.y - 8); // Connect to just below the agent
      this.overlayCtx.stroke();
    }

    this.overlayCtx.restore();
  }
}
