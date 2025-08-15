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

  public render(showParticles: boolean, protagonistClusters?: Array<{id: number, color: string, name: string}>): void {
    // Clear overlay canvas for 2D elements on top of WebGL
    this.overlayCtx.clearRect(0, 0, this.width, this.height);

    // Render WebGL trails first (background)
    this.trailSystem.renderToCanvas();

    // Render GPU agents directly on WebGL canvas
    this.gpuSystem.renderToCanvas();

    // Render particles and clusters using overlay canvas (on top of WebGL)
    this.overlayCtx.save();
    this.particleSystem.render(this.overlayCtx, showParticles, protagonistClusters);
    this.overlayCtx.restore();
  }
}
