import type { ClusteredData, CrossClusterActivity, AgentSpawnData } from './data/interfaces';
import { ParticleSystem } from './systems/ParticleSystem';
import { GPUSystem } from './systems/GPUSystem';

export class Simulation {
  private particleSystem: ParticleSystem;
  private gpuSystem: GPUSystem;
  private data: ClusteredData;

  // Simulation state
  public currentYear: number = 1985;

  // Animation parameters (moved from SemanticGarden)
  public readonly START_YEAR = 1985;
  public readonly END_YEAR = 2025;
  public readonly YEAR_DURATION = 12000; // 12 seconds per year for contemplative pacing

  // Zeitgeist Model - Projects are only active for a limited time window
  public readonly PROJECT_ACTIVE_WINDOW_YEARS = 5.0; // Projects fade after this period

  // Pathway system configuration
  private activityThreshold: number = 1; // Lowered for more pathway activity
  private readonly PATHWAY_COOLDOWN_DURATION = 5; // years
  private pathwayCooldowns: Map<string, {lastTrigger: number, duration: number}> = new Map();

  // Agent hierarchy configuration
  private readonly FRONTIER_AGENT_RATIO = 0.25; // 25% of agents are Frontier agents (increased since we limit to active clusters)
  private readonly MAX_FRONTIER_AGENTS_PER_CLUSTER = 2; // Reduced - only active clusters get frontier agents
  private readonly ECOSYSTEM_BRIGHTNESS = 0.3; // Dim brightness for background ecosystem agents
  private readonly FRONTIER_BRIGHTNESS = 1.0; // Full brightness for protagonist Frontier agents

  // Track frontier agents per cluster
  private frontierAgentCounts: Map<number, number> = new Map();

  // Agent configuration
  private readonly AGENT_SPEED = 1.5;
  private readonly AGENT_LIFESPAN = 4000; // frames

  // Canvas dimensions for bounds checking
  private width: number;
  private height: number;

  constructor(
    particleSystem: ParticleSystem,
    gpuSystem: GPUSystem,
    data: ClusteredData,
    width: number,
    height: number
  ) {
    this.particleSystem = particleSystem;
    this.gpuSystem = gpuSystem;
    this.data = data;
    this.width = width;
    this.height = height;
  }

