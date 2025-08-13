/**
 * Mycelial Gallery - Interactive visualization of ITP technology narratives
 * Completely rebuilt for narrative-driven ambient mode
 */

import * as PIXI from 'pixi.js';
import { gsap } from 'gsap';
import { PixiPlugin } from 'gsap/PixiPlugin.js';

// Register PixiPlugin with GSAP
PixiPlugin.registerPIXI(PIXI);
gsap.registerPlugin(PixiPlugin);
import './style.css';

// Import narrative system
import { NarrativeSequencer } from './narrative-sequencer.js';
import type { NarrativeState } from './narrative-sequencer.js';
import { MycelialVisualActions } from './visual-actions.js';
import type { MycelialNarrative, Project, VisualMoment } from './types/narrative.js';

// --- Constants & Config ---
const COLORS = {
  BACKGROUND: 0xf1f5f9, // Light gray
  DOT_DEFAULT: 0x101d43, // Blue
  DOT_HIGHLIGHT: 0xdb4135, // Red
  DOT_AMBIENT: 0xecb92e,   // Yellow
  TEXT: 0x000000,
  UI_BACKGROUND: 0xffffff,
  UI_BORDER: 0xcccccc
};

const DOT_SIZE = {
  DEFAULT: 2.5,
  HIGHLIGHTED: 5.0
};

// --- Main Application Class ---
class MycelialGalleryApp {
  private app: PIXI.Application;
  private projects: Project[] = [];
  private projectDots: Map<string, PIXI.Graphics> = new Map();
  private container: PIXI.Container;
  private narrativeSequencer: NarrativeSequencer;
  private visualActions!: MycelialVisualActions; // Initialized in initializeNarrativeSystem
  private narratives: MycelialNarrative[] = [];
  
  // UI Elements
  private contextWindow: PIXI.Container;
  private narrativeTitle!: PIXI.Text; // Initialized in createContextWindow
  private chapterText!: PIXI.Text; // Initialized in createContextWindow
  private progressBar!: PIXI.Graphics; // Initialized in createContextWindow
  private queryText!: PIXI.Text; // Initialized in createQueryDisplay
  private controlPanel: PIXI.Container;
  private isControlsVisible = false;
  private speedButtons: PIXI.Container;
  
  // Debug status
  private debugWindow: PIXI.Container;
  private debugText!: PIXI.Text;
  private showDebug = false;

  constructor() {
    this.app = new PIXI.Application();
    this.container = new PIXI.Container();
    this.narrativeSequencer = new NarrativeSequencer();
    this.contextWindow = new PIXI.Container();
    this.controlPanel = new PIXI.Container();
    this.speedButtons = new PIXI.Container();
    this.debugWindow = new PIXI.Container();
  }

  async init() {
    await this.app.init({
      backgroundColor: COLORS.BACKGROUND,
      resizeTo: window,
      antialias: true,
    });
    document.getElementById('app-container')?.appendChild(this.app.canvas);
    this.app.stage.addChild(this.container);

    this.log('🌱 Initializing Mycelial Gallery...');

    // Load data
    await this.loadData();
    
    // Initialize UI components
    this.initializeUI();
    
    // Initialize narrative system
    await this.initializeNarrativeSystem();
    
    // Give UI time to settle before starting animations
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Hide loading message
    const loadingMessage = document.getElementById('loading-message');
    if (loadingMessage) {
      loadingMessage.style.display = 'none';
    }
    
    // Start the experience
    this.start();
    
    this.log('🎭 Mycelial Gallery initialized successfully');
  }

  /**
   * Load all required data files
   */
  private async loadData() {
    try {
      // Load base project data
      this.log('Loading project data...');
      const projectsResponse = await fetch('./public/projects-with-embeddings.json');
      if (!projectsResponse.ok) {
        throw new Error(`Failed to load projects: ${projectsResponse.status}`);
      }
      this.projects = await projectsResponse.json();
      this.log(`📊 Loaded ${this.projects.length} projects`);

      // Load narrative data
      this.log('Loading narrative data...');
      const narrativesResponse = await fetch('/public/mycelial-narratives.json');
      if (!narrativesResponse.ok) {
        throw new Error(`Failed to load narratives: ${narrativesResponse.status}`);
      }
      this.narratives = await narrativesResponse.json();
      this.log(`📖 Loaded ${this.narratives.length} narratives`);

      // Load narrative summary (optional, for future use)
      try {
        await fetch('/narrative-summary.json');
      } catch (error) {
        this.log('⚠️ Could not load narrative summary (optional)');
      }
      
    } catch (error) {
      console.error('❌ Failed to load data:', error);
      throw error;
    }
  }

