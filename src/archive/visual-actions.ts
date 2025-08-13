/**
 * Visual Actions System - Implements mycelial network effects
 */

import * as PIXI from 'pixi.js';
import { gsap } from 'gsap';
import type { VisualMoment, Project } from './types/narrative.js';

export interface VisualActionSystem {
  highlightCluster(projectIds: string[], parameters: any): void;
  showConnections(projectIds: string[], parameters: any): void;
  languageCloud(terms: string[], parameters: any): void;
  frontierExpansion(projectIds: string[], parameters: any): void;
  breathingEffect(intensity: number): void;
  setColorProgression(colors: string[], progress: number): void;
}

export class MycelialVisualActions implements VisualActionSystem {
  private app: PIXI.Application;
  private projectDots: Map<string, PIXI.Graphics>;
  private projects: Project[];
  private connectionLines!: PIXI.Graphics; // Initialized in initializeConnectionLines
  private languageText!: PIXI.Text; // Initialized in initializeLanguageDisplay
  private breathingTween: gsap.core.Tween | null = null;
  private activeHighlights: Set<string> = new Set();
  
  // Coordinate normalization bounds (calculated once on init)
  private coordBounds = { minX: 0, maxX: 0, minY: 0, maxY: 0 };

  // Visual constants
  private readonly COLORS = {
    BACKGROUND: 0xf1f5f9,
    DOT_DEFAULT: 0x101d43,
    DOT_HIGHLIGHT: 0xdb4135,
    DOT_AMBIENT: 0xecb92e,
    CONNECTION: 0x666666,
    TEXT: 0x000000
  };

  private readonly DOT_SIZE = {
    DEFAULT: 2.5,
    HIGHLIGHTED: 6.0,
    FRONTIER: 7.0
  };

  constructor(app: PIXI.Application, projectDots: Map<string, PIXI.Graphics>, projects: Project[]) {
    this.app = app;
    this.projectDots = projectDots;
    this.projects = projects;
    
    // Calculate coordinate bounds for normalization
    this.calculateCoordinateBounds();
    
    this.initializeConnectionLines();
    this.initializeLanguageDisplay();
  }

  /**
   * Calculate coordinate bounds for proper normalization
   */
  private calculateCoordinateBounds() {
    const validProjects = this.projects.filter(p => 
      p.x !== undefined && p.y !== undefined && !isNaN(p.x) && !isNaN(p.y)
    );
    
    if (validProjects.length === 0) {
      this.coordBounds = { minX: -1, maxX: 1, minY: -1, maxY: 1 };
      return;
    }
    
    const xValues = validProjects.map(p => p.x);
    const yValues = validProjects.map(p => p.y);
    
    this.coordBounds = {
      minX: Math.min(...xValues),
      maxX: Math.max(...xValues),
      minY: Math.min(...yValues),
      maxY: Math.max(...yValues)
    };
  }

  /**
   * Convert project coordinates to screen coordinates
   */
  private projectToScreen(x: number, y: number): { x: number, y: number } {
    const margin = 50;
    const usableWidth = this.app.screen.width - (margin * 2);
    const usableHeight = this.app.screen.height - (margin * 2);
    
    const normalizedX = (x - this.coordBounds.minX) / (this.coordBounds.maxX - this.coordBounds.minX);
    const normalizedY = (y - this.coordBounds.minY) / (this.coordBounds.maxY - this.coordBounds.minY);
    
    return {
      x: margin + (normalizedX * usableWidth),
      y: margin + (normalizedY * usableHeight)
    };
  }

  /**
   * Initialize connection lines graphics
   */
  private initializeConnectionLines() {
    this.connectionLines = new PIXI.Graphics();
    this.connectionLines.alpha = 0;
    this.app.stage.addChild(this.connectionLines);
  }

