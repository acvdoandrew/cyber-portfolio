export type PaletteId =
  | 'archive'
  | 'carbon'
  | 'signal'
  | 'radiant'
  | 'field'
  | 'alloy';

export type ArtworkKind = 'shader' | 'mask' | 'diagram';

export interface ArtworkSpec {
  kind: ArtworkKind;
  label: string;
  caption: string;
  index: string;
  src?: string;
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
    paper: '#E7E4DC',
    ink: '#182521',
    accent: '#8E2148',
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
      'Agents submit bounded, typed proposals; Rust validates the base tick and full allocation, checks invariants, and owns the only authoritative state transition. The first settlement turn is deterministic and atomic.',
    status: 'LOCAL_REPO / FIRST_TURN_VERIFIED',
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
      kind: 'mask',
      label: 'STATE MACHINE / RUST AUTHORITY',
      caption:
        'Typed proposals stop at the validation gate. Only one checked path can touch authoritative state.',
      index: '00',
      src: '/assets/dither/ares-validation-plate.png',
      alt:
        'A 1-bit engraved cybernetic plate showing six bounded civic proposals entering a ceramic Rust validation iris, with one authoritative pulse continuing through a spinal state lattice while rejected paths terminate.',
    },
  },
  {
    id: 'rust-edge-compute',
    title: 'Rust Edge Compute Node',
    subtitle: 'Distributed Compute Control Plane',
    summary:
      'I built a fault-tolerant control plane for distributed compute. Workers report over gRPC; the orchestrator handles leases, priorities, and recovery.',
    status: 'PUBLIC_REPO / WORKING_BUILD',
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
        label: 'View source',
        href: 'https://github.com/acvdoandrew/rust-edge-compute',
      },
    ],
    artwork: {
      kind: 'mask',
      label: 'CONTROL PLANE / LEASE RECOVERY',
      caption:
        'Heartbeats converge on the orchestrator; leases move outward; abandoned work loops back for reassignment.',
      index: '01',
      src: '/assets/dither/edge-lease-control-plate.png',
      alt:
        'A 1-bit engraved rooftop compute garden with five ceramic GPU worker pods connected to an orchestrator, one failed node dark, and its lease visibly migrating to a healthy neighbor.',
    },
  },
  {
    id: 'physics-engine',
    title: 'High-Performance Physics Engine',
    subtitle: 'Particle Simulation',
    summary:
      'A C++17 2D particle engine with Verlet integration, boundary constraints, diagnostics, and naive O(n²) particle contacts. The spatial hash and honest benchmarks are still next.',
    status: 'PUBLIC_REPO / SPATIAL_HASH_TODO',
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
        label: 'View source',
        href: 'https://github.com/acvdoandrew/high-performance-physics-engine',
      },
    ],
    artwork: {
      kind: 'mask',
      label: 'SOLVER CHAMBER / CURRENT CPU PATH',
      caption:
        'Verlet trails and all-pairs contacts fill the active chamber; the dashed spatial grid remains a planned optimization.',
      index: '02',
      src: '/assets/dither/physics-verlet-plate.png',
      alt:
        'A 1-bit engraved synthetic materials lab showing a rectangular 2D particle chamber, persistent Verlet trails, wall rebounds, contact halos, and a faint inactive spatial grid.',
    },
  },
  {
    id: 'inference-proxy',
    title: 'Speculative Inference Proxy',
    subtitle: 'Speculative Decoding Gateway',
    summary:
      'A functional Rust gateway that routes identical OpenAI-compatible requests across baseline and speculation-enabled vLLM, streams SSE without buffering, and measures whether speculation actually helps.',
    status: 'PUBLIC_REPO / VERIFIED_MVP',
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
        label: 'View source',
        href: 'https://github.com/acvdoandrew/speculative-inference-proxy',
      },
    ],
    artwork: {
      kind: 'mask',
      label: 'EXPERIMENT BOUNDARY / ROUTE + MEASURE',
      caption:
        'The proxy compares two upstream lanes; draft and target verification remain inside the speculation-enabled engine.',
      index: '03',
      src: '/assets/dither/inference-routing-plate.png',
      alt:
        'A 1-bit engraved synthetic cognition plate with one request split into baseline and speculation-enabled lanes, draft capsules verified at a coral aperture, and one measured stream leaving the proxy.',
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
