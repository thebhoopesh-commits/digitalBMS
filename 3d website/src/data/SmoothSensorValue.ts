export class SmoothSensorValue {
  private current: number;
  private target: number;
  private rate: number; // units per second

  constructor(initialValue: number, rate: number = 0.5) {
    this.current = initialValue;
    this.target = initialValue;
    this.rate = rate;
  }

  public setTarget(value: number) {
    this.target = value;
  }

  public setTargetImmediately(value: number) {
    this.target = value;
    this.current = value;
  }

  public get(): number {
    return this.current;
  }

  public getTarget(): number {
    return this.target;
  }

  public update(delta: number) {
    if (this.current === this.target) return;

    const diff = this.target - this.current;
    const step = this.rate * delta;

    if (Math.abs(diff) <= step) {
      this.current = this.target;
    } else {
      this.current += Math.sign(diff) * step;
    }
  }
}
