export type Body = {
  id: number
  x: number
  y: number
  vx: number
  vy: number
  m: number
  r: number
  color: string
}

export type PresetId = 'solar' | 'binary' | 'chaos' | 'empty'

export type BodySpec = {
  x: number
  y: number
  vx: number
  vy: number
  m: number
  color: string
}

export const MAX_BODIES = 140
export const MAX_TRAIL = 64

export const PALETTE = ['#c6ff3d', '#2de2c1', '#ff9f1c', '#f2f7e4', '#7cf7d8', '#b8ff8a']

const radiusFor = (mass: number) => Math.max(0.16, 0.28 * Math.cbrt(mass))

/**
 * A tiny 2D n-body integrator. It owns its own mutable state on purpose:
 * the render loop reads it every frame, React only reads summary numbers.
 */
export class Sim {
  bodies: Body[] = []
  trails = new Map<number, number[]>()
  gravity = 8
  timeScale = 1
  time = 0
  private nextId = 1

  private make(spec: BodySpec): Body {
    return {
      id: this.nextId++,
      x: spec.x,
      y: spec.y,
      vx: spec.vx,
      vy: spec.vy,
      m: spec.m,
      r: radiusFor(spec.m),
      color: spec.color,
    }
  }

  /**
   * Walks a new body outward until it is not touching anything.
   * Returns null when there is genuinely no free space nearby, so a click
   * landed on top of an existing body never creates a duplicate there.
   */
  private freeSpot(x: number, y: number, radius: number): { x: number; y: number } | null {
    const margin = 0.35
    const fits = (px: number, py: number) =>
      this.bodies.every(
        (body) => Math.hypot(px - body.x, py - body.y) >= body.r + radius + margin,
      )

    if (fits(x, y)) return { x, y }

    // Walk outward in rings until a clear pocket turns up next to the click.
    for (let ring = 1; ring <= 40; ring += 1) {
      const distance = ring * (radius + margin + 0.4)
      const steps = 12

      for (let step = 0; step < steps; step += 1) {
        const angle = (step / steps) * Math.PI * 2 + ring * 0.5
        const px = x + Math.cos(angle) * distance
        const py = y + Math.sin(angle) * distance
        if (fits(px, py)) return { x: px, y: py }
      }
    }

    return null
  }

  spawn(x: number, y: number, mass: number) {
    const spot = this.freeSpot(x, y, radiusFor(mass))
    if (!spot) return null

    const angle = Math.random() * Math.PI * 2
    const speed = 0.12 + Math.random() * 0.45
    const color = PALETTE[Math.floor(Math.random() * PALETTE.length)]
    const body = this.make({
      x: spot.x,
      y: spot.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      m: mass,
      color,
    })
    this.bodies.push(body)

    // Keep it playable: drop the oldest body once the pool is full.
    while (this.bodies.length > MAX_BODIES) {
      const dropped = this.bodies.shift()
      if (dropped) this.trails.delete(dropped.id)
    }
    return body.id
  }

  removeAt(x: number, y: number) {
    let best: Body | null = null
    let bestDistance = Infinity
    for (const body of this.bodies) {
      const distance = Math.hypot(body.x - x, body.y - y)
      if (distance < body.r * 2.6 && distance < bestDistance) {
        best = body
        bestDistance = distance
      }
    }
    if (!best) return
    this.bodies = this.bodies.filter((body) => body !== best)
    this.trails.delete(best.id)
  }

  clear() {
    this.bodies = []
    this.trails.clear()
    this.time = 0
  }

