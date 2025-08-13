interface Project {
  id: string;
  title: string;
  year: number;
  themes: string[];
  embedding: number[];
  x: number;
  y: number;
  cluster_id: number;
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

interface PersistentParticle {
  id: string;
  project: Project;
  baseX: number;
  baseY: number;
  currentX: number;
  currentY: number;
  targetX: number;
  targetY: number;
  clusterId: number;
  isActive: boolean;
  birthYear: number;
  phase: number; // For breathing animation
  size: number;
  alpha: number;
}

interface ClusterInfo {
  id: number;
  centerX: number;
  centerY: number;
  particles: PersistentParticle[];
  breathPhase: number;
  density: number;
  isActive: boolean;
}

import WebGLTrailProcessor from './webgl/WebGLTrailProcessor';
import type { AgentSpawnData } from './webgl/WebGLTrailProcessor';


class OrganicPathways {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null = null;
  private overlayCanvas: HTMLCanvasElement;
  private overlayCtx: CanvasRenderingContext2D;
  private gl: WebGLRenderingContext | null = null;
  private useWebGL: boolean = false;
  private trailProcessor: WebGLTrailProcessor | null = null;
  
  private width: number = 0;
  private height: number = 0;
  
  private data: ClusteredData | null = null;
  private currentYear: number = 1985;
  private isPlaying: boolean = false;
  private speed: number = 1;
  private animationId: number | null = null;
  private showParticles: boolean = true;
  
  // Animation parameters
  private readonly START_YEAR = 1985;
  private readonly END_YEAR = 2025;
  private readonly YEAR_DURATION = 1000; // 10x slower timeline
  private readonly MARGIN = 150;
  private readonly WINDOW_SIZE = 2; // years for sliding window
  
  // Pathway system
  private activityThreshold: number = 1; // Lowered for more pathway activity
  private readonly PATHWAY_COOLDOWN_DURATION = 5; // years
  private pathwayCooldowns: Map<string, {lastTrigger: number, duration: number}> = new Map();
  
  // Particle system
  private persistentParticles: PersistentParticle[] = [];
  private clusters: Map<number, ClusterInfo> = new Map();
  
  // GPGPU Agent System (replaces CPU FlowingAgent array)
  // All agent state now managed entirely on GPU
  private readonly MAX_AGENTS = 1024; // Scalable agent limit
  private readonly AGENT_SPEED = 2;
  private readonly AGENT_LIFESPAN = 400; // frames
  
  // Visual bounds
  private minX: number = 0;
  private maxX: number = 0;
  private minY: number = 0;
  private maxY: number = 0;
  private scaleFactor: number = 1;
  private offsetX: number = 0;
  private offsetY: number = 0;
  
  // Performance tracking
  private frameCount: number = 0;
  private lastFpsUpdate: number = 0;
  private fps: number = 60;

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
    
    // WebGL trail processing initialization handled in initializeWebGL
    
    this.setupCanvas();
    
    // Try to initialize WebGL for better performance (after canvas setup)
    this.initializeWebGL();
    this.setupControls();
    this.loadData();
    
    window.addEventListener('resize', () => this.setupCanvas());
  }

  private initializeWebGL(): void {
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
      
      this.useWebGL = true;
      console.log('✅ WebGL initialized successfully on main canvas');
      
      // Initialize GPGPU trail processor with agent system
      this.trailProcessor = new WebGLTrailProcessor(this.gl, this.width, this.height, this.MAX_AGENTS);
      console.log('✅ GPGPU Trail Processor with Agent System initialized');
      
      // Get 2D context for hybrid rendering (particles on top of WebGL)
      this.ctx = this.canvas.getContext('2d')!;
      
      document.getElementById('rendererInfo')!.textContent = 'WebGL';
    } catch (error) {
      console.log('⚠️ WebGL failed, falling back to Canvas 2D:', error);
      this.useWebGL = false;
      this.trailProcessor = null;
      
      // Now get 2D context for fallback
      this.ctx = this.canvas.getContext('2d')!;
      document.getElementById('rendererInfo')!.textContent = 'Canvas 2D (Fallback)';
    }
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
    
    // Resize WebGL trail processor if it exists
    if (this.trailProcessor) {
      this.trailProcessor.resize(this.width, this.height);
    }
    
    if (this.useWebGL && this.gl) {
      this.gl.viewport(0, 0, this.width, this.height);
    }
  }

  private setupControls(): void {
    const playPause = document.getElementById('playPause') as HTMLButtonElement;
    const speedSlider = document.getElementById('speedSlider') as HTMLInputElement;
    const speedValue = document.getElementById('speedValue') as HTMLSpanElement;
    const particlesToggle = document.getElementById('particlesToggle') as HTMLInputElement;
    
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

    particlesToggle.addEventListener('change', () => {
      this.showParticles = particlesToggle.checked;
    });
  }

  private async loadData(): Promise<void> {
    try {
      const response = await fetch('/thesis_analysis_kmeans.json');
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const projects = await response.json() as Project[];
      console.log(`🚀 Loaded ${projects.length} projects`);
      
      // Generate clusters from project data
      const clusterMap = new Map<number, Project[]>();
      projects.forEach(project => {
        if (!clusterMap.has(project.cluster_id)) {
          clusterMap.set(project.cluster_id, []);
        }
        clusterMap.get(project.cluster_id)!.push(project);
      });
      
      const clusters: ClusterData[] = [];
      clusterMap.forEach((clusterProjects, clusterId) => {
        // Calculate centroid from project positions
        const centroidX = clusterProjects.reduce((sum, p) => sum + p.x, 0) / clusterProjects.length;
        const centroidY = clusterProjects.reduce((sum, p) => sum + p.y, 0) / clusterProjects.length;
        
        // Get year range
        const years = clusterProjects.map(p => p.year);
        const yearRange: [number, number] = [Math.min(...years), Math.max(...years)];
        
        // Get top themes (simplified)
        const allThemes = clusterProjects.flatMap(p => p.themes);
        const topThemes = [...new Set(allThemes)].slice(0, 3);
        
        clusters.push({
          id: clusterId,
          centroid768d: [], // Not needed for visualization
          centroidX,
          centroidY,
          projectCount: clusterProjects.length,
          yearRange,
          topTerms: topThemes
        });
      });
      
      // Convert cluster_id to clusterId for compatibility
      const normalizedProjects = projects.map(p => ({
        ...p,
        clusterId: p.cluster_id
      }));
      
      this.data = {
        projects: normalizedProjects,
        clusters
      };
      
      console.log(`📊 Generated ${clusters.length} clusters from project data`);
      
      this.calculateBounds();
      this.initializeParticleSystem();
      this.render();
      
    } catch (error) {
      console.error('❌ Failed to load clustered data:', error);
    }
  }

  private calculateBounds(): void {
    if (!this.data) return;
    
    // Use percentile bounds to handle outliers
    const xCoords = this.data.projects.map(p => p.x).sort((a, b) => a - b);
    const yCoords = this.data.projects.map(p => p.y).sort((a, b) => a - b);
    
    const percentile = 0.02;
    const xIndex1 = Math.floor(xCoords.length * percentile);
    const xIndex2 = Math.floor(xCoords.length * (1 - percentile));
    const yIndex1 = Math.floor(yCoords.length * percentile);
    const yIndex2 = Math.floor(yCoords.length * (1 - percentile));
    
    this.minX = xCoords[xIndex1];
    this.maxX = xCoords[xIndex2];
    this.minY = yCoords[yIndex1];
    this.maxY = yCoords[yIndex2];
    
    const dataWidth = this.maxX - this.minX;
    const dataHeight = this.maxY - this.minY;
    
    const availableWidth = this.width - 2 * this.MARGIN;
    const availableHeight = this.height - 2 * this.MARGIN;
    
    const scaleX = availableWidth / dataWidth;
    const scaleY = availableHeight / dataHeight;
    this.scaleFactor = Math.min(scaleX, scaleY);
    
    const scaledWidth = dataWidth * this.scaleFactor;
    const scaledHeight = dataHeight * this.scaleFactor;
    
    this.offsetX = this.MARGIN + (availableWidth - scaledWidth) / 2 - this.minX * this.scaleFactor;
    this.offsetY = this.MARGIN + (availableHeight - scaledHeight) / 2 - this.minY * this.scaleFactor;
    
    console.log(`📐 Bounds calculated - Scale: ${this.scaleFactor.toFixed(2)} Viewport usage: ${((scaledWidth * scaledHeight) / (this.width * this.height) * 100).toFixed(1)}%`);
  }

  private worldToScreen(x: number, y: number): [number, number] {
    return [
      x * this.scaleFactor + this.offsetX,
      y * this.scaleFactor + this.offsetY
    ];
  }

  private initializeParticleSystem(): void {
    if (!this.data) return;
    
    console.log('🔥 Initializing organic particle system...');
    
    // Initialize cluster info
    for (const cluster of this.data.clusters) {
      const [centerX, centerY] = this.worldToScreen(cluster.centroidX, cluster.centroidY);
      
      this.clusters.set(cluster.id, {
        id: cluster.id,
        centerX,
        centerY,
        particles: [],
        breathPhase: Math.random() * Math.PI * 2,
        density: cluster.projectCount,
        isActive: false
      });
    }
    
    // Create persistent particles for all projects
    for (const project of this.data.projects) {
      const [baseX, baseY] = this.worldToScreen(project.x, project.y);
      
      const particle: PersistentParticle = {
        id: project.id,
        project,
        baseX,
        baseY,
        currentX: baseX,
        currentY: baseY,
        targetX: baseX,
        targetY: baseY,
        clusterId: project.clusterId,
        isActive: false,
        birthYear: project.year,
        phase: Math.random() * Math.PI * 2,
        size: 1.5 + Math.random() * 1,
        alpha: 0
      };
      
      this.persistentParticles.push(particle);
      
      // Add to cluster
      const clusterInfo = this.clusters.get(project.clusterId);
      if (clusterInfo) {
        clusterInfo.particles.push(particle);
      }
    }
    
    console.log(`✨ Created ${this.persistentParticles.length} persistent particles across ${this.clusters.size} clusters`);
    this.updatePerformanceStats();
  }

  private detectCrossClusterActivity(): Array<{sourceCluster: number, targetCluster: number, count: number}> {
    if (!this.data) return [];
    
    // Get projects in current sliding window
    const windowStart = this.currentYear - this.WINDOW_SIZE / 2;
    const windowEnd = this.currentYear + this.WINDOW_SIZE / 2;
    
    const projectsInWindow = this.data.projects.filter(p => 
      p.year >= windowStart && p.year <= windowEnd
    );
    
    // Group by cluster
    const clusterGroups = new Map<number, Project[]>();
    projectsInWindow.forEach(project => {
      if (!clusterGroups.has(project.clusterId)) {
        clusterGroups.set(project.clusterId, []);
      }
      clusterGroups.get(project.clusterId)!.push(project);
    });
    
    // Find cross-cluster activity
    const activities = [];
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

  private updateParticleSystem(): void {
    // Activate particles based on current year
    for (const particle of this.persistentParticles) {
      if (particle.birthYear <= this.currentYear && !particle.isActive) {
        particle.isActive = true;
        particle.alpha = 0.0; // Start completely invisible
      }
      
      if (particle.isActive) {
        // Update individual particle phase for breathing
        particle.phase += 0.015 + Math.random() * 0.01; // Slight randomness
        
        // Get cluster info for breathing
        const clusterInfo = this.clusters.get(particle.clusterId);
        if (clusterInfo) {
          // Combine cluster breathing with individual particle movement
          const clusterBreathe = Math.sin(clusterInfo.breathPhase) * 3; // Larger amplitude
          const individualBreathe = Math.sin(particle.phase) * 1.5; // Individual breathing
          
          // Calculate breathing offset
          const breatheRadius = clusterBreathe + individualBreathe;
          const particleAngle = particle.phase + (particle.clusterId * 0.5); // Offset by cluster
          
          particle.targetX = particle.baseX + breatheRadius * Math.cos(particleAngle);
          particle.targetY = particle.baseY + breatheRadius * Math.sin(particleAngle);
        }
        
        // Smooth movement toward target
        particle.currentX += (particle.targetX - particle.currentX) * 0.08;
        particle.currentY += (particle.targetY - particle.currentY) * 0.08;
        
        // Much slower, smoother fade-in
        const targetAlpha = 0.6 + Math.sin(particle.phase * 0.5) * 0.2; // Breathing alpha
        if (particle.alpha < targetAlpha) {
          particle.alpha += 0.003; // Much slower fade-in
        }
        
        // Breathing size variation
        particle.size = 1.5 + Math.sin(particle.phase * 0.8) * 0.5;
      }
    }
    
    // Update cluster breathing (slower, more organic)
    for (const cluster of this.clusters.values()) {
      cluster.breathPhase += 0.008 + Math.sin(cluster.id * 0.1) * 0.002; // Variable breathing rates
      
      // Activate cluster when it has active particles
      cluster.isActive = cluster.particles.some(p => p.isActive);
    }
  }

  private renderCanvas2D(): void {
    this.ctx.clearRect(0, 0, this.width, this.height);
    
    // Render cluster boundaries (minimal)
    this.ctx.save();
    for (const cluster of this.clusters.values()) {
      if (!cluster.isActive) continue;
      
      this.ctx.beginPath();
      this.ctx.arc(cluster.centerX, cluster.centerY, 3, 0, 2 * Math.PI);
      this.ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
      this.ctx.fill();
      
      // Very subtle cluster outline
      const radius = Math.sqrt(cluster.density) * 8;
      this.ctx.beginPath();
      this.ctx.arc(cluster.centerX, cluster.centerY, radius, 0, 2 * Math.PI);
      this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
      this.ctx.lineWidth = 1;
      this.ctx.stroke();
    }
    
    // Render dense particle clouds with breathing effects (if enabled)
    if (this.showParticles) {
      this.ctx.save();
      
      for (const particle of this.persistentParticles) {
      if (!particle.isActive || particle.alpha < 0.01) continue;
      
      const clusterHue = (particle.clusterId * 137.508) % 360;
      const dynamicAlpha = particle.alpha * (0.8 + Math.sin(particle.phase * 0.3) * 0.2);
      
      // Main particle
      this.ctx.beginPath();
      this.ctx.arc(particle.currentX, particle.currentY, particle.size, 0, 2 * Math.PI);
      this.ctx.fillStyle = `hsla(${clusterHue}, 70%, 65%, ${dynamicAlpha})`;
      this.ctx.fill();
      
      // Add breathing glow effect
      if (particle.alpha > 0.3) {
        const glowSize = particle.size + Math.sin(particle.phase) * 1;
        const glowAlpha = dynamicAlpha * 0.3;
        
        this.ctx.beginPath();
        this.ctx.arc(particle.currentX, particle.currentY, glowSize, 0, 2 * Math.PI);
        this.ctx.fillStyle = `hsla(${clusterHue}, 80%, 80%, ${glowAlpha})`;
        this.ctx.fill();
        
        // Soft outer glow for density effect
        this.ctx.shadowColor = `hsla(${clusterHue}, 70%, 70%, ${glowAlpha * 0.5})`;
        this.ctx.shadowBlur = 6;
        this.ctx.fill();
        this.ctx.shadowBlur = 0;
      }
      
      this.ctx.restore();
    }
  }    
    // Render pathway trails
    this.renderPathwayTrails();
    
    // GPU agents not available in Canvas2D fallback mode
    // (GPGPU system requires WebGL context)
    
    this.ctx.restore();
  }

  private renderPathwayTrails(): void {
    // GPGPU approach: Render trails using GPU trail processor
    if (this.trailProcessor && this.useWebGL) {
      this.trailProcessor.renderTrailsToCanvas();
    }
  }

  private renderGPUAgents(): void {
    // GPGPU approach: Render all agents directly from GPU state in a single draw call
    if (this.trailProcessor && this.useWebGL) {
      this.trailProcessor.renderAgentsToCanvas();
    }
  }

  private renderWebGL(): void {
    if (!this.gl || !this.trailProcessor) {
      console.warn('WebGL not available, falling back to Canvas 2D');
      this.renderCanvas2D();
      return;
    }
    
    // Clear overlay canvas for 2D elements on top of WebGL
    this.overlayCtx.clearRect(0, 0, this.width, this.height);
    
    // Render particles and clusters using overlay canvas (on top of WebGL trails)
    this.overlayCtx.save();
    
    // Render WebGL trails first (background)
    this.renderPathwayTrails();
    
    // Render cluster boundaries (minimal) on overlay
    for (const cluster of this.clusters.values()) {
      if (!cluster.isActive) continue;
      
      this.overlayCtx.beginPath();
      this.overlayCtx.arc(cluster.centerX, cluster.centerY, 3, 0, 2 * Math.PI);
      this.overlayCtx.fillStyle = 'rgba(255, 255, 255, 0.3)';
      this.overlayCtx.fill();
      
      // Very subtle cluster outline
      const radius = Math.sqrt(cluster.density) * 8;
      this.overlayCtx.beginPath();
      this.overlayCtx.arc(cluster.centerX, cluster.centerY, radius, 0, 2 * Math.PI);
      this.overlayCtx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
      this.overlayCtx.lineWidth = 1;
      this.overlayCtx.stroke();
    }
    
    // Render particles if enabled on overlay
    if (this.showParticles) {
      for (const particle of this.persistentParticles) {
        if (!particle.isActive || particle.alpha < 0.01) continue;
        
        const clusterHue = (particle.clusterId * 137.508) % 360;
        const dynamicAlpha = particle.alpha * (0.8 + Math.sin(particle.phase * 0.3) * 0.2);
        
        // Main particle
        this.overlayCtx.beginPath();
        this.overlayCtx.arc(particle.currentX, particle.currentY, particle.size, 0, 2 * Math.PI);
        this.overlayCtx.fillStyle = `hsla(${clusterHue}, 70%, 65%, ${dynamicAlpha})`;
        this.overlayCtx.fill();
        
        // Add breathing glow effect
        if (particle.alpha > 0.3) {
          const glowSize = particle.size + Math.sin(particle.phase) * 1;
          const glowAlpha = dynamicAlpha * 0.3;
          
          this.overlayCtx.beginPath();
          this.overlayCtx.arc(particle.currentX, particle.currentY, glowSize, 0, 2 * Math.PI);
          this.overlayCtx.fillStyle = `hsla(${clusterHue}, 80%, 80%, ${glowAlpha})`;
          this.overlayCtx.fill();
          
          // Soft outer glow for density effect
          this.overlayCtx.shadowColor = `hsla(${clusterHue}, 70%, 70%, ${glowAlpha * 0.5})`;
          this.overlayCtx.shadowBlur = 6;
          this.overlayCtx.fill();
          this.overlayCtx.shadowBlur = 0;
        }
      }
    }
    
    // Render GPU agents directly on WebGL canvas (not overlay)
    this.renderGPUAgents();
    
    this.overlayCtx.restore();
  }

  private updatePerformanceStats(): void {
    const now = performance.now();
    this.frameCount++;
    
    if (now - this.lastFpsUpdate > 1000) {
      this.fps = Math.round((this.frameCount * 1000) / (now - this.lastFpsUpdate));
      this.frameCount = 0;
      this.lastFpsUpdate = now;
      
      document.getElementById('fpsCounter')!.textContent = this.fps.toString();
    }
    
    const activeParticles = this.persistentParticles.filter(p => p.isActive).length;
    const activeClusters = Array.from(this.clusters.values()).filter(c => c.isActive).length;
    
    document.getElementById('particleCount')!.textContent = activeParticles.toString();
    document.getElementById('clusterCount')!.textContent = activeClusters.toString();
  }

  private updateYearDisplay(): void {
    const yearDisplay = document.getElementById('yearDisplay') as HTMLElement;
    yearDisplay.textContent = Math.floor(this.currentYear).toString();
  }

  private spawnGPUAgents(activities: Array<{sourceCluster: number, targetCluster: number, count: number}>): void {
    if (!this.trailProcessor) {
      console.warn('⚠️ GPGPU processor not available - cannot spawn agents');
      return;
    }
    
    const agentData: AgentSpawnData[] = [];
    const currentAgentCount = this.trailProcessor.getActiveAgentCount();
    let spawnedCount = 0;
    
    for (const activity of activities) {
      const sourceCluster = this.clusters.get(activity.sourceCluster);
      const targetCluster = this.clusters.get(activity.targetCluster);
      
      if (!sourceCluster || !targetCluster) continue;
      
      // GPGPU can handle many more agents - scale up for performance testing
      const agentCount = Math.min(activity.count * 10, 50); // Increased significantly for GPGPU
      
      for (let i = 0; i < agentCount; i++) {
        // Check if we have space for more agents
        if (currentAgentCount + spawnedCount >= this.trailProcessor.getMaxAgents()) {
          console.warn(`🚫 Max agents (${this.trailProcessor.getMaxAgents()}) reached`);
          break;
        }
        
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
        spawnedCount++;
      }
    }
    
    if (agentData.length > 0) {
      // Spawn all agents directly into GPU textures
      this.trailProcessor.spawnAgents(agentData);
      console.log(`🧠 Spawned ${agentData.length} agents directly to GPU from ${activities.length} pathway activities`);
    }
  }

  // CPU Agent methods removed - all agent processing now handled by GPGPU shaders
  // updateFlowingAgents() -> replaced by trailProcessor.updateGPU()
  // applyPhysarumSteering() -> replaced by GPGPU agent_update shader
  // batchSampleTrailStrength() -> eliminated (no more CPU-GPU synchronization)

  // depositTrail method removed - now handled by WebGL processor

  private updateGPUSystem(): void {
    // GPGPU system handles agent update, trail decay, and trail deposition entirely on GPU
    if (this.trailProcessor && this.useWebGL) {
      const agentCount = this.trailProcessor.getActiveAgentCount();
      if (agentCount > 0) {
        console.log(`🧠 GPGPU update: ${agentCount} agents processing on GPU`);
      }
      this.trailProcessor.updateGPU();
    } else {
      console.warn('⚠️ GPGPU processor not available');
    }
  }

  private getClusterColor(clusterId: number): string {
    const hue = (clusterId * 137.508) % 360;
    return `hsl(${hue}, 70%, 60%)`;
  }

  private render(): void {
    this.updateParticleSystem();
    
    // Detect cross-cluster activity for pathways
    const pathwayActivities = this.detectCrossClusterActivity();
    
    // Spawn agents directly into GPU textures for detected pathway activities
    this.spawnGPUAgents(pathwayActivities);
    
    // Update GPGPU system (agent logic + trail processing entirely on GPU)
    this.updateGPUSystem();
    
    if (this.useWebGL) {
      this.renderWebGL();
    } else {
      this.renderCanvas2D();
    }
    
    this.updatePerformanceStats();
    this.updateYearDisplay();
  }

  private animate(): void {
    if (!this.isPlaying) return;
    
    const deltaTime = this.YEAR_DURATION / this.speed;
    this.currentYear += 1 / (deltaTime / 16.67);
    
    if (this.currentYear > this.END_YEAR) {
      this.currentYear = this.START_YEAR;
      // Reset particle states
      for (const particle of this.persistentParticles) {
        particle.isActive = false;
        particle.alpha = 0;
      }
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
    if (this.trailProcessor) {
      this.trailProcessor.dispose();
    }
  }
}

// Initialize the organic pathways visualization
new OrganicPathways();