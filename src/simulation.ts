import type { ClusteredData, AgentSpawnData, Bridge } from './data/interfaces';
import { ParticleSystem } from './systems/ParticleSystem';
import { GPUSystem } from './systems/GPUSystem';

export class Simulation {
  private particleSystem: ParticleSystem;
  private gpuSystem: GPUSystem;
  private data: ClusteredData;
  private bridgeData: Bridge[];

  // Building bridge data into the simulation at the start
  private pathwayLastHighlighted: Map<string, number> = new Map(); // Maps "source-target" to first appearance year

  // Simulation state
  public currentYear: number = 1981; // Start year

  // Animation parameters (moved from SemanticGarden)
  public readonly START_YEAR = 1981;
  public readonly END_YEAR = 2025;
  public readonly YEAR_DURATION = 20000;

  // Zeitgeist Model - Projects are only active for a limited time window
  public readonly PROJECT_ACTIVE_WINDOW_YEARS = 5.0; // Projects fade after this period

  // Agent hierarchy configuration
  private readonly ECOSYSTEM_BRIGHTNESS = 0.3; // Dim brightness for background ecosystem agents
  private readonly FRONTIER_BRIGHTNESS = 1.0; // Full brightness for protagonist Frontier agents

  // Scoring weights for selecting Frontier agents
  private readonly W_RECENCY = 1.5;
  private readonly W_INTENSITY = 1.0;
  private readonly W_BRIDGE_BUILDING = 0.5;

  // Agent configuration
  private readonly AGENT_SPEED = 1.5;
  private readonly MAX_TOTAL_AGENTS = 350;
  private readonly MAX_AGENTS_PER_FRAME = 10;
  private readonly MIN_SPAWN_SIMILARITY = 0.68; // Minimum similarity score to consider spawning an agent, CAN TWEAK THIS
  // --- New Lifespan Controls ---
  private readonly ECOSYSTEM_LIFESPAN_MIN = 100; // frames
  private readonly ECOSYSTEM_LIFESPAN_MAX = 4000; // frames
  private readonly FRONTIER_LIFESPAN_MIN = 8000; // frames
  private readonly FRONTIER_LIFESPAN_MAX = 12500; // frames

  // Canvas dimensions for bounds checking
  private width: number;
  private height: number;

  private lastYearProcessed: number = 0;

  constructor(
    particleSystem: ParticleSystem,
    gpuSystem: GPUSystem,
    data: ClusteredData,
    bridgeData: Bridge[],
    width: number,
    height: number
  ) {
    this.particleSystem = particleSystem;
    this.gpuSystem = gpuSystem;
    this.data = data;
    this.bridgeData = bridgeData;
    this.width = width;
    this.height = height;
  }

