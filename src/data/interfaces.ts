// Centralized TypeScript interfaces for the Semantic Garden application

export interface Project {
  id: string;
  title: string;
  year: number;
  themes: string[];
  embedding: number[];
  x: number;
  y: number;
  cluster_id: number;
  clusterId?: number; // For compatibility
}

export interface ClusterData {
  id: number;
  centroid768d: number[];
  centroidX: number;
  centroidY: number;
  projectCount: number;
  yearRange: [number, number];
  topTerms: string[];
}

export interface ClusteredData {
  projects: Project[];
  clusters: ClusterData[];
}

export interface PersistentParticle {
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

export interface ClusterInfo {
  id: number;
  centerX: number;
  centerY: number;
  particles: PersistentParticle[];
  breathPhase: number;
  density: number;
  isActive: boolean;
}

// GPU Agent System interfaces
export interface AgentSpawnData {
  x: number;
  y: number;
  vx: number;
  vy: number;
  targetClusterX: number;
  targetClusterY: number;
  age: number;
  maxAge: number;
  spawnYear: number; // NEW: Track when this agent was born in simulation time
  // Hierarchy properties
  isFrontier: boolean; // true = Frontier agent (bright, visible), false = Ecosystem agent (dim)
  brightness: number; // 0.0-1.0, visual prominence
  // Trail color properties for subtle "dye" effect
  clusterHue: number; // 0.0-360.0, hue for cluster-based trail coloring
  // Label data (only used for Frontier agents)
  sourceClusterId?: number;
  targetClusterId?: number;
  directive_verb?: string; // e.g., "seeking", "pondering"
  directive_noun?: string; // e.g., "social engines"
  projectTitle?: string; // Title of the project this agent represents
  sourceClusterName?: string; // Name/subject of the source cluster
  sourceClusterColor?: string; // Color of the source cluster (if protagonist)
}

// CPU Mirror for Frontier agents (for label rendering)
export interface FrontierAgentMirror {
  targetY: number;
  targetX: number;
  id: number; // Index in GPU texture
  x: number;
  y: number;
  vx: number; // Velocity X for physics sync
  vy: number; // Velocity Y for physics sync
  age: number;
  maxAge: number;
  sourceClusterId: number;
  targetClusterId: number;
  directive_verb: string; // e.g., "seeking", "pondering"
  directive_noun: string; // e.g., "social engines"
  projectTitle: string; // Title of the project this agent represents
  sourceClusterName: string; // Name/subject of the source cluster
  sourceClusterColor: string; // Color of the source cluster (if protagonist)
  isActive: boolean;
}

export interface CrossClusterActivity {
  sourceCluster: number;
  targetCluster: number;
  count: number;
}

export interface Project {
  id: string;
  title: string;
  year: number;
  text: string;
  x: number;
  y: number;
}

export interface Bridge {
    project_id: number,
    year: number,
    source_cluster: number,
    target_cluster: number,
    similarity_score: number
}