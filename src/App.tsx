import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { MAX_BODIES, MAX_TRAIL, Sim, type PresetId } from './sim'

/* ------------------------------------------------------------------ *
 * Scene objects
 * ------------------------------------------------------------------ */

function Bodies({ sim }: { sim: Sim }) {
  const core = useRef<THREE.InstancedMesh>(null)
  const halo = useRef<THREE.InstancedMesh>(null)

  const geometry = useMemo(() => new THREE.SphereGeometry(1, 22, 22), [])
  const coreMaterial = useMemo(
    () => new THREE.MeshStandardMaterial({ roughness: 0.32, metalness: 0.22 }),
    [],
  )
  const haloMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0.16,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    [],
  )

  const dummy = useMemo(() => new THREE.Object3D(), [])
  const tint = useMemo(() => new THREE.Color(), [])

  useEffect(() => {
    return () => {
      geometry.dispose()
      coreMaterial.dispose()
      haloMaterial.dispose()
    }
  }, [geometry, coreMaterial, haloMaterial])

  useFrame(() => {
    const coreMesh = core.current
    const haloMesh = halo.current
    if (!coreMesh || !haloMesh) return

    for (let i = 0; i < MAX_BODIES; i += 1) {
      const body = sim.bodies[i]

      if (!body) {
        dummy.position.set(0, 0, -999)
        dummy.scale.setScalar(0.0001)
        dummy.updateMatrix()
        coreMesh.setMatrixAt(i, dummy.matrix)
        haloMesh.setMatrixAt(i, dummy.matrix)
        continue
      }

      dummy.position.set(body.x, body.y, 0)
      dummy.scale.setScalar(body.r)
      dummy.updateMatrix()
      coreMesh.setMatrixAt(i, dummy.matrix)

      dummy.scale.setScalar(body.r * 2.8)
      dummy.updateMatrix()
      haloMesh.setMatrixAt(i, dummy.matrix)

      tint.set(body.color)
      coreMesh.setColorAt(i, tint)
      haloMesh.setColorAt(i, tint)
    }

    coreMesh.instanceMatrix.needsUpdate = true
    haloMesh.instanceMatrix.needsUpdate = true
    if (coreMesh.instanceColor) coreMesh.instanceColor.needsUpdate = true
    if (haloMesh.instanceColor) haloMesh.instanceColor.needsUpdate = true
  })

  return (
    <>
      <instancedMesh
        ref={core}
        args={[geometry, coreMaterial, MAX_BODIES]}
        frustumCulled={false}
      />
      <instancedMesh
        ref={halo}
        args={[geometry, haloMaterial, MAX_BODIES]}
        frustumCulled={false}
      />
    </>
  )
}

function Trails({ sim, visible }: { sim: Sim; visible: boolean }) {
  const group = useRef<THREE.Group>(null)
  const pool = useRef<Array<{ line: THREE.Line; geometry: THREE.BufferGeometry }>>([])

  useEffect(() => {
    const parent = group.current
    if (!parent) return

    const items: Array<{ line: THREE.Line; geometry: THREE.BufferGeometry }> = []

    for (let i = 0; i < MAX_BODIES; i += 1) {
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute(
        'position',
        new THREE.BufferAttribute(new Float32Array(MAX_TRAIL * 3), 3),
      )
      geometry.setDrawRange(0, 0)

      const material = new THREE.LineBasicMaterial({
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
      })

      const line = new THREE.Line(geometry, material)
      line.frustumCulled = false
      line.visible = false
      parent.add(line)
      items.push({ line, geometry })
    }

    pool.current = items

    return () => {
      for (const { line, geometry } of items) {
        parent.remove(line)
        geometry.dispose()
        const material = line.material
        if (Array.isArray(material)) material.forEach((m) => m.dispose())
        else material.dispose()
      }
      pool.current = []
    }
  }, [])

  useFrame(() => {
    const items = pool.current

    for (let i = 0; i < items.length; i += 1) {
      const { line, geometry } = items[i]
      const body = sim.bodies[i]
      const trail = body ? sim.trails.get(body.id) : undefined

      if (!visible || !body || !trail || trail.length < 6) {
        line.visible = false
        continue
      }

      const attribute = geometry.getAttribute('position') as THREE.BufferAttribute
      const array = attribute.array as Float32Array
      const points = Math.min(Math.floor(trail.length / 2), MAX_TRAIL)

      for (let p = 0; p < points; p += 1) {
        array[p * 3] = trail[p * 2]
        array[p * 3 + 1] = trail[p * 2 + 1]
        array[p * 3 + 2] = 0
      }

      attribute.needsUpdate = true
      geometry.setDrawRange(0, points)
      line.visible = true

      const material = line.material as THREE.LineBasicMaterial
      material.color.set(body.color)
    }
  })

  return <group ref={group} />
}

