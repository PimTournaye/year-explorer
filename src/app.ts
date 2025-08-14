import { GPUSystem } from './systems/GPUSystem';
import { TrailSystem } from './systems/TrailSystem';
import { ParticleSystem } from './systems/ParticleSystem';
import { Controls, type ControlCallbacks } from './ui/Controls';
import { DOMUpdater } from './ui/DOMUpdater';
import { Simulation } from './simulation';
import { Renderer } from './renderer'; // New import
import { loadBridgeData, loadData } from './data/loader';
import type { ClusteredData } from './data/interfaces';
import type { Bridge } from './types/interfaces';


export class SemanticGarden {
  // Canvas and WebGL context
  private canvas: HTMLCanvasElement;
  private gl!: WebGL2RenderingContext;

  // Dimensions
  private width: number = 0;
  private height: number = 0;

  // Systems
  private gpuSystem!: GPUSystem;
  private trailSystem!: TrailSystem;
  private particleSystem!: ParticleSystem;
  private simulation!: Simulation;
  private renderer!: Renderer; // New property

  // UI
  private domUpdater: DOMUpdater;

  // Animation state
  private isPlaying: boolean = false;
  private speed: number = 1;
  private animationId: number | null = null;
  private showParticles: boolean = true;
  private data: ClusteredData | null = null;
  private ledger: any;
  private bridgeData: Bridge[];

  constructor() {
    this.canvas = document.getElementById('canvas') as HTMLCanvasElement;

    this.domUpdater = new DOMUpdater();

    this.initialize();
  }

  private async initialize(): Promise<void> {
    this.setupCanvas();
    await this.initializeWebGL();
    await this.loadApplicationData(); // Load data first

    // Initialize systems that depend on data
    this.particleSystem = new ParticleSystem(this.width, this.height);
    this.particleSystem.initialize(this.data!);
    
    this.gpuSystem = new GPUSystem(this.gl, this.particleSystem, this.width, this.height, 1024);
    this.trailSystem = new TrailSystem(this.gl, this.width, this.height);

    // Initialize simulation and renderer after all systems are ready
    this.simulation = new Simulation(
      this.particleSystem,
      this.gpuSystem,
      this.data!,
      this.bridgeData,
      this.width,
      this.height
    );
    this.renderer = new Renderer(
      this.canvas,
      this.trailSystem,
      this.gpuSystem,
      this.particleSystem,
      this.width,
      this.height
    );

    window.addEventListener('resize', () => this.handleResize());

    // Start the render loop
    this.render();
  }

  private setupCanvas(): void {
    this.width = window.innerWidth;
    this.height = window.innerHeight;

    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.canvas.style.width = this.width + 'px';
    this.canvas.style.height = this.height + 'px';
  }

  private async initializeWebGL(): Promise<void> {
    console.log('🔍 Attempting WebGL initialization...');

    const gl = this.canvas.getContext('webgl2');

    if (!gl) {
      throw new Error('WebGL 2.0 context creation failed - WebGL 2.0 required for PBO support');
    }

    this.gl = gl;

    console.log('➡️ Requesting EXT_color_buffer_float extension...');
    const ext = this.gl.getExtension('EXT_color_buffer_float');
    if (!ext) {
      // If the browser doesn't support this, we cannot proceed with GPGPU.
      // This is a fatal error for our architecture.
      throw new Error('Unsupported hardware: EXT_color_buffer_float is not available.');
    }
    console.log('✅ EXT_color_buffer_float extension enabled.');

    console.log('✅ WebGL context created successfully');
    console.log('📊 WebGL Info:', {
      version: this.gl.getParameter(this.gl.VERSION),
      vendor: this.gl.getParameter(this.gl.VENDOR),
      renderer: this.gl.getParameter(this.gl.RENDERER)
    });

    document.getElementById('rendererInfo')!.textContent = 'WebGL';
  }

  private setupControls(): void {
    const callbacks: ControlCallbacks = {
      onPlayPause: (isPlaying) => {
        this.isPlaying = isPlaying;
        if (this.isPlaying) {
          this.startAnimation();
        } else {
          this.stopAnimation();
        }
      },
      onSpeedChange: (speed) => {
        this.speed = speed;
      },
      onParticleToggle: (showParticles) => {
        this.showParticles = showParticles;
      }
    };

    new Controls(callbacks);
  }

  private async loadApplicationData(): Promise<void> {
    try {
      this.data = await loadData();
      console.log('✅ Application data loaded');
      this.bridgeData = await loadBridgeData(); // Load bridge data
      console.log('✅ Bridge data loaded');
    } catch (error) {
      console.error('❌ Failed to initialize application:', error);
    }
  }

  private handleResize(): void {
    this.setupCanvas();

    this.trailSystem.resize(this.width, this.height);
    this.gl.viewport(0, 0, this.width, this.height);

    if (this.particleSystem && this.data) {
      this.particleSystem.resize(this.width, this.height, this.data);
    }
    this.simulation.resize(this.width, this.height);
    this.renderer.resize(this.width, this.height); // Notify renderer of resize
  }

  private render(): void {
    this.simulation.update();

    this.gpuSystem.update(this.trailSystem.getTrailTexture());
    this.gpuSystem.updateFrontierMirrors();

    this.trailSystem.update(
      this.gpuSystem.getAgentStateTexture(),
      this.gpuSystem.getAgentPropertiesTexture(),
      this.gpuSystem.getAgentExtendedTexture(),
      this.gpuSystem.getAgentTextureSize(),
      this.gpuSystem.getActiveAgentCount()
    );

    this.renderer.render(this.showParticles); // Pass showParticles to renderer
    if (this.ledger) {
      this.ledger.update(this.gpuSystem.getFrontierAgentMirrors());
    }

    this.updateUI();
  }

  private updateUI(): void {
    this.domUpdater.update({
      year: this.simulation.currentYear,
      activeParticles: this.particleSystem.getConstellationParticleCount(this.simulation.currentYear, this.simulation.PROJECT_ACTIVE_WINDOW_YEARS),
      activeClusters: this.particleSystem.getActiveClusters().length,
      activeAgents: this.gpuSystem.getActiveAgentCount()
    });
  }

  private animate(): void {
    if (!this.isPlaying) return;

    const deltaTime = this.simulation.YEAR_DURATION / this.speed;
    this.simulation.currentYear += 1 / (deltaTime / 16.67);

    if (this.simulation.currentYear > this.simulation.END_YEAR) {
      this.simulation.currentYear = this.simulation.START_YEAR;
    }

    this.render();
    this.animationId = requestAnimationFrame(() => this.animate());
  }

  private startAnimation(): void {
    if (this.animationId) return;
    this.animate();
  }

  private stopAnimation(): void {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  public dispose(): void {
    this.stopAnimation();
    this.gpuSystem.dispose();
    this.trailSystem.dispose();
  }
}
