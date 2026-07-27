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

export interface Project {
  id: string;
  title: string;
  subtitle: string;
  summary: string;
  status: string;
  stack: string[];
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
      'I’m building this around one hard boundary: agents propose; Rust validates and owns the world. Right now it has a private frontier seed, deterministic CLI output, and eight passing tests.',
    status: 'LOCAL_REPO / VERIFIED',
    stack: ['Rust', 'Cargo', '8 tests', 'Deterministic', 'Frontier v0.1'],
    links: [],
    artwork: {
      kind: 'mask',
      label: 'FRONTIER PLATE / VALIDATION BOUNDARY',
      caption:
        'A frontier observatory and its routes, flattened through the same deterministic 1-bit pipeline.',
      index: '00',
      src: '/assets/dither/ares-frontier-engraving.png',
      underlaySrc: '/assets/dither/ares-frontier.png',
      alt:
        'A 1-bit engraved frontier observatory layered over a technical topology of concentric terrain and branching agent paths.',
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
    links: [
      {
        label: 'View source',
        href: 'https://github.com/acvdoandrew/rust-edge-compute',
      },
    ],
    artwork: {
      kind: 'mask',
      label: 'EDGE MESH / RELAY STUDY',
      caption:
        'Relay towers report inward while the central orchestrator holds leases and recovery state.',
      index: '01',
      src: '/assets/dither/edge-node-engraving.png',
      underlaySrc: '/assets/dither/edge-network.png',
      alt:
        'A 1-bit engraved network of relay towers layered over the control-plane trace around a central orchestrator.',
    },
  },
  {
    id: 'physics-engine',
    title: 'High-Performance Physics Engine',
    subtitle: 'Particle Simulation',
    summary:
      'A C++17 particle engine I built to study simulation loops, memory layout, and broad-phase collisions. It still needs honest benchmarks.',
    status: 'PUBLIC_REPO / BENCHMARKS_TODO',
    stack: ['C++17', 'CMake', 'SFML'],
    links: [
      {
        label: 'View source',
        href: 'https://github.com/acvdoandrew/high-performance-physics-engine',
      },
    ],
    artwork: {
      kind: 'mask',
      label: 'PARTICLE APPARATUS / FRAME N',
      caption:
        'A frozen high-energy frame with the collision grid and orbital traces left visible.',
      index: '02',
      src: '/assets/dither/physics-engine-engraving.png',
      underlaySrc: '/assets/dither/physics-particles.png',
      alt:
        'A 1-bit engraved kinetic particle apparatus layered over orbit traces, collision vectors, and a spatial grid.',
    },
  },
  {
    id: 'inference-proxy',
    title: 'Speculative Inference Proxy',
    subtitle: 'Speculative Decoding Gateway',
    summary:
      'A Rust/Python gateway I’m building for speculative decoding, TTFT measurements, and vLLM-compatible serving. Mock backends first; real models when the numbers hold up.',
    status: 'PUBLIC_REPO / COMPILING',
    stack: ['Rust', 'Python', 'Axum', 'vLLM'],
    links: [
      {
        label: 'View source',
        href: 'https://github.com/acvdoandrew/speculative-inference-proxy',
      },
    ],
    artwork: {
      kind: 'mask',
      label: 'DRAFT–ORACLE / VERIFICATION GATE',
      caption:
        'Draft tokens branch at verification. The accepted stream is the one that makes it through.',
      index: '03',
      src: '/assets/dither/inference-proxy-engraving.png',
      underlaySrc: '/assets/dither/inference-latency.png',
      alt:
        'A 1-bit engraved pair of machine oracles layered over a latency trace as tokens cross a verification gate.',
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
