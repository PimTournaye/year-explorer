/**
 * Type definitions for mycelial narrative system
 */

export interface MycelialNarrative {
  id: string;
  type: "propagation" | "convergence" | "die_off" | "mutation" | "resurrection" | "parasitic_takeover";
  title: string;
  conceptIds: string[];
  timespan: [number, number];
  story: NarrativeStory;
  visualSequence: VisualMoment[];
  ambientMode: AmbientConfiguration;
}

export interface NarrativeStory {
  overview: string;
  chapters: Chapter[];
  climax: string;
  resolution: string;
  themes: string[];
}

export interface Chapter {
  period: [number, number];
  title: string;
  description: string;
  keyProjects: ProjectHighlight[];
  languageEvolution: string[];
  visualFocus: "expansion" | "contraction" | "drift" | "merge" | "split";
}

export interface ProjectHighlight {
  id: string;
  title: string;
  year: number;
  role: "pioneer" | "connector" | "outlier" | "synthesizer" | "disruptor";
  significance: string;
}

export interface VisualMoment {
  timestamp: number; // Seconds into ambient cycle
  action: "highlight_cluster" | "show_connections" | "language_cloud" | "frontier_expansion";
  targets: string[]; // Project IDs or cluster IDs
  duration: number;
  parameters: Record<string, any>;
}

export interface AmbientConfiguration {
  cycleDuration: number; // Total seconds for this narrative
  breathingRate: number; // Expansion/contraction cycles per minute
  colorProgression: string[]; // Hex colors for timeline progression
  languageCloudTiming: number[]; // When to show terminology evolution
}

export interface Project {
  id: string;
  title: string;
  year: number;
  text: string;
  embedding: number[];
  x: number;
  y: number;
}

export interface NarrativeSummary {
  totalNarratives: number;
  narrativeTypes: string[];
  totalCycleDuration: number;
  conceptsCovered: string[];
  timespan: [number, number];
  generatedOn: string;
}