  public resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }

  public update(): void {

    // --- SECTION 1: PER-FRAME LOGIC ---

    // Update particle system with temporal window
    this.particleSystem.update(this.currentYear, this.PROJECT_ACTIVE_WINDOW_YEARS);

    // Clean up expired frontier agent counts periodically
    this.cleanupFrontierAgents();


    // --- SECTION 2: YEARLY TICK LOGIC ---
    // We have already processed this year, so we don't spawn new agents.
    const currentSimYear = Math.floor(this.currentYear);
    if (currentSimYear <= this.lastYearProcessed) return;
  

    // Detect cross-cluster activity for pathways
    let bridgesInWindow = this.findBridgesInWindow();
    if (bridgesInWindow.length === 0) return; // Nothing to do if there are no active bridges


    // --- 2. Apply the Hard Caps ---
    const currentAgentCount = this.gpuSystem.getActiveAgentCount();
    const availableSlots = this.MAX_TOTAL_AGENTS - currentAgentCount;

    if (bridgesInWindow.length > availableSlots) {
      // If we have more potential spawns than available slots,
      // prioritize the best ones by sorting by similarity score.
      bridgesInWindow.sort((a, b) => b.similarity_score - a.similarity_score);
      bridgesInWindow = bridgesInWindow.slice(0, availableSlots);
    }

    if (bridgesInWindow.length > this.MAX_AGENTS_PER_FRAME) {
      // Further cap the number of spawns in this single frame.
      bridgesInWindow = bridgesInWindow.slice(0, this.MAX_AGENTS_PER_FRAME);
    }

    // --- 3. Proceed with the (now strictly limited) list of bridges ---
    const frontierBridge = this.selectFrontierBridge(bridgesInWindow);
    const ecosystemBridges = bridgesInWindow.filter(b => b !== frontierBridge);

    // Spawn agents directly into GPU textures for detected pathway activities
    const agentSpawns = this.createAgentSpawnData(frontierBridge, ecosystemBridges);

    if (agentSpawns.length > 0) this.gpuSystem.spawnAgents(agentSpawns);

    // Mark this year as processed.
    this.lastYearProcessed = currentSimYear;
  }

  private calculateRecencyScore(sourceCluster: number, targetCluster: number): number {
    const key = this.createPathwayKey(sourceCluster, targetCluster);
    if (!this.pathwayLastHighlighted.has(key)) {
      return 1.0; // Max score for brand new pathways.
    }

    const lastHighlightedYear = this.pathwayLastHighlighted.get(key)!;
    const yearsSinceHighlighted = this.currentYear - lastHighlightedYear;

    if (yearsSinceHighlighted < 1.0) return 0.0;

    // Use a logarithmic scale. A 25-year dormancy is like new again.
    const recencyScore = Math.log(1.0 + yearsSinceHighlighted) / Math.log(25.0);
    return Math.max(0.0, Math.min(recencyScore, 1.0));
  }

  private calculateBridgeBuildingScore(sourceClusterId: number, targetClusterId: number): number {
    const clusters = this.particleSystem.getClusters();
    const sourceCluster = clusters.get(sourceClusterId);
    const targetCluster = clusters.get(targetClusterId);

    if (!sourceCluster || !targetCluster) return 0.0;

    const dx = sourceCluster.centerX - targetCluster.centerX;
    const dy = sourceCluster.centerY - targetCluster.centerY;
    const distance = Math.hypot(dx, dy);

    // Normalize by the max possible distance (diagonal of the canvas).
    const maxDistance = Math.hypot(this.width, this.height);
    return distance / maxDistance;
  }

  private selectFrontierBridge(bridgesInWindow: Bridge[]): Bridge | null {
    if (bridgesInWindow.length === 0) {
      return null;
    }

    let frontierBridge: Bridge | null = null;
    let highestScore = -Infinity;

    // Evaluate each bridge and find the one with the highest combined score
    for (const bridge of bridgesInWindow) {
      // Calculate recency score - how long since this pathway was last highlighted
      const recencyScore = this.calculateRecencyScore(bridge.source_cluster, bridge.target_cluster);

      // Intensity score comes directly from the bridge similarity data
      const intensityScore = bridge.similarity_score;

      // Bridge building score - favors connections between distant clusters
      const bridgeBuildingScore = this.calculateBridgeBuildingScore(bridge.source_cluster, bridge.target_cluster);

      // Combine all scores using weighted formula
      const finalScore = (recencyScore * this.W_RECENCY) +
        (intensityScore * this.W_INTENSITY) +
        (bridgeBuildingScore * this.W_BRIDGE_BUILDING);

      // Track the bridge with the highest score
      if (finalScore > highestScore) {
        highestScore = finalScore;
        frontierBridge = bridge;
      }
    }

    // Record that this pathway just got highlighted
    if (frontierBridge) {
      const key = this.createPathwayKey(frontierBridge.source_cluster, frontierBridge.target_cluster);
      this.pathwayLastHighlighted.set(key, this.currentYear);
    }

    return frontierBridge;
  }

  /**
   * Detects cross-cluster activities based on project data and bridge data.
   * Filters the bridges dats to return only those bridges whose year falls within the currentYear's active window.
   */
  private findBridgesInWindow(): Bridge[] {
    const windowStart = this.currentYear - this.PROJECT_ACTIVE_WINDOW_YEARS;
    const windowEnd = this.currentYear;

    const bridgesInTime = this.bridgeData.filter(bridge =>
      bridge.year >= windowStart && bridge.year <= windowEnd
    );

    const highQualityBridges = bridgesInTime.filter(b => b.similarity_score > this.MIN_SPAWN_SIMILARITY);

    // TEMPORARY DEBUG LOG
    if (highQualityBridges.length > 0) {
      console.log(`Year ${Math.floor(this.currentYear)}: Found ${highQualityBridges.length} high-quality bridges.`);
    }

    return highQualityBridges;
  }

  // This creates a unique sorted key for each pathway / source-target pair
  private createPathwayKey(sourceCluster: number, targetCluster: number): string {
    return `${Math.min(sourceCluster, targetCluster)}-${Math.max(sourceCluster, targetCluster)}`;
  }

  private buildAgentData(
    bridge: Bridge,
    isFrontier: boolean,
    projectPositions: Map<string, { x: number; y: number }>,
    clusterCentroids: Map<number, any>
  ): AgentSpawnData | null {
    const sourcePosition = projectPositions.get(bridge.project_id.toString());
    const targetCentroid = clusterCentroids.get(bridge.target_cluster);

    // If we can't find coordinates, we cannot create an agent.
    if (!sourcePosition || !targetCentroid) {
      console.warn(`Could not find screen positions for bridge from project ${bridge.project_id}.`);
      return null;
    }

    // Give agents a more noisy starting position
    sourcePosition.x += (Math.random() - 0.5) * 50; // Random offset in x
    sourcePosition.y += (Math.random() - 0.5) * 50; // Random offset in y

    // Off set AGENT_SPEED to have some variation in velocity ( default is 1.5, offset by -0.25 to +0.25 )
    const AGENT_SPEED = this.AGENT_SPEED + (Math.random() - 0.5) * 0.5; // Random offset in speed

    // --- Physics ---
    const dx = targetCentroid.centerX - sourcePosition.x;
    const dy = targetCentroid.centerY - sourcePosition.y;
    const distance = Math.hypot(dx, dy) || 1;
    const vx = (dx / distance) * AGENT_SPEED;
    const vy = (dy / distance) * AGENT_SPEED;

    // --- Visuals ---
    const clusterHue = (bridge.source_cluster * 137.508) % 360;

    // --- UI & Narrative (only for Frontier agents) ---
    let directive_verb: string | undefined;
    let directive_noun: string | undefined;
    let projectTitle: string | undefined;

    if (isFrontier) {
      directive_verb = this.getRandomDirectiveVerb();
      directive_noun = this.getDirectiveNoun(bridge.target_cluster);
      
      // Find the project title
      const project = this.data.projects.find(p => parseInt(p.id) === bridge.project_id);
      projectTitle = project ? project.title : `Project ${bridge.project_id}`;
    }

    let maxAge: number;
    (isFrontier) ? maxAge = this.FRONTIER_LIFESPAN_MIN + Math.random() * (this.FRONTIER_LIFESPAN_MAX - this.FRONTIER_LIFESPAN_MIN)
      : maxAge = this.ECOSYSTEM_LIFESPAN_MIN + Math.random() * (this.ECOSYSTEM_LIFESPAN_MAX - this.ECOSYSTEM_LIFESPAN_MIN);

    return {
      x: sourcePosition.x,
      y: sourcePosition.y,
      vx: vx,
      vy: vy,
      targetClusterX: targetCentroid.centerX,
      targetClusterY: targetCentroid.centerY,
      age: 0,
      maxAge: maxAge,
      isFrontier: isFrontier,
      brightness: isFrontier ? this.FRONTIER_BRIGHTNESS : this.ECOSYSTEM_BRIGHTNESS,
      clusterHue: clusterHue,
      sourceClusterId: bridge.source_cluster,
      targetClusterId: bridge.target_cluster,
      directive_verb: directive_verb,
      directive_noun: directive_noun,
      projectTitle: projectTitle,
    };
  }

  /**
   * Gets the primary theme for a cluster and truncates it.
   */
  private getDirectiveNoun(targetClusterId: number): string {
    const MAX_LABEL_WORDS = 5;
    const targetClusterData = this.data.clusters.find(c => c.id === targetClusterId);
    let noun = targetClusterData?.topTerms[0] || `cluster ${targetClusterId}`;

    if (noun.split(' ').length > MAX_LABEL_WORDS) {
      noun = noun.split(' ').slice(0, MAX_LABEL_WORDS).join(' ') + '...';
    }
    return noun;
  }

  /**
   * Returns a random verb for a Frontier agent's directive.
   */
  private getRandomDirectiveVerb(): string {
    const choices = [
      'seeking', 'exploring', 'navigating', 'pursuing', 'musing over',
      'pondering', 'examining', 'reflecting on', 'considering', 'contemplating'
    ];
    return choices[Math.floor(Math.random() * choices.length)];
  }


  private createAgentSpawnData(frontierBridge: Bridge | null, ecosystemBridges: Bridge[]): AgentSpawnData[] {
    // Initialize the array to collect all agent spawn data
    const allSpawnData: AgentSpawnData[] = [];

    // Get scaled xy positions and cluster centroids from the particle system
    const projectScreenPositions = this.particleSystem.getProjectScreenPositions();
    const clusterCentroids = this.particleSystem.getClusters();
    // Get existing frontier agent labels to avoid duplicates
    const currentMirrors = this.gpuSystem.getFrontierAgentMirrors();
    const existingNouns = new Set(currentMirrors.map(m => m.directive_noun));

    // Process the Frontier Agent (protagonist agent with highest priority)
    if (frontierBridge) {
      const noun = this.getDirectiveNoun(frontierBridge.target_cluster);

      // Gatekeeper checks: determine if this bridge *qualifies* to create a Frontier Agent
      const canBeFrontier = currentMirrors.length < 10 && !existingNouns.has(noun);

      // The agent's role (and its data) is determined by the gatekeeper checks
      const agentData = this.buildAgentData(
        frontierBridge,
        canBeFrontier,
        projectScreenPositions,
        clusterCentroids
      );

      if (agentData) allSpawnData.push(agentData);
    }

    // Process all Ecosystem Agents
    for (const bridge of ecosystemBridges) {
      const agentData = this.buildAgentData(
        bridge,
        false, // Ecosystem bridges can not be Frontier agents
        projectScreenPositions,
        clusterCentroids
      );

      if (agentData) allSpawnData.push(agentData);
    }
    // Return all collected spawn data
    return allSpawnData;
  }

  // TODO: Implement cleanup logic for Frontier agents
  // Clean up frontier agent tracking when agents die
  private cleanupFrontierAgents(): void {

  }
}