  /**
   * Initialize UI components
   */
  private initializeUI() {
    this.createProjectDots();
    this.createContextWindow();
    this.createControlPanel();
    this.createQueryDisplay();
    this.createDebugWindow();
    this.setupEventListeners();
  }

  /**
   * Create visual dots for all projects
   */
  private createProjectDots() {
    this.log('🎨 Creating project visualizations...');
    
    // First pass: find coordinate bounds for proper normalization
    const validProjects = this.projects.filter(p => 
      p.x !== undefined && p.y !== undefined && !isNaN(p.x) && !isNaN(p.y)
    );
    
    if (validProjects.length === 0) {
      this.log('❌ No valid coordinates found in projects data');
      return;
    }
    
    const xValues = validProjects.map(p => p.x);
    const yValues = validProjects.map(p => p.y);
    const minX = Math.min(...xValues);
    const maxX = Math.max(...xValues);
    const minY = Math.min(...yValues);
    const maxY = Math.max(...yValues);
    
    this.log(`📊 Coordinate ranges: X(${minX.toFixed(2)} to ${maxX.toFixed(2)}), Y(${minY.toFixed(2)} to ${maxY.toFixed(2)})`);
    
    // Add margin to prevent dots from being too close to edges
    const margin = 50;
    const usableWidth = this.app.screen.width - (margin * 2);
    const usableHeight = this.app.screen.height - (margin * 2);
    
    validProjects.forEach(project => {
      const dot = new PIXI.Graphics();
      dot.circle(0, 0, DOT_SIZE.DEFAULT);
      dot.fill({ color: COLORS.DOT_DEFAULT, alpha: 0.6 });
      
      // Normalize coordinates to screen space with margins
      const normalizedX = (project.x - minX) / (maxX - minX);
      const normalizedY = (project.y - minY) / (maxY - minY);
      
      const screenX = margin + (normalizedX * usableWidth);
      const screenY = margin + (normalizedY * usableHeight);
      
      dot.x = screenX;
      dot.y = screenY;
      
      // Store reference
      this.projectDots.set(project.id, dot);
      this.container.addChild(dot);
    });

    this.log(`✨ Created ${this.projectDots.size} project dots`);
  }

  /**
   * Create context window showing current narrative status
   */
  private createContextWindow() {
    // Background
    const background = new PIXI.Graphics();
    background.roundRect(0, 0, 400, 120, 8);
    background.fill({ color: COLORS.UI_BACKGROUND, alpha: 0.9 });
    background.stroke({ color: COLORS.UI_BORDER, width: 1, alpha: 0.5 });
    this.contextWindow.addChild(background);

    // Narrative title
    this.narrativeTitle = new PIXI.Text({
      text: 'Initializing Mycelial Garden...',
      style: {
        fontFamily: 'Inter',
        fontSize: 18,
        fontWeight: 'bold',
        fill: COLORS.TEXT
      }
    });
    this.narrativeTitle.x = 16;
    this.narrativeTitle.y = 16;
    this.contextWindow.addChild(this.narrativeTitle);

    // Chapter text
    this.chapterText = new PIXI.Text({
      text: '',
      style: {
        fontFamily: 'Inter',
        fontSize: 14,
        fill: COLORS.TEXT,
        wordWrap: true,
        wordWrapWidth: 368
      }
    });
    this.chapterText.x = 16;
    this.chapterText.y = 44;
    this.contextWindow.addChild(this.chapterText);

    // Progress bar
    this.progressBar = new PIXI.Graphics();
    this.contextWindow.addChild(this.progressBar);

    // Position context window
    this.contextWindow.x = 20;
    this.contextWindow.y = 20;
    this.app.stage.addChild(this.contextWindow);
  }

