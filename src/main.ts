// Main application entry point and animation loop orchestrator

import type { ClusteredData, CrossClusterActivity, AgentSpawnData } from './data/interfaces';
import { loadData } from './data/loader';
import { GPUSystem } from './systems/GPUSystem';
import { TrailSystem } from './systems/TrailSystem';
import { ParticleSystem } from './systems/ParticleSystem';
import { Controls, type ControlCallbacks } from './ui/Controls';
import { DOMUpdater } from './ui/DOMUpdater';

class SemanticGarden {
  // Canvas and WebGL context
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null = null;
  private overlayCanvas: HTMLCanvasElement;
  private overlayCtx: CanvasRenderingContext2D;
  private gl: WebGLRenderingContext | null = null;
  
  // Dimensions
  private width: number = 0;
  private height: number = 0;
  
  // Data
  private data: ClusteredData | null = null;
  
  // Systems
  private gpuSystem: GPUSystem | null = null;
  private trailSystem: TrailSystem | null = null;
  private particleSystem: ParticleSystem | null = null;
  
  // UI
  private controls: Controls | null = null;
  private domUpdater: DOMUpdater;
  
  // Animation state
  private currentYear: number = 1985;
  private isPlaying: boolean = false;
  private speed: number = 1;
  private animationId: number | null = null;
  private showParticles: boolean = true;
  
  // Animation parameters
  private readonly START_YEAR = 1985;
  private readonly END_YEAR = 2025;
  private readonly YEAR_DURATION = 1000; // 10x slower timeline
  private readonly WINDOW_SIZE = 2; // years for sliding window
  
  // Pathway system configuration
  private activityThreshold: number = 1; // Lowered for more pathway activity
  private readonly PATHWAY_COOLDOWN_DURATION = 5; // years
  private pathwayCooldowns: Map<string, {lastTrigger: number, duration: number}> = new Map();
  
  // Agent configuration
  private readonly MAX_AGENTS = 1024; // Scalable agent limit
  private readonly AGENT_SPEED = 2;
  private readonly AGENT_LIFESPAN = 400; // frames

  constructor() {
    this.canvas = document.getElementById('canvas') as HTMLCanvasElement;
    
    // Create overlay canvas for 2D elements (particles, UI) on top of WebGL
    this.overlayCanvas = document.createElement('canvas');
    this.overlayCanvas.style.position = 'absolute';
    this.overlayCanvas.style.top = '0';
    this.overlayCanvas.style.left = '0';
    this.overlayCanvas.style.pointerEvents = 'none';
    this.overlayCanvas.style.zIndex = '10';
    this.canvas.parentElement?.appendChild(this.overlayCanvas);
    
    this.overlayCtx = this.overlayCanvas.getContext('2d')!;
    this.domUpdater = new DOMUpdater();
    
    this.initialize();
  }

  private async initialize(): Promise<void> {
    this.setupCanvas();
    await this.initializeWebGL();
    this.setupControls();
    await this.loadApplicationData();
    
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
    
    // Setup overlay canvas for 2D elements
    this.overlayCanvas.width = this.width;
    this.overlayCanvas.height = this.height;
    this.overlayCanvas.style.width = this.width + 'px';
    this.overlayCanvas.style.height = this.height + 'px';
  }

  private async initializeWebGL(): Promise<void> {
    try {
      console.log('🔍 Attempting WebGL initialization...');
      
      // Get WebGL context from main canvas
      this.gl = this.canvas.getContext('webgl') || this.canvas.getContext('experimental-webgl') as WebGLRenderingContext | null;
      
      if (!this.gl) {
        throw new Error('WebGL context creation failed on main canvas');
      }
      
      console.log('✅ WebGL context created successfully');
      console.log('📊 WebGL Info:', {
        version: this.gl.getParameter(this.gl.VERSION),
        vendor: this.gl.getParameter(this.gl.VENDOR),
        renderer: this.gl.getParameter(this.gl.RENDERER)
      });
      
      // Initialize systems
      this.trailSystem = new TrailSystem(this.gl, this.width, this.height);
      this.gpuSystem = new GPUSystem(this.gl, this.width, this.height, this.MAX_AGENTS);
      
      console.log('✅ GPGPU systems initialized successfully');
      
      document.getElementById('rendererInfo')!.textContent = 'WebGL';
    } catch (error) {
      console.log('⚠️ WebGL failed, falling back to Canvas 2D:', error);
      
      this.gl = null;
      this.trailSystem = null;
      this.gpuSystem = null;
      
      // Get 2D context for fallback
      this.ctx = this.canvas.getContext('2d')!;
      document.getElementById('rendererInfo')!.textContent = 'Canvas 2D (Fallback)';
    }
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

    this.controls = new Controls(callbacks);
  }

