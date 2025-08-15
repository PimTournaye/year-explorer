export interface Ping {
  x: number;
  y: number;
  age: number;
  maxAge: number;
  radius: number;
}

export class EffectsSystem {
  private pings: Ping[] = [];
  private readonly PING_LIFESPAN = 30; // 30 frames = 0.5 seconds
  private readonly PING_MAX_RADIUS = 50; // pixels

  // Called when a Frontier agent arrives
  public createPing(x: number, y: number): void {
    this.pings.push({
      x: x,
      y: y,
      age: 0,
      maxAge: this.PING_LIFESPAN,
      radius: 0
    });
  }

  public update(): void {
    for (let i = this.pings.length - 1; i >= 0; i--) {
      const ping = this.pings[i];
      ping.age++;
      
      // Animate the radius and remove if dead
      const life_fraction = ping.age / ping.maxAge;
      ping.radius = life_fraction * this.PING_MAX_RADIUS;

      if (ping.age > ping.maxAge) {
        this.pings.splice(i, 1);
      }
    }
  }

  public render(ctx: CanvasRenderingContext2D): void {
    if (this.pings.length === 0) return;

    ctx.save();
    for (const ping of this.pings) {
      const life_fraction = ping.age / ping.maxAge;
      const alpha = 1.0 - life_fraction; // Fade out

      ctx.beginPath();
      ctx.arc(ping.x, ping.y, ping.radius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(30, 30, 30, ${alpha})`; // Dark grey for off-white theme
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.restore();
  }
}