  /**
   * Create control panel
   */
  private createControlPanel() {
    // Background
    const background = new PIXI.Graphics();
    background.roundRect(0, 0, 300, 80, 8);
    background.fill({ color: COLORS.UI_BACKGROUND, alpha: 0.9 });
    background.stroke({ color: COLORS.UI_BORDER, width: 1, alpha: 0.5 });
    this.controlPanel.addChild(background);

    // Play/Pause button
    const playButton = this.createButton('⏸️', () => this.togglePlayPause());
    playButton.x = 20;
    playButton.y = 20;
    this.controlPanel.addChild(playButton);

    // Next button
    const nextButton = this.createButton('⏭️', () => this.narrativeSequencer.nextNarrative());
    nextButton.x = 80;
    nextButton.y = 20;
    this.controlPanel.addChild(nextButton);

    // Speed controls
    this.createSpeedControls();

    // Position control panel (bottom right, initially hidden)
    this.controlPanel.x = this.app.screen.width - 320;
    this.controlPanel.y = this.app.screen.height - 100;
    this.controlPanel.alpha = 0;
    this.app.stage.addChild(this.controlPanel);
  }

  /**
   * Create speed control buttons
   */
  private createSpeedControls() {
    const speeds = [0.5, 1, 2, 4];
    let xOffset = 140;

    speeds.forEach(speed => {
      const button = this.createButton(`${speed}x`, () => {
        this.narrativeSequencer.setSpeed(speed);
        this.updateSpeedButtons(speed);
      });
      button.x = xOffset;
      button.y = 20;
      this.speedButtons.addChild(button);
      xOffset += 35;
    });

    this.controlPanel.addChild(this.speedButtons);
    this.updateSpeedButtons(1); // Default speed
  }

  /**
   * Create a simple button
   */
  private createButton(text: string, onClick: () => void): PIXI.Container {
    const button = new PIXI.Container();
    
    const bg = new PIXI.Graphics();
    bg.roundRect(0, 0, 30, 30, 4);
    bg.fill({ color: COLORS.UI_BACKGROUND });
    bg.stroke({ color: COLORS.UI_BORDER, width: 1 });
    button.addChild(bg);

    const label = new PIXI.Text({
      text,
      style: {
        fontFamily: 'Inter',
        fontSize: 12,
        fill: COLORS.TEXT,
        align: 'center'
      }
    });
    label.anchor.set(0.5);
    label.x = 15;
    label.y = 15;
    button.addChild(label);

    // Make interactive
    button.eventMode = 'static';
    button.cursor = 'pointer';
    button.on('pointerdown', onClick);

    // Hover effects
    button.on('pointerover', () => {
      gsap.to(bg, { duration: 0.2, pixi: { alpha: 0.8 } });
    });
    button.on('pointerout', () => {
      gsap.to(bg, { duration: 0.2, pixi: { alpha: 1 } });
    });

    return button;
  }

  /**
   * Update speed button states
   */
  private updateSpeedButtons(activeSpeed: number) {
    const speeds = [0.5, 1, 2, 4];
    this.speedButtons.children.forEach((button, index) => {
      const bg = button.children[0] as PIXI.Graphics;
      const isActive = speeds[index] === activeSpeed;
      
      bg.clear();
      bg.roundRect(0, 0, 30, 30, 4);
      bg.fill({ color: isActive ? COLORS.DOT_HIGHLIGHT : COLORS.UI_BACKGROUND });
      bg.stroke({ color: COLORS.UI_BORDER, width: 1 });
    });
  }

  /**
   * Create query display for search results
   */
  private createQueryDisplay() {
    this.queryText = new PIXI.Text({
      text: '',
      style: {
        fontFamily: 'Inter',
        fontSize: 24,
        fontWeight: 'bold',
        fill: COLORS.TEXT,
        align: 'center'
      }
    });
    this.queryText.anchor.set(0.5);
    this.queryText.x = this.app.screen.width / 2;
    this.queryText.y = this.app.screen.height - 100;
    this.queryText.alpha = 0;
    this.app.stage.addChild(this.queryText);
  }

