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

interface FlowingAgent {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  sourceCluster: number;
  targetCluster: number;
  age: number;
  maxAge: number;
  trailStrength: number;
  color: string;
}

interface PathwayTrail {
  points: Array<{x: number, y: number, strength: number, age: number}>;
  decay: number;
}

class OrganicPathways {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private gl: WebGLRenderingContext | null = null;
  private useWebGL: boolean = false;
  
  private width: number;
  private height: number;
  
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
  private activityThreshold: number = 3;
  private readonly PATHWAY_COOLDOWN_DURATION = 5; // years
  private pathwayCooldowns: Map<string, {lastTrigger: number, duration: number}> = new Map();
  
  // Particle system
  private persistentParticles: PersistentParticle[] = [];
  private clusters: Map<number, ClusterInfo> = new Map();
  
  // Flowing pathway system (physarum-inspired)
  private flowingAgents: FlowingAgent[] = [];
  private pathwayTrails: Map<string, PathwayTrail> = new Map();
  private readonly AGENT_SPEED = 2;
  private readonly AGENT_LIFESPAN = 400; // frames
  private readonly TRAIL_DECAY = 0.995;
  
  // Sebastian Lague approach: Trail texture
  private trailCanvas: HTMLCanvasElement;
  private trailCtx: CanvasRenderingContext2D;
  
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
    this.ctx = this.canvas.getContext('2d')!;
    
    // Create trail texture canvas (Sebastian Lague approach)
    this.trailCanvas = document.createElement('canvas');
    this.trailCtx = this.trailCanvas.getContext('2d')!;
    
    // Try to initialize WebGL for better performance
    this.initializeWebGL();
    
    this.setupCanvas();
    this.setupControls();
    this.loadData();
    
