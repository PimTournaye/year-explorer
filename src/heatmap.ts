interface Project {
  id: string;
  title: string;
  year: number;
  text: string;
  embedding: number[];
  x: number;
  y: number;
  clusterId: number;
}

interface ClusterData {
  id: number;
  centroid768d: number[];
  centroidX: number;
  centroidY: number;
  projectCount: number;
  yearRange: [number, number];
  topTerms: string[];
}

interface ClusteredData {
  projects: Project[];
  clusters: ClusterData[];
}

class TemporalHeatmap {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private width: number;
  private height: number;
  
  private data: ClusteredData | null = null;
  private currentYear: number = 1985;
  private isPlaying: boolean = false;
  private speed: number = 1;
  private animationId: number | null = null;
  
  // Animation and visual parameters
  private readonly START_YEAR = 1985;
  private readonly END_YEAR = 2025;
  private readonly YEAR_DURATION = 100; // milliseconds per year at 1x speed
  
  // Heatmap parameters
  private minX: number = 0;
  private maxX: number = 0;
  private minY: number = 0;
  private maxY: number = 0;
  private scaleFactor: number = 1;
  private offsetX: number = 0;
  private offsetY: number = 0;
  
  // Heat decay parameters
  private readonly HEAT_RADIUS = 80;
  private readonly HEAT_INTENSITY = 1.0;
  private readonly HEAT_DECAY = 0.98; // Projects fade over time
  
  // Active projects with heat values
  private activeProjects: Map<string, { project: Project; heat: number; age: number }> = new Map();

  constructor() {
    this.canvas = document.getElementById('canvas') as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d')!;
    
    this.setupCanvas();
    this.setupControls();
    this.loadData();
    
    window.addEventListener('resize', () => this.setupCanvas());
  }

  private setupCanvas(): void {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    
    this.canvas.style.width = this.width + 'px';
    this.canvas.style.height = this.height + 'px';
  }

  private setupControls(): void {
    const playPause = document.getElementById('playPause') as HTMLButtonElement;
    const speedSlider = document.getElementById('speedSlider') as HTMLInputElement;
    const speedValue = document.getElementById('speedValue') as HTMLSpanElement;
    
    playPause.addEventListener('click', () => {
      this.isPlaying = !this.isPlaying;
      playPause.textContent = this.isPlaying ? '⏸' : '▶';
      
      if (this.isPlaying) {
        this.startAnimation();
      } else {
        this.stopAnimation();
      }
    });
    
    speedSlider.addEventListener('input', () => {
      this.speed = parseFloat(speedSlider.value);
      speedValue.textContent = `${this.speed}x`;
    });
  }

  private async loadData(): Promise<void> {
    try {
      // Load from the public folder
      const response = await fetch('./projects-with-embeddings-clustered.json');
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      this.data = await response.json() as ClusteredData;
      console.log(`Loaded ${this.data.projects.length} projects and ${this.data.clusters.length} clusters`);
      
      this.calculateBounds();
      this.render();
      
    } catch (error) {
      console.error('Failed to load clustered data:', error);
      console.error('Make sure projects-with-embeddings-clustered.json is in the public folder');
    }
  }

  private calculateBounds(): void {
    if (!this.data) return;
    
    // Find the bounds of all project coordinates
    this.minX = Math.min(...this.data.projects.map(p => p.x));
    this.maxX = Math.max(...this.data.projects.map(p => p.x));
    this.minY = Math.min(...this.data.projects.map(p => p.y));
    this.maxY = Math.max(...this.data.projects.map(p => p.y));
    
    // Calculate scale and offset to fit the canvas with padding
    const padding = 100;
    const dataWidth = this.maxX - this.minX;
    const dataHeight = this.maxY - this.minY;
    
    const scaleX = (this.width - 2 * padding) / dataWidth;
    const scaleY = (this.height - 2 * padding) / dataHeight;
    this.scaleFactor = Math.min(scaleX, scaleY);
    
    this.offsetX = (this.width - dataWidth * this.scaleFactor) / 2 - this.minX * this.scaleFactor;
    this.offsetY = (this.height - dataHeight * this.scaleFactor) / 2 - this.minY * this.scaleFactor;
    
    console.log(`Bounds: (${this.minX}, ${this.minY}) to (${this.maxX}, ${this.maxY})`);
    console.log(`Scale: ${this.scaleFactor}, Offset: (${this.offsetX}, ${this.offsetY})`);
  }

  private worldToScreen(x: number, y: number): [number, number] {
    return [
      x * this.scaleFactor + this.offsetX,
      y * this.scaleFactor + this.offsetY
    ];
  }