  /**
   * Create debug window for development status
   */
  private createDebugWindow() {
    // Background
    const background = new PIXI.Graphics();
    background.roundRect(0, 0, 300, 200, 8);
    background.fill({ color: COLORS.UI_BACKGROUND, alpha: 0.95 });
    background.stroke({ color: COLORS.UI_BORDER, width: 1, alpha: 0.5 });
    this.debugWindow.addChild(background);

    // Debug text
    this.debugText = new PIXI.Text({
      text: 'Debug Status:\nInitializing...',
      style: {
        fontFamily: 'monospace',
        fontSize: 10,
        fill: COLORS.TEXT,
        wordWrap: true,
        wordWrapWidth: 280
      }
    });
    this.debugText.x = 10;
    this.debugText.y = 10;
    this.debugWindow.addChild(this.debugText);

    // Position debug window (top right, initially hidden)
    this.debugWindow.x = this.app.screen.width - 320;
    this.debugWindow.y = 20;
    this.debugWindow.alpha = 0;
    this.app.stage.addChild(this.debugWindow);
  }

  /**
   * Setup event listeners
   */
  private setupEventListeners() {
    // Keyboard controls
    window.addEventListener('keydown', (e) => {
      switch (e.key) {
        case ' ':
          e.preventDefault();
          this.togglePlayPause();
          break;
        case 'c':
          this.toggleControls();
          break;
        case 'n':
          this.narrativeSequencer.nextNarrative();
          break;
        case '1':
          this.narrativeSequencer.setSpeed(1);
          this.updateSpeedButtons(1);
          break;
        case '2':
          this.narrativeSequencer.setSpeed(2);
          this.updateSpeedButtons(2);
          break;
        case 'd':
          this.toggleDebug();
          break;
      }
    });

    // Window resize
    window.addEventListener('resize', () => {
      this.onResize();
    });

    // Setup SSE for search
    this.setupSSE();
  }

  /**
   * Initialize narrative system
   */
  private async initializeNarrativeSystem() {
    // Initialize visual actions
    this.visualActions = new MycelialVisualActions(this.app, this.projectDots, this.projects);
    
    // Initialize sequencer
    await this.narrativeSequencer.init(this.narratives, this.projects);
    
    // Setup callbacks
    this.narrativeSequencer.onVisualActionTrigger((action: VisualMoment, narrative: MycelialNarrative) => {
      this.handleVisualAction(action, narrative);
    });

    this.narrativeSequencer.onStateChangeTrigger((state: NarrativeState, narrative: MycelialNarrative) => {
      this.updateContextWindow(state, narrative);
    });

    this.log('🔄 Narrative system initialized');
  }

  /**
   * Handle visual actions from narrative sequencer
   */
  private handleVisualAction(action: VisualMoment, narrative: MycelialNarrative) {
    if (action.action === 'ambient_effects') {
      // Handle continuous ambient effects
      this.visualActions.breathingEffect(action.parameters.breathingRate);
      this.visualActions.setColorProgression(action.parameters.colorProgression, action.parameters.progress);
      return; // Don't log ambient effects
    }
    
    // Execute the visual action
    this.visualActions.executeAction(action);
    
    // Apply breathing effect based on narrative settings
    this.visualActions.breathingEffect(narrative.ambientMode.breathingRate);
    
    // Update color progression
    const progress = this.narrativeSequencer.getProgress();
    this.visualActions.setColorProgression(narrative.ambientMode.colorProgression, progress);
    
    this.log(`🎬 ${action.action} (${action.targets.length} targets)`);
  }

  /**
   * Update context window with current narrative state
   */
  private updateContextWindow(state: NarrativeState, narrative: MycelialNarrative) {
    // Update title
    this.narrativeTitle.text = `${narrative.title} (${state.currentNarrative + 1}/${this.narratives.length})`;
    
    // Update chapter
    const chapter = this.narrativeSequencer.getCurrentChapter();
    this.chapterText.text = `${chapter.title}\n${chapter.period[0]}-${chapter.period[1]}`;
    
    // Update progress bar
    this.updateProgressBar(this.narrativeSequencer.getProgress());
  }