  public resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }

  public update(): void {
    // Update particle system with Zeitgeist temporal window
    this.particleSystem.update(this.currentYear, this.PROJECT_ACTIVE_WINDOW_YEARS);

    // Detect cross-cluster activity for pathways
    const pathwayActivities = this.detectCrossClusterActivity();

    // Spawn agents directly into GPU textures for detected pathway activities
    // Add a check to prevent a "big bang" on the very first frame.
    if (pathwayActivities.length > 0 && this.currentYear > this.START_YEAR) {
      const agentData = this.createAgentSpawnData(pathwayActivities);
      if (agentData.length > 0) {
        this.gpuSystem.spawnAgents(agentData);
      }
    }

    // Clean up expired frontier agent counts periodically
    this.cleanupFrontierAgentCounts();
  }

  private detectCrossClusterActivity(): CrossClusterActivity[] {
    if (!this.data || !this.particleSystem) return [];

    // Zeitgeist Model - Projects are only active within the temporal window
    // Projects older than PROJECT_ACTIVE_WINDOW_YEARS fade from the simulation
    const projectsInWindow = this.data.projects.filter(p =>
      p.year >= (this.currentYear - this.PROJECT_ACTIVE_WINDOW_YEARS) &&
      p.year <= this.currentYear
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
          }
        }
      }
    }

    return activities;
  }

  private createAgentSpawnData(activities: CrossClusterActivity[]): AgentSpawnData[] {
    const clusters = this.particleSystem.getClusters();
    const agentData: AgentSpawnData[] = [];
    const themesInThisBatch = new Set<string>(); // Frame-specific check to prevent duplicates in the same batch

    for (const activity of activities) {
      const sourceCluster = clusters.get(activity.sourceCluster);
      const targetCluster = clusters.get(activity.targetCluster);

      if (!sourceCluster || !targetCluster) continue;
      
      // Only create frontier agents for active clusters (constellation state)
      if (!sourceCluster.isActive || !targetCluster.isActive) continue;

      // Get cluster data for topTerms
      const sourceClusterData = this.data.clusters.find(c => c.id === activity.sourceCluster);
      const targetClusterData = this.data.clusters.find(c => c.id === activity.targetCluster);

      if (!sourceClusterData || !targetClusterData) continue;

      // Step 1.1: Fix the "Big Bang" Narrative Spawning
      // The number of agents must be proportional to the data's activity in the *current* time window.
      const projectsInWindow = this.data.projects.filter(p =>
        p.year >= (this.currentYear - this.PROJECT_ACTIVE_WINDOW_YEARS) &&
        p.year <= this.currentYear
      );

      const sourceProjectsInWindow = projectsInWindow.filter(p => (p.clusterId || p.cluster_id) === activity.sourceCluster);
      const targetProjectsInWindow = projectsInWindow.filter(p => (p.clusterId || p.cluster_id) === activity.targetCluster);

      const currentActivityStrength = Math.min(sourceProjectsInWindow.length, targetProjectsInWindow.length);
      
      // If currentActivityStrength is 0, spawn zero agents for that pathway.
      const agentCount = currentActivityStrength; // Direct proportion
      if (agentCount === 0) {
        continue;
      }

      // Track how many frontier agents we can create for this cluster
      const sourceFrontierCount = this.frontierAgentCounts.get(activity.sourceCluster) || 0;
      let availableFrontierSlots = Math.max(0, this.MAX_FRONTIER_AGENTS_PER_CLUSTER - sourceFrontierCount);

      for (let i = 0; i < agentCount; i++) {
        // Start near source cluster with some randomness
        const angle = Math.random() * Math.PI * 2;
        const radius = 20 + Math.random() * 30; // Spawn in a wider, more organic radius
        const startX = Math.max(0, Math.min(this.width, sourceCluster.centerX + Math.cos(angle) * radius));
        const startY = Math.max(0, Math.min(this.height, sourceCluster.centerY + Math.sin(angle) * radius));
        

        // Calculate initial velocity toward target (20% slower)
        const dx = targetCluster.centerX - startX;
        const dy = targetCluster.centerY - startY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // Controlled Frontier vs Ecosystem assignment
        let isFrontier = false;
        let label: string | undefined;

        const canBeFrontier = Math.random() < this.FRONTIER_AGENT_RATIO 
                           && availableFrontierSlots > 0
                           && this.gpuSystem.getFrontierAgentMirrors().length < 10;

        if (canBeFrontier) {
          const targetTheme = targetClusterData.topTerms[0] || `cluster ${activity.targetCluster}`;
          
          // Check if a label with the same theme already exists (globally and in this batch)
          const themeExistsGlobally = this.gpuSystem.getFrontierAgentMirrors().some(agent => agent.label.endsWith(targetTheme));
          const themeExistsInBatch = themesInThisBatch.has(targetTheme);

          if (!themeExistsGlobally && !themeExistsInBatch) {
            // All clear, create a unique Frontier agent
            isFrontier = true;
            themesInThisBatch.add(targetTheme); // Reserve this theme for this batch
            
            // Randomly choose between "seeking" and "exploring"
            const prefix = Math.random() < 0.5 ? "seeking" : "exploring";
            label = `${prefix}: ${targetTheme}`;

            // Truncate long labels
            if (label.split(' ').length > 5) {
              label = label.split(' ').slice(0, 5).join(' ') + '...';
            }
          }
        }

        if (isFrontier) {
          availableFrontierSlots--;
          this.frontierAgentCounts.set(activity.sourceCluster, (this.frontierAgentCounts.get(activity.sourceCluster) || 0) + 1);
        }

        // Calculate cluster hue for trail coloring (using golden ratio for nice distribution)
        const clusterHue = (activity.sourceCluster * 137.508) % 360;

        const agent: AgentSpawnData = {
          x: startX,
          y: startY,
          vx: (dx / distance) * this.AGENT_SPEED * 0.4, // Much slower movement
          vy: (dy / distance) * this.AGENT_SPEED * 0.4, // Much slower movement
          targetClusterX: targetCluster.centerX,
          targetClusterY: targetCluster.centerY,
          age: 0,
          maxAge: this.AGENT_LIFESPAN,
          // Agent hierarchy properties
          isFrontier: isFrontier,
          brightness: isFrontier ? this.FRONTIER_BRIGHTNESS : this.ECOSYSTEM_BRIGHTNESS,
          // Trail color properties
          clusterHue: clusterHue,
          // Label data for Frontier agents
          sourceClusterId: activity.sourceCluster,
          targetClusterId: activity.targetCluster,
          label: label
        };

        agentData.push(agent);
      }
    }

    return agentData;
  }

  // Clean up frontier agent tracking when agents die
  private cleanupFrontierAgentCounts(): void {
    // Reset frontier counts periodically (every few frames)
    // In a more sophisticated system, we'd track individual agent deaths
    if (Math.random() < 0.1) { // 10% chance per frame to reset counts
      this.frontierAgentCounts.clear();
    }
  }
}