  /**
   * Initialize language evolution display
   */
  private initializeLanguageDisplay() {
    this.languageText = new PIXI.Text({
      text: '',
      style: {
        fontFamily: 'Inter',
        fontSize: 24,
        fontWeight: 'bold',
        fill: this.COLORS.TEXT,
        align: 'center',
        wordWrap: true,
        wordWrapWidth: 400
      }
    });
    
    this.languageText.anchor.set(0.5);
    this.languageText.x = this.app.screen.width - 250;
    this.languageText.y = this.app.screen.height / 2;
    this.languageText.alpha = 0;
    this.app.stage.addChild(this.languageText);
  }

  /**
   * Highlight a cluster of projects
   */
  highlightCluster(projectIds: string[], parameters: any) {
    const intensity = parameters.intensity || 0.8;
    let color = this.COLORS.DOT_HIGHLIGHT;
    
    if (parameters.color) {
      try {
        if (parameters.color.startsWith('#')) {
          const hexValue = parameters.color.replace('#', '');
          const parsedColor = parseInt(hexValue, 16);
          
          // Validate that it's a valid 24-bit color
          if (!isNaN(parsedColor) && parsedColor >= 0 && parsedColor <= 0xFFFFFF) {
            color = parsedColor;
          }
        } else if (typeof parameters.color === 'number' && 
                   parameters.color >= 0 && parameters.color <= 0xFFFFFF) {
          color = parameters.color;
        }
      } catch (error) {
        console.warn('Color conversion error in highlightCluster:', parameters.color, error);
      }
    }
    
    const duration = parameters.duration || 1.5;

    // First, fade all non-highlighted dots
    const allDots = Array.from(this.projectDots.values());
    const highlightedDots = projectIds
      .map(id => this.projectDots.get(id))
      .filter(dot => dot !== undefined) as PIXI.Graphics[];

    // Update active highlights
    this.activeHighlights.clear();
    projectIds.forEach(id => this.activeHighlights.add(id));

    // Fade out non-highlighted dots
    const nonHighlightedDots = allDots.filter(dot => !highlightedDots.includes(dot));
    
    // Set tint directly for non-highlighted dots
    nonHighlightedDots.forEach(dot => {
      try {
        dot.tint = 0x888888;
      } catch (error) {
        console.warn('Non-highlighted tint error:', error);
        dot.tint = this.COLORS.DOT_DEFAULT;
      }
    });
    
    gsap.to(nonHighlightedDots, {
      duration: duration * 0.5,
      pixi: { 
        alpha: 0.15, 
        scale: this.DOT_SIZE.DEFAULT * 0.7
      },
      ease: 'power2.out'
    });

    // Highlight selected dots
    if (highlightedDots.length > 0) {
      // Set tint directly to avoid GSAP color conversion issues
      highlightedDots.forEach(dot => {
        try {
          dot.tint = color;
        } catch (error) {
          console.warn('Direct tint error:', color, error);
          dot.tint = this.COLORS.DOT_HIGHLIGHT;
        }
      });
      
      gsap.to(highlightedDots, {
        duration: duration,
        pixi: { 
          alpha: intensity, 
          scale: this.DOT_SIZE.HIGHLIGHTED
        },
        ease: 'elastic.out(1, 0.5)',
        delay: duration * 0.2
      });
    }

    // Removed console logging - handled by main app
  }

  /**
   * Show connections between projects
   */
  showConnections(projectIds: string[], parameters: any) {
    const connectionAlpha = parameters.alpha || 0.3;
    const connectionWidth = parameters.width || 1;
    const duration = parameters.duration || 2.0;

    this.connectionLines.clear();
    this.connectionLines.lineStyle(connectionWidth, this.COLORS.CONNECTION, connectionAlpha);

    // Get project positions
    const projectPositions = projectIds
      .map(id => {
        const project = this.projects.find(p => p.id === id);
        return project ? { x: project.x, y: project.y, id } : null;
      })
      .filter(pos => pos !== null) as Array<{x: number, y: number, id: string}>;

    // Draw connections between nearby projects (mycelial spreading)
    for (let i = 0; i < projectPositions.length; i++) {
      for (let j = i + 1; j < projectPositions.length; j++) {
        const pos1 = projectPositions[i];
        const pos2 = projectPositions[j];
        
        // Only connect if projects are reasonably close
        const distance = Math.sqrt((pos1.x - pos2.x) ** 2 + (pos1.y - pos2.y) ** 2);
        if (distance < 1.0) { // Adjusted threshold for actual coordinate system
          // Convert to screen coordinates using proper normalization
          const screen1 = this.projectToScreen(pos1.x, pos1.y);
          const screen2 = this.projectToScreen(pos2.x, pos2.y);
          
          this.connectionLines.moveTo(screen1.x, screen1.y);
          this.connectionLines.lineTo(screen2.x, screen2.y);
        }
      }
    }

    // Animate connection appearance
    gsap.fromTo(this.connectionLines, 
      { alpha: 0 },
      { 
        alpha: connectionAlpha, 
        duration: duration,
        ease: 'power2.inOut' 
      }
    );

    // Auto-hide connections after duration
    gsap.to(this.connectionLines, {
      alpha: 0,
      duration: duration * 0.5,
      delay: duration * 1.5,
      ease: 'power2.out'
    });

    // Removed console logging - handled by main app
  }