  private async loadApplicationData(): Promise<void> {
    try {
      this.data = await loadData();
      
      // Initialize particle system with loaded data
      this.particleSystem = new ParticleSystem(this.width, this.height);
      this.particleSystem.initialize(this.data);
      
      console.log('✅ Application data loaded and systems initialized');
    } catch (error) {
      console.error('❌ Failed to initialize application:', error);
    }
  }

  private handleResize(): void {
    this.setupCanvas();
    
    // Resize systems
    if (this.trailSystem && this.gl) {
      this.trailSystem.resize(this.width, this.height);
      this.gl.viewport(0, 0, this.width, this.height);
    }
    
    if (this.particleSystem && this.data) {
      this.particleSystem.resize(this.width, this.height, this.data);
    }
  }

  private detectCrossClusterActivity(): CrossClusterActivity[] {
    if (!this.data || !this.particleSystem) return [];
    
    // Get projects in current sliding window
    const windowStart = this.currentYear - this.WINDOW_SIZE / 2;
    const windowEnd = this.currentYear + this.WINDOW_SIZE / 2;
    
    const projectsInWindow = this.data.projects.filter(p => 
      p.year >= windowStart && p.year <= windowEnd
    );
    
    // Group by cluster
    const clusterGroups = new Map<number, typeof projectsInWindow>();
    projectsInWindow.forEach(project => {
      const clusterId = project.clusterId || project.cluster_id;
      if (!clusterGroups.has(clusterId)) {
        clusterGroups.set(clusterId, []);
      }
      clusterGroups.get(clusterId)!.push(project);
    });
    
    // Find cross-cluster activity
    const activities: CrossClusterActivity[] = [];
    const clusterIds = Array.from(clusterGroups.keys());
    
    for (let i = 0; i < clusterIds.length; i++) {
      for (let j = i + 1; j < clusterIds.length; j++) {
        const sourceId = clusterIds[i];
        const targetId = clusterIds[j];
        const sourceProjects = clusterGroups.get(sourceId)!;
        const targetProjects = clusterGroups.get(targetId)!;
        
        const activityStrength = Math.min(sourceProjects.length, targetProjects.length);
        
        if (activityStrength >= this.activityThreshold) {
          // Check cooldown
          const pathwayKey = `${Math.min(sourceId, targetId)}-${Math.max(sourceId, targetId)}`;
          const cooldown = this.pathwayCooldowns.get(pathwayKey);
          
          if (!cooldown || (this.currentYear - cooldown.lastTrigger) >= cooldown.duration) {
            activities.push({
              sourceCluster: sourceId,
              targetCluster: targetId,
              count: activityStrength
            });
            
            // Set cooldown
            this.pathwayCooldowns.set(pathwayKey, {
              lastTrigger: this.currentYear,
              duration: this.PATHWAY_COOLDOWN_DURATION
            });
            
            console.log(`🚀 Pathway detected: ${sourceId} ↔ ${targetId} (strength: ${activityStrength})`);
          }
        }
      }
    }
    
    return activities;
  }

  private createAgentSpawnData(activities: CrossClusterActivity[]): AgentSpawnData[] {
    if (!this.particleSystem) return [];
    
    const clusters = this.particleSystem.getClusters();
    const agentData: AgentSpawnData[] = [];
    
    for (const activity of activities) {
      const sourceCluster = clusters.get(activity.sourceCluster);
      const targetCluster = clusters.get(activity.targetCluster);
      
      if (!sourceCluster || !targetCluster) continue;
      
      // GPGPU can handle many more agents - scale up for performance testing
      const agentCount = Math.min(activity.count * 10, 50); // Increased significantly for GPGPU
      
      for (let i = 0; i < agentCount; i++) {
        // Start near source cluster with some randomness
        const angle = Math.random() * Math.PI * 2;
        const radius = 20;
        const startX = sourceCluster.centerX + Math.cos(angle) * radius;
        const startY = sourceCluster.centerY + Math.sin(angle) * radius;
        
        // Calculate initial velocity toward target
        const dx = targetCluster.centerX - startX;
        const dy = targetCluster.centerY - startY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        const agent: AgentSpawnData = {
          x: startX,
          y: startY,
          vx: (dx / distance) * this.AGENT_SPEED,
          vy: (dy / distance) * this.AGENT_SPEED,
          targetClusterX: targetCluster.centerX,
          targetClusterY: targetCluster.centerY,
          age: 0,
          maxAge: this.AGENT_LIFESPAN
        };
        
        agentData.push(agent);
      }
    }
    
    return agentData;
  }

