// Pre-built WireViz YAML templates surfaced via the editor's "Templates ▾"
// dropdown. Each template loads verbatim into the editor and triggers a
// re-render. Keep them small and self-contained — anything that needs a
// docs-length comment block belongs in WireViz's own /tutorial directory,
// not here. The leading comment in each template tells the user what
// concept it demonstrates.

export type WirevizTemplate = {
  id: string
  name: string
  description: string
  yaml: string
}

export const wirevizTemplates: WirevizTemplate[] = [
  {
    id: 'blank',
    name: 'Blank',
    description: 'Empty top-level keys to start from scratch.',
    yaml: `# Add your connectors, cables, and connections below.
connectors:

cables:

connections:
`,
  },

  {
    id: 'simple-cable',
    name: 'Simple cable',
    description: 'Two connectors joined by a 4-wire cable. Smallest valid harness.',
    yaml: `connectors:
  X1:
    pincount: 4
  X2:
    pincount: 4

cables:
  W1:
    wirecount: 4
    length: 1

connections:
  -
    - X1: [1-4]
    - W1: [1-4]
    - X2: [1-4]
`,
  },

  {
    id: 'pinlabels-colors',
    name: 'Pin labels + IEC colors',
    description: 'Named pins with IEC color-coded wires. Common pattern for I²C / SPI.',
    yaml: `connectors:
  X1:
    type: Molex KK 254
    subtype: male
    pinlabels: [GND, VCC, SCL, SDA]
  X2:
    type: Molex KK 254
    subtype: female
    pinlabels: [GND, VCC, SCL, SDA]

cables:
  W1:
    wirecount: 4
    length: 0.3
    gauge: 24 AWG
    color_code: IEC

connections:
  -
    - X1: [1-4]
    - W1: [1-4]
    - X2: [1-4]
`,
  },

  {
    id: 'shielded-rs232',
    name: 'Shielded RS-232',
    description: 'D-Sub serial cable with overall shield bonded to chassis pin.',
    yaml: `connectors:
  X1:
    type: D-Sub
    subtype: female
    pinlabels: [DCD, RX, TX, DTR, GND, DSR, RTS, CTS, RI]
  X2:
    type: Molex KK 254
    subtype: female
    pinlabels: [GND, RX, TX]

cables:
  W1:
    gauge: 0.25 mm2
    length: 0.2
    color_code: DIN
    wirecount: 3
    shield: true

connections:
  -
    - X1: [5, 2, 3]
    - W1: [1, 2, 3]
    - X2: [1, 3, 2]
  -
    - X1: 5
    - W1: s
`,
  },

  {
    id: 'daisy-chain',
    name: 'Daisy-chained sensors',
    description: 'One controller into two sensors via in-line connectors and YAML anchors.',
    yaml: `connectors:
  X1: &template_con
    pinlabels: [GND, VCC, SCL, SDA]
    type: Molex KK 254
    subtype: male
    notes: to microcontroller
  X2:
    <<: *template_con
    subtype: female
    notes: to accelerometer
  X3:
    <<: *template_con
    subtype: female
    notes: to temperature sensor

cables:
  W1: &template_cbl
    wirecount: 4
    length: 0.3
    gauge: 24 AWG
    color_code: IEC
  W2:
    <<: *template_cbl
    length: 0.1

connections:
  -
    - X1: [1-4]
    - W1: [1-4]
    - X2: [1-4]
  -
    - X2: [1-4]
    - W2: [1-4]
    - X3: [1-4]
`,
  },

  {
    id: 'ferrules-bundle',
    name: 'Power harness w/ ferrules',
    description: 'Crimp-ferrule terminations into a bundle of individually-coloured wires.',
    yaml: `connectors:
  X1:
    pinlabels: [+12V, GND, GND, +5V]
    type: Molex 8981
    subtype: female
  F_10:
    style: simple
    type: Crimp ferrule
    subtype: 1.0 mm²
    color: YE
  F_05:
    style: simple
    type: Crimp ferrule
    subtype: 0.5 mm²
    color: OG

cables:
  W1:
    category: bundle
    length: 0.3
    gauge: 0.5 mm2
    colors: [YE, BK, BK, RD]

connections:
  -
    - [F_05., F_10.F1, F_10.F1, F_05.]
    - W1: [1-4]
    - X1: [1-4]
`,
  },

  {
    id: 'mini-headlamp',
    name: 'Classic Mini headlamp loom',
    description: 'Mini-themed: bullet-connector pigtail from main loom to a sealed-beam headlamp.',
    yaml: `# Lucas-style sealed-beam headlamp pigtail.
# Colour codes follow British practice: BLU = main beam, BLU/WHT = high beam,
# BLK = chassis ground, RED = sidelamp feed.
metadata:
  description: Classic Mini front headlamp pigtail (LH)

connectors:
  LOOM:
    type: Bullet (Lucas)
    subtype: female
    pinlabels: [Main, High, Side, GND]
  LAMP:
    type: H4 sealed beam
    subtype: 3-pin
    pinlabels: [Low, High, GND]
  EARTH:
    type: Ring terminal
    subtype: M5
    pincount: 1

cables:
  W1:
    category: bundle
    length: 0.4
    gauge: 1.0 mm2
    colors: [BU, BUWH, RD, BK]

connections:
  -
    - LOOM: [1-4]
    - W1: [1-4]
  -
    - W1: [1, 2]
    - LAMP: [1, 2]
  -
    - W1: 4
    - EARTH: 1
`,
  },
]

export function getTemplate(id: string): WirevizTemplate | undefined {
  return wirevizTemplates.find((t) => t.id === id)
}
