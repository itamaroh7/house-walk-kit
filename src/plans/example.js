// The example house: a single-storey family house of about 140 m2 on a 24 x 26 m plot, made up
// for this kit (not a real house or address).
//   - north: two bedrooms, the family bathroom and a study along a corridor; the parents' bedroom
//     with its own shower room in the north-east corner
//   - middle: the laundry and the guest WC off the corridor; the entry runs from the front door
//     straight to the corridor
//   - south: one open day space - the living room on the west, the kitchen and dining on the east,
//     opening onto a pergola terrace
//   - white plaster with dark grey cladding on the parents' wing and the entry, flat roofs
// The street is on the south, as always in this kit. Units are metres, x east, z south, walls on
// their centre lines (see CLAUDE.md).
import { makePlan, GREY, stones, hedge, lavender } from '../house/kit.js';

const oak = 'floor_oak';

export default makePlan({
  id: 'example',
  name: { en: 'Example house · two bedrooms and a study', he: 'בית לדוגמה · שני חדרי שינה וחדר עבודה' },
  site: {
    plot: [-4, -6, 20, 20],
    gate: [5.5, 7.1],
    carGate: [14.5, 19.5],
    north: 0,
  },
  rooms: [
    { id: 'kids', name: { en: "Children's room", he: 'חדר ילדים' }, rect: [0, 0, 3.4, 3.8], use: 'bedroom', floor: oak },
    { id: 'bath', name: { en: 'Bathroom', he: 'אמבטיה' }, rect: [3.4, 0, 5.4, 3.8], use: 'bath' },
    { id: 'study', name: { en: 'Study / guest room', he: 'חדר עבודה / אורחים' }, rect: [5.4, 0, 8.8, 3.8], use: 'office', floor: oak },
    { id: 'parents', name: { en: "Parents' bedroom", he: 'חדר הורים' }, rect: [8.8, 0, 13, 3.8], use: 'bedroom', floor: oak, facade: GREY },
    { id: 'ensuite', name: { en: 'Shower room', he: 'מקלחת הורים' }, rect: [10.6, 3.8, 13, 6.0], use: 'shower', facade: GREY },
    { id: 'hall', name: { en: 'Corridor', he: 'מסדרון' }, poly: [[0, 3.8], [10.6, 3.8], [10.6, 5.0], [0, 5.0]], use: 'hall', open: ['entry'] },
    { id: 'laundry', name: { en: 'Laundry', he: 'חדר כביסה' }, rect: [0, 5.0, 3.8, 7.0], use: 'laundry' },
    { id: 'wc', name: { en: 'Guest WC', he: 'שירותי אורחים' }, rect: [3.8, 5.0, 5.4, 7.0], use: 'wc' },
    { id: 'entry', name: { en: 'Entry', he: 'כניסה' }, rect: [5.4, 5.0, 7.2, 11.0], use: 'entry', zone: 'day', facade: GREY },
    { id: 'living', name: { en: 'Living room', he: 'סלון' }, rect: [0, 7.0, 5.4, 11.0], use: 'living', zone: 'day' },
    { id: 'kitchen', name: { en: 'Kitchen and dining', he: 'מטבח ופינת אוכל' }, poly: [[7.2, 5.0], [10.6, 5.0], [10.6, 6.0], [13, 6.0], [13, 11.0], [7.2, 11.0]], use: 'kitchen', zone: 'day' },
  ],
  openings: [
    // north facade: the children's room, the bathroom's high window, the study, a high wide window
    // over the parents' bed
    { kind: 'window', x: 1.7, z: 0 }, { kind: 'high', x: 4.4, z: 0 }, { kind: 'window', x: 7.1, z: 0 },
    { kind: 'window', x: 10.85, z: 0, w: 2.0, h: 0.6, sill: 1.75 },
    // east facade: the parents' bedroom, the shower room, the kitchen window over the sink
    { kind: 'window', x: 13, z: 2.4, w: 1.2 }, { kind: 'high', x: 13, z: 4.9 },
    { kind: 'window', x: 13, z: 8.5, w: 1.6, h: 1.0, sill: 1.05 },
    // south facade: the living room's slider, the front door, the dining slider onto the terrace
    { kind: 'slider', x: 2.7, z: 11.0, w: 2.4 }, { kind: 'front', x: 6.3, z: 11.0, w: 1.0 },
    { kind: 'slider', x: 9.3, z: 11.0, w: 2.4 },
    // west facade: the living room, the laundry's high window, the corridor's end window
    { kind: 'window', x: 0, z: 9.0, w: 1.8 }, { kind: 'high', x: 0, z: 6.0 }, { kind: 'window', x: 0, z: 4.4, w: 0.8 },
    // inside doors off the corridor, and into the shower room, the WC
    { kind: 'door', x: 2.6, z: 3.8 }, { kind: 'door', x: 4.4, z: 3.8, w: 0.8 }, { kind: 'door', x: 6.0, z: 3.8 },
    { kind: 'door', x: 9.7, z: 3.8 }, { kind: 'door', x: 11.8, z: 3.8, w: 0.8 },
    { kind: 'door', x: 1.9, z: 5.0, w: 0.8 }, { kind: 'door', x: 5.4, z: 5.5, w: 0.7 },
  ],
  outdoor: {
    surfaces: [
      // the terrace under the pergola, the porch at the front door
      { box: [7.6, 11.12, 13.0, 14.2], top: 0.13, material: 'floor_porcelain_outdoor' },
      { box: [5.2, 11.12, 7.4, 12.6], top: 0.1, material: 'paving_stone' },
      // stepping slabs from the gate to the porch, gravel beds along the west and north facades
      ...stones(6.3, 12.95, 6.3, 19.6, 7),
      { box: [-1.0, 7.4, -0.13, 10.6], top: 0.03, material: 'gravel' },
      { box: [0.2, -0.9, 12.8, -0.13], top: 0.03, material: 'gravel' },
    ],
    pergolas: [{ box: [7.6, 11.12, 13.0, 14.2], height: 3.05, side: 'south', material: 'wood_walnut' }],
    canopies: [{ box: [5.2, 11.12, 7.4, 12.6], height: 2.75, side: 'south', material: 'cladding_anthracite' }],
  },
  details: {
    solarHeaters: [[2.0, 1.9, 0]],
    acUnits: [[6.0, 3.45, 2.0, 0], [11.0, 3.45, 8.5, 0]],
    downpipes: [[-0.17, 0.2], [13.17, 0.2], [-0.17, 10.8], [13.17, 10.8]],
    wallLights: [[5.55, 2.35, 11.15], [12.6, 2.35, 11.15]],
    splitACs: [[1.4, 2.8, 3.74, 'z-'], [7.6, 2.8, 3.74, 'z-'], [10.8, 2.8, 3.74, 'z-'], [0.125, 2.8, 7.8, 'x+']],
    groundACs: [[13.125, 3.5, 'x+']],
    edging: [[7.6, 14.24, 13.0, 14.24, 0.13]],
    sockets: [[8.0, 1.25, 5.06, 'z+'], [10.0, 1.25, 5.06, 'z+'], [12.875, 1.32, 9.6, 'x-'], [0.125, 0.45, 8.2, 'x+'], [8.86, 0.45, 0.8, 'x+']],
    panels: [
      // marble backsplash behind the hob run and the sink run (world heights: floor 0.15)
      ['marble_white', 7.4, 10.4, 5.06, 5.072, 1.07, 1.85],
      ['marble_white', 12.863, 12.875, 7.0, 10.0, 1.07, 1.2],
      // the living room's coffee table: an oak slab on four slim black legs
      ['wood_oak', 2.15, 3.25, 8.75, 9.35, 0.53, 0.57],
      ...[[2.18, 8.78], [3.22, 8.78], [2.18, 9.32], [3.22, 9.32]].map(([x, z]) => ['black_matte', x - 0.02, x + 0.02, z - 0.02, z + 0.02, 0.15, 0.53]),
      // an oak worktop over the washer and dryer
      ['wood_oak', 0.125, 1.65, 6.3, 6.94, 1.01, 1.045],
    ],
  },
  garden: {
    trees: [['Oak Small', 17.0, 2.0, 3, 4.5], ['Ash Small', 16.5, 9.0, 11, 4.5], ['Aspen Small', 2.0, -3.6, 5, 5.0], ['Oak Small', 1.5, 16.5, 8, 4.0]],
    bushes: [
      ...hedge(-3.0, 18.9, 4.9, 18.9, 6, 70), ...hedge(7.7, 18.9, 13.9, 18.9, 4, 80),
      ...hedge(-3.0, -4.6, -3.0, 17.8, 8, 40), ...hedge(18.9, -4.6, 18.9, 14.0, 7, 90),
    ],
    beds: [
      { kind: 'lavender', clumps: lavender([-1.0, 7.4, -0.13, 10.6], 1) },
      { kind: 'lavender', clumps: lavender([0.2, -0.9, 12.8, -0.13], 2) },
    ],
  },
  // [library model, x, z, yaw degrees, options]; yaw 0 faces south, 90 east, 180 north, -90 west
  furniture: [
    // children's room: the bed along the north wall under the window (headboard west), the desk
    // on the east wall, the wardrobe on the south wall beside the door; the middle left free
    ['interior/bed_single', 1.235, 0.74, 90, { recolor: { fabric_rust: [0.32, 0.5, 0.78] } }],
    ['interior/desk', 2.755, 2.0, -90], ['interior/wardrobe', 1.1, 3.484, 180, { scale: 0.8 }],
    // bathroom: the tub along the west wall, WC and basin on the east wall
    ['interior/bathtub', 3.835, 1.1, 90],
    ['interior/toilet_wall_hung', 5.07, 1.0, -90, { mount: true }], ['interior/vanity_sink', 5.105, 2.6, -90, { mount: true }],
    // study / guest room: a sofa bed on the east wall, the desk under the window, a bookcase
    ['interior/sofa_bed', 8.265, 1.9, -90], ['interior/desk', 6.7, 0.71, 0], ['interior/bookshelf_modern', 5.635, 1.6, 90],
    // parents' bedroom: the bed under the high window, nightstands, the wardrobe on the west wall
    ['interior/bed_double', 10.85, 1.235, 0], ['interior/nightstand_modern', 9.5, 0.35, 0], ['interior/nightstand_modern', 12.2, 0.35, 0],
    ['interior/wardrobe', 9.132, 1.7, 90, { scale: 0.85 }], ['interior/rug_large', 10.85, 2.75, 90, { scale: 0.6 }],
    // shower room
    ['interior/shower_enclosure', 12.35, 5.485, 180], ['interior/toilet_wall_hung', 10.93, 5.4, 90, { mount: true }],
    ['interior/vanity_sink', 10.895, 4.4, 90, { mount: true }],
    // laundry and guest WC
    ['interior/washing_machine', 0.6, 6.64, 180], ['interior/tumble_dryer', 1.25, 6.64, 180],
    ['interior/drawer_cabinet', 3.0, 6.695, 180],
    ['interior/toilet_wall_hung', 4.4, 6.67, 180, { mount: true }], ['interior/vanity_sink', 4.095, 5.6, 90, { mount: true }],
    // living room: the sofa on the north wall facing the garden, an armchair each side of the
    // coffee table, a lamp, a plant and pictures over the sofa
    ['interior/sofa_modern', 2.7, 7.55, 0], ['interior/rug_large', 2.7, 9.0, 90, { scale: 0.85 }],
    ['interior/armchair_modern', 0.75, 9.05, 90], ['interior/armchair_modern', 4.6, 9.05, -90],
    ['interior/floor_lamp', 0.6, 7.6, 90], ['interior/potted_plant_01', 0.55, 10.4, 0],
    ['interior/wall_art_set', 2.7, 7.075, 0, { mount: true }],
    ['interior/ceramic_vase_02', 2.45, 8.95, 0, { y: 0.39 }], ['interior/wooden_bowl_01', 2.95, 9.15, 0, { y: 0.39 }],
    ['interior/curtain_panel', 1.1, 10.79, 180],
    // kitchen: the hob run on the north wall under the wall units, tall units in the corner, the
    // sink run under the east window; the dining table for six with two pendants over it
    ['interior/kitchen_base_hob', 8.9, 5.38, 0], ['interior/kitchen_wall_units', 8.9, 5.255, 0, { y: 1.7 }],
    ['interior/kitchen_tall_units', 11.77, 6.39, 0], ['interior/kitchen_base_sink', 12.555, 8.5, -90],
    ['interior/kitchen_accessories', 9.6, 5.4, 0, { y: 0.9 }],
    ['interior/dining_table_modern', 9.0, 8.3, 0],
    ...[8.35, 9.0, 9.65].flatMap((x) => [['interior/dining_chair_modern', x, 7.25, 0], ['interior/dining_chair_modern', x, 9.35, 180]]),
    ['interior/pendant_light', 8.6, 8.3, 0, { ceiling: true }], ['interior/pendant_light', 9.4, 8.3, 0, { ceiling: true }],
    ['interior/wooden_bowl_01', 9.0, 8.3, 0, { y: 0.75 }],
    ['interior/potted_plant_01', 6.85, 10.4, 0],
    // terrace: a table for six under the pergola, pots
    ['interior/dining_table_modern', 11.6, 12.85, 0],
    ...[10.95, 11.6, 12.25].flatMap((x) => [['interior/dining_chair_modern', x, 11.8, 0], ['interior/dining_chair_modern', x, 13.9, 180]]),
    ['garden/potted_plant_02', 7.95, 11.55, 0], ['garden/potted_plant_02', 4.9, 11.6, 0],
  ],
});