function Grid({ visible }: { visible: boolean }) {
  const geometry = useMemo(() => {
    const extent = 26
    const positions: number[] = []

    for (let i = -extent; i <= extent; i += 2) {
      positions.push(-extent, i, 0, extent, i, 0)
      positions.push(i, -extent, 0, i, extent, 0)
    }

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    return geo
  }, [])

  useEffect(() => () => geometry.dispose(), [geometry])

  return (
    <lineSegments geometry={geometry} position={[0, 0, -0.8]} visible={visible}>
      <lineBasicMaterial color="#1d2c25" transparent opacity={0.85} depthWrite={false} />
    </lineSegments>
  )
}

/**
 * R3F's own resize measurement can latch onto the canvas' default 300×150 box,
 * which stretches the render. Size the renderer from the live container instead.
 */
function SizeFix() {
  const gl = useThree((state) => state.gl)
  const camera = useThree((state) => state.camera)
  const setSize = useThree((state) => state.setSize)
  const last = useRef({ width: 0, height: 0 })

  const apply = () => {
    const parent = gl.domElement.parentElement
    if (!parent) return

    const width = parent.clientWidth
    const height = parent.clientHeight
    if (width < 1 || height < 1) return
    if (last.current.width === width && last.current.height === height) return

    last.current = { width, height }
    if (typeof setSize === 'function') setSize(width, height)
    gl.setSize(width, height, true)

    const perspective = camera as THREE.PerspectiveCamera
    perspective.aspect = width / height
    perspective.updateProjectionMatrix()
  }

  useEffect(() => {
    apply()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, camera])

  // Keep watching, in case the measurement above lands before layout settles.
  useFrame(apply)

  return null
}

/** Pulls the camera back far enough that the whole system fits the viewport. */
function FitView({ sim }: { sim: Sim }) {
  const camera = useThree((state) => state.camera)
  const size = useThree((state) => state.size)
  const controls = useThree((state) => state.controls) as unknown as
    | { update?: () => void }
    | null

  useEffect(() => {
    const perspective = camera as THREE.PerspectiveCamera
    const aspect = size.width / Math.max(1, size.height)
    const halfFov = (perspective.fov * Math.PI) / 360
    const halfExtent = 16.5
    const distance = Math.max(
      halfExtent / Math.tan(halfFov),
      halfExtent / (Math.tan(halfFov) * aspect),
    )
    perspective.position.z = distance
    perspective.updateProjectionMatrix()
    controls?.update?.()

    // Tell the simulation how far a spawn may travel before leaving the frame.
    sim.viewRadius = 0.95 * Math.min(distance * Math.tan(halfFov), distance * Math.tan(halfFov) * aspect)
  }, [camera, size, controls, sim])

  return null
}