    window.addEventListener('resize', () => this.setupCanvas());
  }

  private initializeWebGL(): void {
    try {
      console.log('🔍 Attempting WebGL initialization...');
      
      // Check WebGL support first
      const canvas = document.createElement('canvas');
      const glContext = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      
      if (!glContext) {
        throw new Error('WebGL context creation failed');
      }
      
      console.log('✅ WebGL context created successfully');
      console.log('📊 WebGL Info:', {
        version: glContext.getParameter(glContext.VERSION),
        vendor: glContext.getParameter(glContext.VENDOR),
        renderer: glContext.getParameter(glContext.RENDERER)
      });
      
      this.gl = this.canvas.getContext('webgl') || this.canvas.getContext('experimental-webgl');
      if (this.gl) {
        this.useWebGL = true;
        console.log('✅ WebGL initialized successfully on main canvas');
        document.getElementById('rendererInfo')!.textContent = 'WebGL';
      } else {
        throw new Error('WebGL context failed on main canvas');
      }
    } catch (error) {
      console.log('⚠️ WebGL failed, falling back to Canvas 2D:', error);
      this.useWebGL = false;
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
    
    // Setup trail texture canvas
    this.trailCanvas.width = this.width;
    this.trailCanvas.height = this.height;
    
    // Initialize trail canvas with black background
    this.trailCtx.fillStyle = 'black';
    this.trailCtx.fillRect(0, 0, this.width, this.height);
    
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
      const response = await fetch('./projects-with-embeddings-clustered.json');
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      this.data = await response.json() as ClusteredData;
      console.log(`🚀 Loaded ${this.data.projects.length} projects and ${this.data.clusters.length} clusters`);
      
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
    
    // Render flowing agents
    this.renderFlowingAgents();
    
    this.ctx.restore();
  }

  private renderPathwayTrails(): void {
    // Sebastian Lague approach: Draw the trail texture to main canvas
    this.ctx.save();
    this.ctx.globalCompositeOperation = 'lighter'; // Additive blending for glow effect
    this.ctx.drawImage(this.trailCanvas, 0, 0);
    this.ctx.restore();
  }

  private renderFlowingAgents(): void {
    this.ctx.save();
    
    for (const agent of this.flowingAgents) {
      const lifeProgress = agent.age / agent.maxAge;
      const alpha = 1 - lifeProgress; // Fade out over time
      
      // Main agent particle
      this.ctx.beginPath();
      this.ctx.arc(agent.x, agent.y, 3, 0, 2 * Math.PI);
      this.ctx.fillStyle = agent.color.replace('60%)', `60%, ${alpha})`);
      this.ctx.fill();
      
      // Directional indicator (small tail)
      const tailLength = 8;
      const tailX = agent.x - Math.cos(agent.angle) * tailLength;
      const tailY = agent.y - Math.sin(agent.angle) * tailLength;
      
      this.ctx.beginPath();
      this.ctx.moveTo(agent.x, agent.y);
      this.ctx.lineTo(tailX, tailY);
      this.ctx.strokeStyle = agent.color.replace('60%)', `60%, ${alpha * 0.5})`);
      this.ctx.lineWidth = 1;
      this.ctx.stroke();
    }
    
    this.ctx.restore();
  }

  private renderWebGL(): void {
    if (!this.gl) return;
    
    // TODO: Implement WebGL shader-based rendering
    // For now, fall back to Canvas 2D
    this.renderCanvas2D();
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

  private spawnFlowingAgents(activities: Array<{sourceCluster: number, targetCluster: number, count: number}>): void {
    for (const activity of activities) {
      const sourceCluster = this.clusters.get(activity.sourceCluster);
      const targetCluster = this.clusters.get(activity.targetCluster);
      
      if (!sourceCluster || !targetCluster) continue;
      
      // Spawn limited agents per pathway (as per brief)
      const agentCount = Math.min(activity.count, 3); // Max 3 agents per pathway
      
      for (let i = 0; i < agentCount; i++) {
        // Start near source cluster with some randomness
        const angle = Math.random() * Math.PI * 2;
        const radius = 20;
        const startX = sourceCluster.centerX + Math.cos(angle) * radius;
        const startY = sourceCluster.centerY + Math.sin(angle) * radius;
        
        // Calculate initial direction toward target
        const dx = targetCluster.centerX - startX;
        const dy = targetCluster.centerY - startY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        const agent: FlowingAgent = {
          id: `${activity.sourceCluster}-${activity.targetCluster}-${Date.now()}-${i}`,
          x: startX,
          y: startY,
          vx: (dx / distance) * this.AGENT_SPEED,
          vy: (dy / distance) * this.AGENT_SPEED,
          angle: Math.atan2(dy, dx),
          sourceCluster: activity.sourceCluster,
          targetCluster: activity.targetCluster,
          age: 0,
          maxAge: this.AGENT_LIFESPAN,
          trailStrength: 1.0,
          color: this.getClusterColor(activity.sourceCluster)
        };
        
        this.flowingAgents.push(agent);
      }
    }
  }

  private updateFlowingAgents(): void {
    this.flowingAgents = this.flowingAgents.filter(agent => {
      agent.age++;
      
      // Remove old agents
      if (agent.age > agent.maxAge) {
        return false;
      }
      
      // Physarum-inspired steering behavior
      this.applyPhysarumSteering(agent);
      
      // Move agent
      agent.x += agent.vx;
      agent.y += agent.vy;
      
      // Deposit trail
      this.depositTrail(agent);
      
      return true;
    });
  }

  private applyPhysarumSteering(agent: FlowingAgent): void {
    const targetCluster = this.clusters.get(agent.targetCluster);
    if (!targetCluster) return;
    
    // Sensor angles (left, forward, right)
    const sensorAngle = Math.PI / 4; // 45 degrees
    const sensorDistance = 15;
    
    const leftAngle = agent.angle - sensorAngle;
    const rightAngle = agent.angle + sensorAngle;
    
    // Sensor positions
    const sensors = [
      { // Left sensor
        x: agent.x + Math.cos(leftAngle) * sensorDistance,
        y: agent.y + Math.sin(leftAngle) * sensorDistance,
        angle: leftAngle
      },
      { // Forward sensor
        x: agent.x + Math.cos(agent.angle) * sensorDistance,
        y: agent.y + Math.sin(agent.angle) * sensorDistance,
        angle: agent.angle
      },
      { // Right sensor
        x: agent.x + Math.cos(rightAngle) * sensorDistance,
        y: agent.y + Math.sin(rightAngle) * sensorDistance,
        angle: rightAngle
      }
    ];
    
    // Sample trail strength at sensor positions
    const sensorReadings = sensors.map(sensor => this.sampleTrailStrength(sensor.x, sensor.y));
    
    // Add attraction to target cluster
    const dx = targetCluster.centerX - agent.x;
    const dy = targetCluster.centerY - agent.y;
    const targetDistance = Math.sqrt(dx * dx + dy * dy);
    const targetAngle = Math.atan2(dy, dx);
    
    // Weight target attraction (stronger when far, weaker when close)
    const targetWeight = Math.min(targetDistance / 200, 1.0) * 0.3;
    
    // Add target attraction to sensor readings
    sensors.forEach((sensor, i) => {
      const angleDiff = Math.abs(sensor.angle - targetAngle);
      const attraction = Math.cos(angleDiff) * targetWeight;
      sensorReadings[i] += attraction;
    });
    
    // Decision making based on sensor readings
    const [left, forward, right] = sensorReadings;
    const turnStrength = 0.1;
    
    if (forward > left && forward > right) {
      // Continue forward
    } else if (left > right) {
      // Turn left
      agent.angle -= turnStrength;
    } else if (right > left) {
      // Turn right
      agent.angle += turnStrength;
    } else {
      // Random turn when confused
      agent.angle += (Math.random() - 0.5) * turnStrength;
    }
    
    // Update velocity based on new angle
    agent.vx = Math.cos(agent.angle) * this.AGENT_SPEED;
    agent.vy = Math.sin(agent.angle) * this.AGENT_SPEED;
  }

  private sampleTrailStrength(x: number, y: number): number {
    // Sebastian Lague approach: Sample the trail texture directly
    try {
      const imageData = this.trailCtx.getImageData(Math.floor(x), Math.floor(y), 1, 1);
      const [r, g, b] = imageData.data;
      
      // Convert RGB to brightness (trail strength)
      const brightness = (r + g + b) / (3 * 255);
      return brightness;
    } catch (error) {
      return 0; // Return 0 if sampling outside canvas bounds
    }
  }

  private depositTrail(agent: FlowingAgent): void {
    // Sebastian Lague approach: Draw directly to trail texture
    const clusterHue = (agent.sourceCluster * 137.508) % 360;
    
    this.trailCtx.save();
    this.trailCtx.globalCompositeOperation = 'lighter'; // Additive blending
    this.trailCtx.fillStyle = `hsla(${clusterHue}, 70%, 70%, 0.1)`; // Low opacity deposit
    
    // Draw small circle at agent position
    this.trailCtx.beginPath();
    this.trailCtx.arc(agent.x, agent.y, 2, 0, 2 * Math.PI);
    this.trailCtx.fill();
    
    this.trailCtx.restore();
  }

  private updatePathwayTrails(): void {
    // Sebastian Lague approach: Decay the entire trail texture
    this.trailCtx.save();
    this.trailCtx.globalCompositeOperation = 'multiply';
    this.trailCtx.fillStyle = 'rgba(0, 0, 0, 0.02)'; // Very slight darkening each frame
    this.trailCtx.fillRect(0, 0, this.width, this.height);
    this.trailCtx.restore();
  }

  private getClusterColor(clusterId: number): string {
    const hue = (clusterId * 137.508) % 360;
    return `hsl(${hue}, 70%, 60%)`;
  }

  private render(): void {
    this.updateParticleSystem();
    
    // Detect cross-cluster activity for pathways
    const pathwayActivities = this.detectCrossClusterActivity();
    
    // Create flowing agents for detected pathway activities
    this.spawnFlowingAgents(pathwayActivities);
    this.updateFlowingAgents();
    this.updatePathwayTrails();
    
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
}

// Initialize the organic pathways visualization
new OrganicPathways();