  private render(): void {
    // Update particle system
    if (this.particleSystem) {
      this.particleSystem.update(this.currentYear);
    }
    
    // Detect cross-cluster activity for pathways
    const pathwayActivities = this.detectCrossClusterActivity();
    
    // Spawn agents directly into GPU textures for detected pathway activities
    if (this.gpuSystem && pathwayActivities.length > 0) {
      const agentData = this.createAgentSpawnData(pathwayActivities);
      if (agentData.length > 0) {
        this.gpuSystem.spawnAgents(agentData);
        console.log(`🧠 Spawned ${agentData.length} agents directly to GPU from ${pathwayActivities.length} pathway activities`);
      }
    }
    
    // Update GPGPU system (agent logic + trail processing entirely on GPU)
    if (this.gpuSystem && this.trailSystem) {
      const agentCount = this.gpuSystem.getActiveAgentCount();
      if (agentCount > 0) {
        console.log(`🧠 GPGPU update: ${agentCount} agents processing on GPU`);
      }
      
      // Update agents first
      this.gpuSystem.update(this.trailSystem.getTrailTexture());
      
      // Then update trails with agent deposition
      this.trailSystem.update(
        this.gpuSystem.getAgentStateTexture(),
        this.gpuSystem.getAgentTextureSize(), 
        this.gpuSystem.getActiveAgentCount()
      );
    }
    
    // Render everything
    if (this.gl && this.trailSystem && this.gpuSystem) {
      this.renderWebGL();
    } else if (this.ctx) {
      this.renderCanvas2D();
    }
    
    // Update UI
    this.updateUI();
  }

  private renderWebGL(): void {
    if (!this.gl || !this.trailSystem || !this.gpuSystem || !this.particleSystem) {
      console.warn('WebGL not available, falling back to Canvas 2D');
      this.renderCanvas2D();
      return;
    }
    
    // Clear overlay canvas for 2D elements on top of WebGL
    this.overlayCtx.clearRect(0, 0, this.width, this.height);
    
    // Render WebGL trails first (background)
    this.trailSystem.renderToCanvas();
    
    // Render GPU agents directly on WebGL canvas
    this.gpuSystem.renderToCanvas();
    
    // Render particles and clusters using overlay canvas (on top of WebGL)
    this.overlayCtx.save();
    this.particleSystem.render(this.overlayCtx, this.showParticles);
    this.overlayCtx.restore();
  }

  private renderCanvas2D(): void {
    if (!this.ctx || !this.particleSystem) return;
    
    this.ctx.clearRect(0, 0, this.width, this.height);
    
    // Render particles and clusters
    this.ctx.save();
    this.particleSystem.render(this.ctx, this.showParticles);
    
    // GPU agents not available in Canvas2D fallback mode
    // (GPGPU system requires WebGL context)
    
    this.ctx.restore();
  }

  private updateUI(): void {
    if (!this.particleSystem || !this.domUpdater) return;
    
    this.domUpdater.update({
      year: this.currentYear,
      activeParticles: this.particleSystem.getActiveParticleCount(),
      activeClusters: this.particleSystem.getActiveClusters().length,
      activeAgents: this.gpuSystem?.getActiveAgentCount() || 0
    });
  }

  private animate(): void {
    if (!this.isPlaying) return;
    
    const deltaTime = this.YEAR_DURATION / this.speed;
    this.currentYear += 1 / (deltaTime / 16.67);
    
    if (this.currentYear > this.END_YEAR) {
      this.currentYear = this.START_YEAR;
      // Reset particle states would go here if needed
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
    
    if (this.gpuSystem) {
      this.gpuSystem.dispose();
    }
    
    if (this.trailSystem) {
      this.trailSystem.dispose();
    }
  }
}

// Initialize the semantic garden visualization
new SemanticGarden();