function SpawnPlane({ sim, mass }: { sim: Sim; mass: number }) {
  const start = useRef<{ x: number; y: number; t: number } | null>(null)

  const onDown = (event: ThreeEvent<PointerEvent>) => {
    start.current = {
      x: event.nativeEvent.clientX,
      y: event.nativeEvent.clientY,
      t: performance.now(),
    }
  }

  const onUp = (event: ThreeEvent<PointerEvent>) => {
    const origin = start.current
    start.current = null
    if (!origin) return

    const moved = Math.hypot(
      event.nativeEvent.clientX - origin.x,
      event.nativeEvent.clientY - origin.y,
    )
    // A camera drag is not a click: only a still, quick press throws a body.
    if (moved > 6 || performance.now() - origin.t > 600) return

    sim.spawn(event.point.x, event.point.y, mass)
  }

  return (
    <mesh position={[0, 0, -0.4]} onPointerDown={onDown} onPointerUp={onUp}>
      <planeGeometry args={[160, 160]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  )
}

/* ------------------------------------------------------------------ *
 * App
 * ------------------------------------------------------------------ */

const PRESETS: Array<{ id: PresetId; label: string }> = [
  { id: 'solar', label: 'Solar' },
  { id: 'binary', label: 'Binary' },
  { id: 'chaos', label: 'Chaos' },
  { id: 'empty', label: 'Empty' },
]

export default function App() {
  const [sim] = useState(() => new Sim())

  const [gravity, setGravity] = useState(8)
  const [timeScale, setTimeScale] = useState(1)
  const [spawnMass, setSpawnMass] = useState(2.5)
  const [trails, setTrails] = useState(true)
  const [grid, setGrid] = useState(true)
  const [autoRotate, setAutoRotate] = useState(false)
  const [paused, setPaused] = useState(false)
  const [preset, setPreset] = useState<PresetId>('solar')
  const [help, setHelp] = useState(false)
  // Phones open with the canvas unobstructed; the ☰ button reveals the controls.
  const [panelOpen, setPanelOpen] = useState(
    () => typeof window === 'undefined' || window.innerWidth > 900,
  )
  const [fps, setFps] = useState(60)
  const [summary, setSummary] = useState({ bodies: 0, mass: 0, kinetic: 0, time: 0 })

  const pausedRef = useRef(paused)

  useEffect(() => {
    pausedRef.current = paused
  }, [paused])

  useEffect(() => {
    sim.gravity = gravity
    sim.timeScale = timeScale
  }, [sim, gravity, timeScale])

  useEffect(() => {
    sim.loadPreset('solar')
  }, [sim])

  const loadPreset = (id: PresetId) => {
    setPreset(id)
    sim.loadPreset(id)
    setPaused(false)
  }

  // Simulation tick — kept out of React state on purpose.
  useEffect(() => {
    let frame = 0
    let last = performance.now()

    const loop = (now: number) => {
      const delta = Math.min((now - last) / 1000, 0.05)
      last = now
      if (!pausedRef.current) sim.step(delta)
      frame = requestAnimationFrame(loop)
    }

    frame = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(frame)
  }, [sim])

  // HUD numbers, four times a second.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const totals = sim.totals()
      setSummary({
        bodies: sim.bodies.length,
        mass: totals.mass,
        kinetic: totals.kinetic,
        time: sim.time,
      })
    }, 250)
    return () => window.clearInterval(timer)
  }, [sim])

  // FPS meter.
  useEffect(() => {
    let frames = 0
    let last = performance.now()
    let raf = 0

    const tick = (now: number) => {
      frames += 1
      if (now - last >= 1000) {
        setFps(frames)
        frames = 0
        last = now
      }
      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Escape closes the shortcut card even while a slider has focus.
      if (event.key === 'Escape') {
        setHelp(false)
        return
      }
      if (event.target instanceof HTMLInputElement) return
      switch (event.key.toLowerCase()) {
        case ' ':
          event.preventDefault()
          setPaused((value) => !value)
          break
        case 't':
          setTrails((value) => !value)
          break
        case 'g':
          setGrid((value) => !value)
          break
        case 'r':
          loadPreset(preset)
          break
        case 'c':
          sim.clear()
          break
        case '?':
          setHelp((value) => !value)
          break
        case '1':
          loadPreset('solar')
          break
        case '2':
          loadPreset('binary')
          break
        case '3':
          loadPreset('chaos')
          break
        case '4':
          loadPreset('empty')
          break
        default:
          break
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, sim])

  return (
    <div className="app">
      <div className="stage">
        <Canvas
          camera={{ position: [0, 0, 38], fov: 48 }}
          dpr={[1, 2]}
          gl={{ antialias: true }}
        >
          <SizeFix />
          <color attach="background" args={['#06070a']} />
          <ambientLight intensity={0.55} />
          <directionalLight position={[6, 8, 12]} intensity={2.2} />
          <pointLight position={[-10, -8, 6]} intensity={40} color="#2de2c1" distance={60} />
          <pointLight position={[10, 6, 4]} intensity={30} color="#ff9f1c" distance={60} />

          <Bodies sim={sim} />
          <Trails sim={sim} visible={trails} />
          <Grid visible={grid} />
          <SpawnPlane sim={sim} mass={spawnMass} />

          <OrbitControls
            makeDefault
            enablePan={false}
            minDistance={9}
            maxDistance={70}
            enableDamping
            dampingFactor={0.08}
            autoRotate={autoRotate}
            autoRotateSpeed={0.4}
          />
          <FitView sim={sim} />
        </Canvas>
      </div>

      <div className="grain" aria-hidden="true" />

      <header className="topbar">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true" />
          <div>
            <strong>ORBITAL</strong>
            <span>n-body gravity sandbox</span>
          </div>
        </div>

        <div className="topbar__actions">
          <span className="fps">{fps} fps</span>
          <button
            type="button"
            className="icon-btn"
            onClick={() => setHelp((value) => !value)}
            aria-label="Keyboard shortcuts"
          >
            ?
          </button>
          <button
            type="button"
            className="icon-btn panel-toggle"
            onClick={() => setPanelOpen((value) => !value)}
            aria-label="Toggle controls"
          >
            {panelOpen ? '×' : '☰'}
          </button>
        </div>
      </header>

      <aside className={`panel ${panelOpen ? '' : 'is-hidden'}`} aria-label="Simulation controls">
        <div className="panel__section">
          <p className="panel__label">Presets</p>
          <div className="row">
            {PRESETS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`pill ${preset === item.id ? 'is-active' : ''}`}
                onClick={() => loadPreset(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="panel__section">
          <div className="slider">
            <label htmlFor="gravity">
              <span>Gravity</span>
              <b>{gravity.toFixed(1)}</b>
            </label>
            <input
              id="gravity"
              type="range"
              min={0}
              max={24}
              step={0.5}
              value={gravity}
              onChange={(event) => setGravity(Number(event.target.value))}
            />
          </div>

          <div className="slider">
            <label htmlFor="speed">
              <span>Time</span>
              <b>{timeScale.toFixed(2)}×</b>
            </label>
            <input
              id="speed"
              type="range"
              min={0}
              max={3}
              step={0.05}
              value={timeScale}
              onChange={(event) => setTimeScale(Number(event.target.value))}
            />
          </div>

          <div className="slider">
            <label htmlFor="mass">
              <span>New body mass</span>
              <b>{spawnMass.toFixed(1)}</b>
            </label>
            <input
              id="mass"
              type="range"
              min={0.2}
              max={12}
              step={0.1}
              value={spawnMass}
              onChange={(event) => setSpawnMass(Number(event.target.value))}
            />
          </div>
        </div>

        <div className="panel__section">
          <div className="row">
            <button
              type="button"
              className={`pill ${trails ? 'is-active' : ''}`}
              onClick={() => setTrails((value) => !value)}
              aria-pressed={trails}
            >
              Trails
            </button>
            <button
              type="button"
              className={`pill ${grid ? 'is-active' : ''}`}
              onClick={() => setGrid((value) => !value)}
              aria-pressed={grid}
            >
              Grid
            </button>
            <button
              type="button"
              className={`pill ${autoRotate ? 'is-active' : ''}`}
              onClick={() => setAutoRotate((value) => !value)}
              aria-pressed={autoRotate}
            >
              Drift
            </button>
          </div>
        </div>

        <div className="panel__section panel__section--row">
          <button
            type="button"
            className="pill pill--wide"
            onClick={() => setPaused((value) => !value)}
          >
            {paused ? '▸ Resume' : '❚❚ Pause'}
          </button>
          <button
            type="button"
            className="pill pill--wide"
            onClick={() => loadPreset(preset)}
          >
            ↺ Reset
          </button>
          <button type="button" className="pill pill--wide" onClick={() => sim.clear()}>
            ⌫ Clear
          </button>
        </div>

        <p className="panel__foot">
          Click empty space to throw a body in. Drag to orbit. Scroll to zoom.
        </p>
      </aside>

      <div className="readout" aria-label="Simulation readout">
        <div>
          <span>Bodies</span>
          <b>{summary.bodies}</b>
        </div>
        <div>
          <span>Mass</span>
          <b>{summary.mass.toFixed(1)}</b>
        </div>
        <div>
          <span>Kinetic</span>
          <b>{summary.kinetic.toFixed(1)}</b>
        </div>
        <div>
          <span>Sim time</span>
          <b>{summary.time.toFixed(1)}s</b>
        </div>
      </div>

      <div className="hint" aria-hidden="true">
        <span className="hint__dot" />
        {paused ? 'Paused — space to resume' : 'Live simulation — click space to add mass'}
      </div>

      {help && (
        <div className="help" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
          <button
            type="button"
            className="help__close"
            onClick={() => setHelp(false)}
            aria-label="Close"
          >
            ×
          </button>
          <h2>Shortcuts</h2>
          <ul>
            <li>
              <kbd>Space</kbd> pause / resume
            </li>
            <li>
              <kbd>1</kbd>–<kbd>4</kbd> load preset
            </li>
            <li>
              <kbd>R</kbd> reset current preset
            </li>
            <li>
              <kbd>C</kbd> clear every body
            </li>
            <li>
              <kbd>T</kbd> trails on / off
            </li>
            <li>
              <kbd>G</kbd> grid on / off
            </li>
            <li>
              <kbd>?</kbd> this panel
            </li>
          </ul>
          <p>
            Bodies that touch merge, keeping their combined momentum. Anything flung past the edge is
            gone for good.
          </p>
        </div>
      )}
    </div>
  )
}
