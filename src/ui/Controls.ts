// UI Controls for play/pause, speed, and particle toggle

export interface ControlCallbacks {
  onPlayPause: (isPlaying: boolean) => void;
  onSpeedChange: (speed: number) => void;
  onParticleToggle: (showParticles: boolean) => void;
}

export class Controls {
  private isPlaying: boolean = false;
  private speed: number = 1;
  private showParticles: boolean = true;
  private callbacks: ControlCallbacks;

  constructor(callbacks: ControlCallbacks) {
    this.callbacks = callbacks;
    this.setupControls();
    console.log('✅ Controls initialized');
  }

  private setupControls(): void {
    const playPause = document.getElementById('playPause') as HTMLButtonElement;
    const speedSlider = document.getElementById('speedSlider') as HTMLInputElement;
    const speedValue = document.getElementById('speedValue') as HTMLSpanElement;
    const particlesToggle = document.getElementById('particlesToggle') as HTMLInputElement;
    
    if (!playPause || !speedSlider || !speedValue || !particlesToggle) {
      console.warn('⚠️ Some control elements not found in DOM');
      return;
    }

    playPause.addEventListener('click', () => {
      this.isPlaying = !this.isPlaying;
      playPause.textContent = this.isPlaying ? '⏸' : '▶';
      this.callbacks.onPlayPause(this.isPlaying);
    });
    
    speedSlider.addEventListener('input', () => {
      this.speed = parseFloat(speedSlider.value);
      speedValue.textContent = `${this.speed}x`;
      this.callbacks.onSpeedChange(this.speed);
    });

    particlesToggle.addEventListener('change', () => {
      this.showParticles = particlesToggle.checked;
      this.callbacks.onParticleToggle(this.showParticles);
    });

    // Initialize with current values
    speedValue.textContent = `${this.speed}x`;
    particlesToggle.checked = this.showParticles;
  }

  public getIsPlaying(): boolean {
    return this.isPlaying;
  }

  public getSpeed(): number {
    return this.speed;
  }

  public getShowParticles(): boolean {
    return this.showParticles;
  }
}