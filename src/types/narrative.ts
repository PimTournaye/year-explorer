/**
 * Type definitions for mycelial narrative system
 */

export interface ProjectHighlight {
  id: string;
  title: string;
  year: number;
  role: "pioneer" | "connector" | "outlier" | "synthesizer" | "disruptor";
  significance: string;
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