  /**
   * Update progress bar
   */
  private updateProgressBar(progress: number) {
    this.progressBar.clear();
    
    // Background
    this.progressBar.roundRect(16, 85, 368, 6, 3);
    this.progressBar.fill({ color: COLORS.UI_BORDER, alpha: 0.3 });
    
    // Progress
    const progressWidth = 368 * progress;
    if (progressWidth > 0) {
      this.progressBar.roundRect(16, 85, progressWidth, 6, 3);
      this.progressBar.fill({ color: COLORS.DOT_HIGHLIGHT });
    }
  }

  /**
   * Start the experience
   */
  private start() {
    this.narrativeSequencer.start();
    this.log('🚀 Mycelial narrative experience started');
  }

  /**
   * Toggle play/pause
   */
  private togglePlayPause() {
    const state = this.narrativeSequencer.getState();
    if (state.isPlaying) {
      this.narrativeSequencer.pause();
    } else {
      this.narrativeSequencer.resume();
    }
  }

  /**
   * Toggle control panel visibility
   */
  private toggleControls() {
    this.isControlsVisible = !this.isControlsVisible;
    gsap.to(this.controlPanel, {
      alpha: this.isControlsVisible ? 1 : 0,
      duration: 0.3,
      ease: 'power2.out'
    });
  }

  /**
   * Handle search results from SSE
   */
  private highlightSearchResults(projectIds: string[], query: string) {
    // Pause narrative
    this.narrativeSequencer.pause();
    
    // Show query
    this.queryText.text = `"${query}"`;
    gsap.to(this.queryText, { alpha: 1, duration: 0.5 });
    
    // Highlight projects
    this.visualActions.resetAll();
    this.visualActions.highlightCluster(projectIds, { intensity: 1.0, duration: 1.0 });
    
    // Resume after timeout
    setTimeout(() => {
      gsap.to(this.queryText, { alpha: 0, duration: 0.5 });
      this.narrativeSequencer.resume();
    }, 10000); // 10 seconds for search display
  }

  /**
   * Setup Server-Sent Events for search
   */
  private setupSSE() {
    try {
      const eventSource = new EventSource('http://localhost:8000/events');
      
      eventSource.addEventListener('search_results', (event) => {
        const data = JSON.parse(event.data);
        this.log(`🔍 Search "${data.query}": ${data.projectIds.length} results`);
        this.highlightSearchResults(data.projectIds, data.query);
      });

      eventSource.onerror = (err) => {
        console.error('SSE Error:', err);
      };
    } catch (error) {
      console.warn('Could not establish SSE connection:', error);
    }
  }

  /**
   * Handle window resize
   */
  private onResize() {
    // Update UI positions
    this.controlPanel.x = this.app.screen.width - 320;
    this.controlPanel.y = this.app.screen.height - 100;
    
    this.queryText.x = this.app.screen.width / 2;
    this.queryText.y = this.app.screen.height - 100;
    
    // Update visual actions
    this.visualActions?.onResize();
    
    // Recreate project dots with new positions
    this.projectDots.clear();
    this.container.removeChildren();
    this.createProjectDots();
  }

  /**
   * Debug logging methods
   */
  private log(message: string) {
    if (this.showDebug && this.debugText) {
      const timestamp = new Date().toLocaleTimeString();
      const currentText = this.debugText.text;
      const lines = currentText.split('\n');
      
      // Keep only last 15 lines
      if (lines.length > 15) {
        lines.splice(0, lines.length - 15);
      }
      
      lines.push(`[${timestamp}] ${message}`);
      this.debugText.text = lines.join('\n');
    }
    
    // Only log important messages to console
    if (message.includes('❌') || message.includes('⚠️') || message.includes('🎭') || message.includes('🔄') || message.includes('🚀')) {
      console.log(message);
    }
  }

  /**
   * Toggle debug window visibility
   */
  private toggleDebug() {
    this.showDebug = !this.showDebug;
    gsap.to(this.debugWindow, {
      alpha: this.showDebug ? 1 : 0,
      duration: 0.3,
      ease: 'power2.out'
    });
  }
}

// --- Entry Point ---
console.log('🌟 Starting Mycelial Gallery Application...');
const galleryApp = new MycelialGalleryApp();
galleryApp.init().catch(error => {
  console.error('💥 Failed to initialize gallery:', error);
});