  /**
   * Display language evolution cloud
   */
  languageCloud(terms: string[], parameters: any) {
    const duration = parameters.duration || 3.0;
    const fadeInDuration = duration * 0.3;
    const fadeOutDuration = duration * 0.3;
    const displayDuration = duration * 0.4;

    // Format terms for display - ensure we have actual strings
    let validTerms: string[] = [];
    if (Array.isArray(terms)) {
      validTerms = terms.filter(term => typeof term === 'string' && term.length > 0);
    }
    
    // If no valid terms, check parameters for terms
    if (validTerms.length === 0 && parameters.terms && Array.isArray(parameters.terms)) {
      validTerms = parameters.terms.filter((term: any) => typeof term === 'string' && term.length > 0);
    }
    
    const displayText = validTerms.length > 0 ? validTerms.join(' → ') : 'Language Evolution';
    this.languageText.text = displayText;

    // Animate language cloud appearance
    gsap.timeline()
      .to(this.languageText, {
        alpha: 0.9,
        duration: fadeInDuration,
        ease: 'power2.out'
      })
      .to(this.languageText, {
        alpha: 0.9,
        duration: displayDuration,
        ease: 'none'
      })
      .to(this.languageText, {
        alpha: 0,
        duration: fadeOutDuration,
        ease: 'power2.in'
      });

    // Removed console logging - handled by main app
  }

  /**
   * Show frontier expansion effect
   */
  frontierExpansion(projectIds: string[], parameters: any) {
    const duration = parameters.duration || 2.5;
    const pulseCount = parameters.pulses || 3;

    const frontierDots = projectIds
      .map(id => this.projectDots.get(id))
      .filter(dot => dot !== undefined) as PIXI.Graphics[];

    if (frontierDots.length === 0) return;

    // Create expansion effect
    frontierDots.forEach((dot, index) => {
      // Stagger the expansion
      const delay = (index / frontierDots.length) * duration * 0.3;
      
      // Create pulsing effect
      for (let pulse = 0; pulse < pulseCount; pulse++) {
        const pulseDelay = delay + (pulse * duration / pulseCount);
        
        gsap.fromTo(dot, 
          { 
            pixi: { 
              scale: this.DOT_SIZE.DEFAULT,
              alpha: 0.8 
            } 
          },
          {
            pixi: { 
              scale: this.DOT_SIZE.FRONTIER,
              alpha: 1.0,
              tint: this.COLORS.DOT_AMBIENT 
            },
            duration: duration / (pulseCount * 2),
            delay: pulseDelay,
            ease: 'power2.out',
            yoyo: true,
            repeat: 1
          }
        );
      }
    });

    // Removed console logging - handled by main app
  }

