export type PaletteId =
  | 'archive'
  | 'carbon'
  | 'signal'
  | 'radiant'
  | 'field'
  | 'alloy';

export type ArtworkKind = 'shader' | 'mask' | 'diagram' | 'image' | 'pixels';

export interface ArtworkSpec {
  kind: ArtworkKind;
  label: string;
  caption: string;
  index: string;
  src?: string;
  smallSrc?: string;
  underlaySrc?: string;
  alt: string;
}

export interface ProjectLink {
  label: string;
  href: string;
}

export interface ProjectFlowStep {
  label: string;
  detail: string;
}

export interface Project {
  id: string;
  title: string;
  subtitle: string;
  summary: string;
  status: string;
  statusLabel: string;
  stack: string[];
  flow: ProjectFlowStep[];
  links: ProjectLink[];
  artwork: ArtworkSpec;
}

export interface PaletteMeta {
  id: PaletteId;
  label: string;
  paper: string;
  ink: string;
  accent: string;
  colorScheme: 'light' | 'dark';
}

export interface Capability {
  id: string;
  title: string;
  state: string;
  summary: string;
  stack: string[];
}

export interface ContactLink {
  id: 'email' | 'github' | 'x';
  label: string;
  value: string;
  href: string;
  external: boolean;
}

export const paletteOrder: PaletteId[] = [
  'archive',
  'carbon',
  'signal',
  'radiant',
  'field',
  'alloy',
];

export const paletteMeta: Record<PaletteId, PaletteMeta> = {
  archive: {
    id: 'archive',
    label: 'Archive',
    paper: '#F2F3EE',
    ink: '#202621',
    accent: '#A3422B',
    colorScheme: 'light',
  },
  carbon: {
    id: 'carbon',
    label: 'Carbon',
    paper: '#090A09',
    ink: '#F0EEE2',
    accent: '#D85D3F',
    colorScheme: 'dark',
  },
  signal: {
    id: 'signal',
    label: 'Signal',
    paper: '#050806',
    ink: '#E6F2E9',
    accent: '#00D985',
    colorScheme: 'dark',
  },
  radiant: {
    id: 'radiant',
    label: 'Radiant',
    paper: '#0B0905',
    ink: '#F2D66C',
    accent: '#F05A2A',
    colorScheme: 'dark',
  },
  field: {
    id: 'field',
    label: 'Field',
    paper: '#061008',
    ink: '#9FD19D',
    accent: '#D6F06C',
    colorScheme: 'dark',
  },
  alloy: {
    id: 'alloy',
    label: 'Alloy',
    paper: '#B4BCC1',
    ink: '#111314',
    accent: '#D14E32',
    colorScheme: 'light',
  },
};

export const palettes: PaletteMeta[] = paletteOrder.map((id) => paletteMeta[id]);