  loadPreset(id: PresetId) {
    this.clear()
    const G = this.gravity

    if (id === 'empty') return

    if (id === 'solar') {
      const sun = this.make({ x: 0, y: 0, vx: 0, vy: 0, m: 40, color: PALETTE[0] })
      this.bodies.push(sun)

      const radii = [4.5, 6.6, 8.4, 10.6, 12.8, 15]
      radii.forEach((radius, index) => {
        // Light planets keep the preset stable instead of perturbing each other.
        const mass = 0.08 + index * 0.04
        // Two-body circular speed: the planet's own mass pulls back on the sun.
        const speed = Math.sqrt((G * (sun.m + mass)) / radius)
        const angle = (index / radii.length) * Math.PI * 2 + 0.3
        this.bodies.push(
          this.make({
            x: Math.cos(angle) * radius,
            y: Math.sin(angle) * radius,
            vx: -Math.sin(angle) * speed,
            vy: Math.cos(angle) * speed,
            m: mass,
            color: PALETTE[(index + 1) % PALETTE.length],
          }),
        )
      })

      // Cancel the system's net momentum so the sun stays put.
      const total = this.bodies.reduce((sum, body) => sum + body.m, 0)
      const driftX = this.bodies.reduce((sum, body) => sum + body.m * body.vx, 0) / total
      const driftY = this.bodies.reduce((sum, body) => sum + body.m * body.vy, 0) / total
      for (const body of this.bodies) {
        body.vx -= driftX
        body.vy -= driftY
      }
      return
    }

    if (id === 'binary') {
      const mass = 16
      const separation = 3.2
      const speed = Math.sqrt((G * mass) / (2 * separation)) * 0.98

      this.bodies.push(this.make({ x: -separation, y: 0, vx: 0, vy: -speed, m: mass, color: PALETTE[1] }))
      this.bodies.push(this.make({ x: separation, y: 0, vx: 0, vy: speed, m: mass, color: PALETTE[0] }))

      for (let i = 0; i < 14; i += 1) {
        const angle = Math.random() * Math.PI * 2
        const radius = 8 + Math.random() * 8
        const orbit = Math.sqrt((G * 2 * mass) / radius)
        this.bodies.push(
          this.make({
            x: Math.cos(angle) * radius,
            y: Math.sin(angle) * radius,
            vx: -Math.sin(angle) * orbit,
            vy: Math.cos(angle) * orbit,
            m: 0.2 + Math.random() * 0.5,
            color: PALETTE[2 + (i % 4)],
          }),
        )
      }
      return
    }

    for (let i = 0; i < 28; i += 1) {
      const angle = Math.random() * Math.PI * 2
      const radius = Math.random() * 12
      this.bodies.push(
        this.make({
          x: Math.cos(angle) * radius,
          y: Math.sin(angle) * radius,
          vx: (Math.random() - 0.5) * 1.6,
          vy: (Math.random() - 0.5) * 1.6,
          m: 0.4 + Math.random() * 2.4,
          color: PALETTE[i % PALETTE.length],
        }),
      )
    }
  }

  step(delta: number) {
    const dt = Math.min(delta, 1 / 30) * this.timeScale
    if (dt <= 0) return

    const half = dt / 2
    this.integrate(half)
    this.integrate(half)
    this.time += dt
    this.recordTrails()
  }

  private integrate(h: number) {
    const G = this.gravity
    const softening = 0.36
    const count = this.bodies.length

    for (let i = 0; i < count; i += 1) {
      const a = this.bodies[i]
      let ax = 0
      let ay = 0

      for (let j = 0; j < count; j += 1) {
        if (i === j) continue
        const b = this.bodies[j]
        const dx = b.x - a.x
        const dy = b.y - a.y
        const d2 = dx * dx + dy * dy + softening
        const inv = 1 / Math.sqrt(d2)
        const accel = G * b.m * inv * inv * inv
        ax += dx * accel
        ay += dy * accel
      }

      a.vx += ax * h
      a.vy += ay * h
    }

    for (const body of this.bodies) {
      body.x += body.vx * h
      body.y += body.vy * h
    }

    this.resolveCollisions()
    this.evictEscapees()
  }

  private resolveCollisions() {
    let merged = true
    let guard = 0

    while (merged && guard < 400) {
      merged = false
      guard += 1

      outer: for (let i = 0; i < this.bodies.length; i += 1) {
        for (let j = i + 1; j < this.bodies.length; j += 1) {
          const a = this.bodies[i]
          const b = this.bodies[j]
          const dx = b.x - a.x
          const dy = b.y - a.y
          if (Math.hypot(dx, dy) > (a.r + b.r) * 0.85) continue

          const totalMass = a.m + b.m
          const keep = a.m >= b.m ? a : b
          const other = keep === a ? b : a

          keep.x = (a.x * a.m + b.x * b.m) / totalMass
          keep.y = (a.y * a.m + b.y * b.m) / totalMass
          keep.vx = (a.vx * a.m + b.vx * b.m) / totalMass
          keep.vy = (a.vy * a.m + b.vy * b.m) / totalMass
          keep.m = totalMass
          keep.r = radiusFor(totalMass)

          this.trails.delete(other.id)
          this.bodies.splice(this.bodies.indexOf(other), 1)
          merged = true
          break outer
        }
      }
    }
  }

  private evictEscapees() {
    if (!this.bodies.some((body) => Math.hypot(body.x, body.y) > 120)) return
    for (const body of this.bodies) {
      if (Math.hypot(body.x, body.y) > 120) this.trails.delete(body.id)
    }
    this.bodies = this.bodies.filter((body) => Math.hypot(body.x, body.y) <= 120)
  }

  private recordTrails() {
    const max = MAX_TRAIL * 2
    for (const body of this.bodies) {
      let trail = this.trails.get(body.id)
      if (!trail) {
        trail = []
        this.trails.set(body.id, trail)
      }
      trail.push(body.x, body.y)
      if (trail.length > max) trail.splice(0, trail.length - max)
    }
  }

  totals() {
    let mass = 0
    let kinetic = 0

    for (const body of this.bodies) {
      mass += body.m
      kinetic += 0.5 * body.m * (body.vx * body.vx + body.vy * body.vy)
    }

    return { mass, kinetic }
  }
}