  private updateActiveProjects(): void {
    if (!this.data) return;
    
    // Add new projects that should appear this year
    const newProjects = this.data.projects.filter(p => p.year === Math.floor(this.currentYear));
    
    for (const project of newProjects) {
      if (!this.activeProjects.has(project.id)) {
        this.activeProjects.set(project.id, {
          project,
          heat: this.HEAT_INTENSITY,
          age: 0
        });
      }
    }
    
    // Update existing projects (decay heat and increase age)
    for (const [id, activeProject] of this.activeProjects.entries()) {
      activeProject.heat *= this.HEAT_DECAY;
      activeProject.age += 1;
      
      // Remove projects that have faded too much
      if (activeProject.heat < 0.01) {
        this.activeProjects.delete(id);
      }
    }
  }

  private renderHeatmap(): void {
    // Create a gradient heatmap
    const imageData = this.ctx.createImageData(this.width, this.height);
    const data = imageData.data;
    
    // Initialize with black
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 0;     // R
      data[i + 1] = 0; // G
      data[i + 2] = 0; // B
      data[i + 3] = 255; // A
    }
    
    // Add heat for each active project
    for (const activeProject of this.activeProjects.values()) {
      const [screenX, screenY] = this.worldToScreen(activeProject.project.x, activeProject.project.y);
      this.addHeatBlob(data, screenX, screenY, activeProject.heat);
    }
    
    this.ctx.putImageData(imageData, 0, 0);
  }

  private addHeatBlob(data: Uint8ClampedArray, centerX: number, centerY: number, intensity: number): void {
    const radius = this.HEAT_RADIUS;
    const startX = Math.max(0, Math.floor(centerX - radius));
    const endX = Math.min(this.width - 1, Math.floor(centerX + radius));
    const startY = Math.max(0, Math.floor(centerY - radius));
    const endY = Math.min(this.height - 1, Math.floor(centerY + radius));
    
    for (let y = startY; y <= endY; y++) {
      for (let x = startX; x <= endX; x++) {
        const distance = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2);
        if (distance <= radius) {
          const falloff = 1 - (distance / radius);
          const heat = intensity * falloff * falloff; // Quadratic falloff
          
          const index = (y * this.width + x) * 4;
          
          // Heat color mapping: black -> red -> yellow -> white
          const currentR = data[index];
          const currentG = data[index + 1];
          const currentB = data[index + 2];
          
          // Add heat with color progression
          const newHeat = Math.min(1, (currentR + currentG + currentB) / (3 * 255) + heat);
          
          if (newHeat < 0.3) {
            // Black to red
            const t = newHeat / 0.3;
            data[index] = Math.min(255, currentR + t * 255 * 0.5);
            data[index + 1] = Math.min(255, currentG);
            data[index + 2] = Math.min(255, currentB);
          } else if (newHeat < 0.6) {
            // Red to yellow
            const t = (newHeat - 0.3) / 0.3;
            data[index] = Math.min(255, currentR + (1 - t) * 128 + t * 255);
            data[index + 1] = Math.min(255, currentG + t * 255);
            data[index + 2] = Math.min(255, currentB);
          } else {
            // Yellow to white
            const t = (newHeat - 0.6) / 0.4;
            data[index] = 255;
            data[index + 1] = 255;
            data[index + 2] = Math.min(255, currentB + t * 255);
          }
        }
      }
    }
  }

  private renderClusterCentroids(): void {
    if (!this.data) return;
    
    this.ctx.save();
    
    // Draw cluster centroids as subtle reference points
    for (const cluster of this.data.clusters) {
      const [screenX, screenY] = this.worldToScreen(cluster.centroidX, cluster.centroidY);
      
      this.ctx.beginPath();
      this.ctx.arc(screenX, screenY, 3, 0, 2 * Math.PI);
      this.ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
      this.ctx.fill();
      
      // Optional: draw cluster ID
      this.ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      this.ctx.font = '10px Arial';
      this.ctx.textAlign = 'center';
      this.ctx.fillText(cluster.id.toString(), screenX, screenY - 8);
    }
    
    this.ctx.restore();
  }

  private updateYearDisplay(): void {
    const yearDisplay = document.getElementById('yearDisplay') as HTMLElement;
    yearDisplay.textContent = Math.floor(this.currentYear).toString();
  }

  private render(): void {
    this.ctx.clearRect(0, 0, this.width, this.height);
    
    this.updateActiveProjects();
    this.renderHeatmap();
    this.renderClusterCentroids();
    this.updateYearDisplay();
  }

  private animate(): void {
    if (!this.isPlaying) return;
    
    const deltaTime = this.YEAR_DURATION / this.speed;
    this.currentYear += 1 / (deltaTime / 16.67); // Assuming 60fps
    
    if (this.currentYear > this.END_YEAR) {
      this.currentYear = this.START_YEAR;
      this.activeProjects.clear();
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
}

// Initialize the heatmap when the DOM is loaded
new TemporalHeatmap();