  /**
   * Apply breathing effect to entire visualization
   */
  breathingEffect(intensity: number) {
    if (this.breathingTween) {
      this.breathingTween.kill();
    }

    const breathingScale = 1 + (intensity * 0.1); // Subtle scaling
    const breathingDuration = 3.0 / intensity; // Slower breathing for lower intensity

    // Apply to all currently active highlights
    const activeDots = Array.from(this.activeHighlights)
      .map(id => this.projectDots.get(id))
      .filter(dot => dot !== undefined) as PIXI.Graphics[];

    if (activeDots.length > 0) {
      this.breathingTween = gsap.to(activeDots, {
        pixi: { scale: breathingScale },
        duration: breathingDuration,
        ease: 'sine.inOut',
        yoyo: true,
        repeat: -1
      });
    }
  }

  /**
   * Set color progression based on narrative timeline
   */
  setColorProgression(colors: string[], progress: number) {
    if (colors.length < 2) return;

    // Calculate current color based on progress
    const scaledProgress = progress * (colors.length - 1);
    const colorIndex = Math.floor(scaledProgress);

    const currentColor = colors[Math.min(colorIndex, colors.length - 1)];

    // Apply color progression to active highlights
    let currentColorInt: number;
    try {
      if (currentColor.startsWith('#')) {
        const hexValue = currentColor.replace('#', '');
        currentColorInt = parseInt(hexValue, 16);
        
        // Validate that it's a valid 24-bit color
        if (isNaN(currentColorInt) || currentColorInt < 0 || currentColorInt > 0xFFFFFF) {
          throw new Error(`Invalid hex color: ${currentColor}`);
        }
      } else {
        currentColorInt = this.COLORS.DOT_HIGHLIGHT; // Fallback
      }
    } catch (error) {
      console.warn('Color conversion error in setColorProgression:', currentColor, error);
      currentColorInt = this.COLORS.DOT_HIGHLIGHT; // Fallback
    }
    
    const activeDots = Array.from(this.activeHighlights)
      .map(id => this.projectDots.get(id))
      .filter(dot => dot !== undefined) as PIXI.Graphics[];

    if (activeDots.length > 0) {
      // Use PIXI.Color to ensure proper color handling
      activeDots.forEach(dot => {
        try {
          dot.tint = currentColorInt;
        } catch (error) {
          console.warn('PIXI tint error:', currentColorInt, error);
          dot.tint = this.COLORS.DOT_HIGHLIGHT;
        }
      });
    }
  }

  /**
   * Reset all visual effects
   */
  resetAll() {
    // Reset all dots to default state
    const allDots = Array.from(this.projectDots.values());
    
    // Set tint directly to avoid GSAP issues
    allDots.forEach(dot => {
      try {
        dot.tint = this.COLORS.DOT_DEFAULT;
      } catch (error) {
        console.warn('Reset tint error:', error);
      }
    });
    
    gsap.to(allDots, {
      duration: 1.0,
      pixi: { 
        alpha: 0.6,
        scale: this.DOT_SIZE.DEFAULT
      },
      ease: 'power2.out'
    });

    // Clear connections and language
    gsap.to(this.connectionLines, { alpha: 0, duration: 0.5 });
    gsap.to(this.languageText, { alpha: 0, duration: 0.5 });

    // Clear active highlights
    this.activeHighlights.clear();

    // Kill breathing effect
    if (this.breathingTween) {
      this.breathingTween.kill();
      this.breathingTween = null;
    }
  }

  /**
   * Update screen size
   */
  onResize() {
    // Recalculate coordinate bounds for new screen size
    this.calculateCoordinateBounds();
    
    // Update language text position
    this.languageText.x = this.app.screen.width - 250;
    this.languageText.y = this.app.screen.height / 2;
  }

  /**
   * Execute visual action from narrative sequence
   */
  executeAction(action: VisualMoment) {
    switch (action.action) {
      case 'highlight_cluster':
        this.highlightCluster(action.targets, action.parameters);
        break;
      case 'show_connections':
        this.showConnections(action.targets, action.parameters);
        break;
      case 'language_cloud':
        // Extract terms from parameters or use targets as terms
        const terms = action.parameters.terms || action.targets;
        this.languageCloud(terms, action.parameters);
        break;
      case 'frontier_expansion':
        this.frontierExpansion(action.targets, action.parameters);
        break;
      default:
        console.warn(`Unknown visual action: ${action.action}`);
    }
  }
}