export const projects: Project[] = [
  {
    id: 'ares',
    title: 'ARES',
    subtitle: 'Civilization Agent Sandbox',
    summary:
      'A small world for AI agents. They suggest a move; Rust checks it before the world changes. Every state change is deterministic and atomic.',
    status: 'LOCAL_REPO / FIRST_TURN_VERIFIED',
    statusLabel: 'In development',
    stack: ['Rust', 'Cargo', '3 crates', 'Atomic commit', 'Frontier v0.1'],
    flow: [
      {
        label: 'Bounded proposal',
        detail: 'Complete six-part allocation plus the expected base tick.',
      },
      {
        label: 'Rust validates',
        detail: 'Build a candidate state, then check every invariant.',
      },
      {
        label: 'Commit or reject',
        detail: 'S(0) becomes S(1) once; rejection leaves state untouched.',
      },
    ],
    links: [],
    artwork: {
      kind: 'pixels',
      label: 'STATE MACHINE / RUST AUTHORITY',
      caption:
        'a small world, one tick at a time',
      index: '00',
      src: '/assets/dither/studies/ares.png',
      alt:
        'A 1-bit pixel study of an isometric settlement evolving in discrete ticks, with agents moving inside its circular boundary.',
    },
  },
  {
    id: 'rust-edge-compute',
    title: 'Rust Edge Compute Node',
    subtitle: 'Distributed Compute Control Plane',
    summary:
      'A Rust control plane for a small compute cluster. I’m interested in what happens when a worker disappears.',
    status: 'PUBLIC_REPO / WORKING_BUILD',
    statusLabel: 'Working build',
    stack: ['Rust', 'Tokio', 'Tonic', 'gRPC', 'Ratatui'],
    flow: [
      {
        label: 'Workers report',
        detail: 'GPU telemetry, uptime, version, and heartbeat state.',
      },
      {
        label: 'Orchestrator leases',
        detail: 'Capability filter, priority queue, and renewable job lease.',
      },
      {
        label: 'Failure recovers',
        detail: 'Stale nodes are evicted and expired work returns to the queue.',
      },
    ],
    links: [
      {
        label: 'source',
        href: 'https://github.com/acvdoandrew/rust-edge-compute',
      },
    ],
    artwork: {
      kind: 'pixels',
      label: 'CONTROL PLANE / LEASE RECOVERY',
      caption:
        'connections that find another way',
      index: '01',
      src: '/assets/dither/studies/rust-edge-compute.png',
      alt:
        'A 1-bit dithered network with packets moving between six worker nodes and a central node, rerouting when a worker dims.',
    },
  },
  {
    id: 'physics-engine',
    title: 'High-Performance Physics Engine',
    subtitle: 'Particle Simulation',
    summary:
      'An excuse to learn what makes a simulation fast. C++17, Verlet integration, and particle collisions. Spatial hashing and benchmarks are next.',
    status: 'PUBLIC_REPO / SPATIAL_HASH_TODO',
    statusLabel: 'In progress',
    stack: ['C++17', 'CMake', 'SFML', 'Verlet', 'O(n²) contacts'],
    flow: [
      {
        label: 'Integrate',
        detail: 'Current and previous positions advance through Verlet steps.',
      },
      {
        label: 'Resolve',
        detail: 'Boundary bounces and all-pairs particle contacts on CPU.',
      },
      {
        label: 'Render + measure',
        detail: 'SFML frame output with FPS and particle diagnostics.',
      },
    ],
    links: [
      {
        label: 'source',
        href: 'https://github.com/acvdoandrew/high-performance-physics-engine',
      },
    ],
    artwork: {
      kind: 'pixels',
      label: 'SOLVER CHAMBER / CURRENT CPU PATH',
      caption:
        'particles, constraints, and a lot of debugging',
      index: '02',
      src: '/assets/dither/studies/physics-engine.png',
      alt:
        'A 1-bit pixel study of particles moving through a bounded field, leaving short trails and marking nearby contacts.',
    },
  },
  {
    id: 'inference-proxy',
    title: 'Speculative Inference Proxy',
    subtitle: 'Speculative Decoding Gateway',
    summary:
      'I’m testing whether speculative decoding is worth the extra machinery. This proxy compares both paths and measures the wait.',
    status: 'PUBLIC_REPO / VERIFIED_MVP',
    statusLabel: 'Working MVP',
    stack: ['Rust', 'Axum', 'vLLM', 'SSE', 'OpenMetrics'],
    flow: [
      {
        label: 'Route',
        detail: 'One request selects the baseline or speculation-enabled arm.',
      },
      {
        label: 'Engine owns speculation',
        detail: 'Draft proposal and target verification stay inside vLLM.',
      },
      {
        label: 'Stream + measure',
        detail: 'Pass SSE through while recording first output and total latency.',
      },
    ],
    links: [
      {
        label: 'source',
        href: 'https://github.com/acvdoandrew/speculative-inference-proxy',
      },
    ],
    artwork: {
      kind: 'pixels',
      label: 'EXPERIMENT BOUNDARY / ROUTE + MEASURE',
      caption:
        'two paths, one measured stream',
      index: '03',
      src: '/assets/dither/studies/inference-proxy.png',
      alt:
        'A 1-bit dithered study of two moving token streams passing through a verification aperture into a single ordered output.',
    },
  },
];

export const capabilities: Capability[] = [
  {
    id: '01',
    title: 'Systems programming',
    state: 'SHIPPING',
    summary: 'Control planes, runtimes, and hot loops.',
    stack: ['Rust', 'C++', 'Linux', 'Bash', 'Tokio'],
  },
  {
    id: '02',
    title: 'AI infrastructure',
    state: 'INSTALLING',
    summary: 'Model serving, evals, and finding out where the time went.',
    stack: ['Python', 'PyTorch', 'vLLM', 'FastAPI', 'Eval Harnesses'],
  },
  {
    id: '03',
    title: 'Distributed infrastructure',
    state: 'FIELD_TESTED',
    summary: 'Schedulers, telemetry, recovery, and the failures between them.',
    stack: ['Docker', 'gRPC', 'Tonic', 'GitHub Actions'],
  },
  {
    id: '04',
    title: 'Security labs',
    state: 'ACTIVE_LAB',
    summary:
      'Threat models, adversarial inputs, and labs built to be broken.',
    stack: [
      'Hack The Box',
      'Web Security',
      'Prompt Injection',
      'Threat Modeling',
    ],
  },
  {
    id: '05',
    title: 'Interfaces',
    state: 'BUILDING',
    summary: 'Interfaces for seeing what a complicated system is actually doing.',
    stack: ['TypeScript', 'React', 'MapLibre', 'Dashboards'],
  },
];

export const contactLinks: ContactLink[] = [
  {
    id: 'email',
    label: 'Email',
    value: 'acvdoandrew@gmail.com',
    href: 'mailto:acvdoandrew@gmail.com',
    external: false,
  },
  {
    id: 'github',
    label: 'GitHub',
    value: 'github.com/acvdoandrew',
    href: 'https://github.com/acvdoandrew',
    external: true,
  },
  {
    id: 'x',
    label: 'X',
    value: 'x.com/etobyte',
    href: 'https://x.com/etobyte',
    external: true,
  },
];
