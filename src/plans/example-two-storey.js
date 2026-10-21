// A two-storey example: a family house of about 190 m2 on a 22 x 27 m plot, made up for this kit
// (not a real house or address). It shows storeys and stairs:
//   - ground floor (storey 0): one open day space - kitchen and dining on the north, the living
//     room on the south - beside an entry hall with the stairs along its west side; off the hall's
//     east side a laundry, a guest WC and a study
//   - upper floor (storey 1): set back from the west (the roof over the kitchen and living room's
//     west part stays a flat roof), a landing around the stairwell, two children's rooms, the
//     parents' room, a shower room and a family bathroom
// Rooms, openings and furniture on the upper floor carry `storey: 1` (furniture in its options).
// Panels, split ACs and roof units take world heights: the upper floor is at y 3.45 (see
// CLAUDE.md). The street is on the south, as always in this kit.
import { makePlan, GREY, stones, hedge, lavender } from '../house/kit.js';

const oak = 'floor_oak';
const up = { storey: 1 };

export default makePlan({
  id: 'example-two-storey',
  name: { en: 'Example house · two storeys', he: 'בית לדוגמה · שתי קומות' },
  site: {
    plot: [-4, -6, 18, 21],
    gate: [8.0, 9.5],
    carGate: [13.0, 17.5],
    north: 0,
  },
  rooms: [
    // ---- ground floor
    { id: 'kitchen', name: { en: 'Kitchen and dining', he: 'מטבח ופינת אוכל' }, rect: [0, 0, 7, 4.6], use: 'kitchen', zone: 'day' },
    { id: 'living', name: { en: 'Living room', he: 'סלון' }, rect: [0, 4.6, 7, 9], use: 'living', zone: 'day' },
    { id: 'hall', name: { en: 'Entry and stairs', he: 'כניסה ומדרגות' }, rect: [7, 2.0, 9.4, 9], use: 'entry', zone: 'day', facade: GREY },
    { id: 'laundry', name: { en: 'Laundry', he: 'חדר כביסה' }, rect: [7, 0, 12, 2.0], use: 'laundry' },
    { id: 'wc', name: { en: 'Guest WC', he: 'שירותי אורחים' }, rect: [9.4, 2.0, 12, 4.8], use: 'wc' },
    { id: 'study', name: { en: 'Study', he: 'חדר עבודה' }, rect: [9.4, 4.8, 12, 9], use: 'office', floor: oak },
    // ---- upper floor
    { id: 'bed2', storey: 1, name: { en: "Children's room 1", he: 'חדר ילדים 1' }, rect: [3.8, 0, 7, 4.0], use: 'bedroom', floor: oak },
    { id: 'bed3', storey: 1, name: { en: "Children's room 2", he: 'חדר ילדים 2' }, rect: [3.8, 4.0, 7, 9], use: 'bedroom', floor: oak },
    { id: 'bath', storey: 1, name: { en: 'Bathroom', he: 'אמבטיה' }, rect: [7, 0, 9.4, 1.6], use: 'bath' },
    { id: 'landing', storey: 1, name: { en: 'Landing', he: 'מבואה' }, rect: [7, 1.6, 9.4, 9], use: 'hall', facade: GREY },
    { id: 'shower', storey: 1, name: { en: 'Shower room', he: 'מקלחת' }, rect: [9.4, 0, 12, 3.6], use: 'shower', facade: GREY },
    { id: 'master', storey: 1, name: { en: "Parents' bedroom", he: 'חדר הורים' }, rect: [9.4, 3.6, 12, 9], use: 'bedroom', floor: oak, facade: GREY },
  ],
  // a straight flight in the entry hall, climbing north
  stairs: [{ from: 0, box: [7.1, 2.4, 8.1, 7.0], up: 'north' }],
  openings: [
    // ---- ground floor: the kitchen's window over the sink and its slider to the back garden,
    // the living room's slider to the terrace and its west window, the study, the service rooms
    { kind: 'window', x: 2.0, z: 0, w: 1.6, h: 1.0, sill: 1.05 }, { kind: 'slider', x: 5.3, z: 0, w: 2.0 },
    { kind: 'slider', x: 3.5, z: 9, w: 2.8 }, { kind: 'window', x: 0, z: 6.8, w: 1.6 },
    { kind: 'high', x: 10.6, z: 0 }, { kind: 'high', x: 12, z: 3.4 },
    { kind: 'window', x: 12, z: 6.9, w: 1.2 }, { kind: 'window', x: 10.7, z: 9, w: 1.4 },
    { kind: 'front', x: 8.75, z: 9, w: 1.0 },
    { kind: 'door', x: 8.75, z: 2.0, w: 0.8 }, { kind: 'door', x: 9.4, z: 3.4, w: 0.7 }, { kind: 'door', x: 9.4, z: 6.0 },
    // ---- upper floor
    { kind: 'window', x: 5.4, z: 0, w: 1.4, ...up }, { kind: 'window', x: 3.8, z: 2.0, w: 1.2, ...up },
    { kind: 'window', x: 5.4, z: 9, w: 1.6, ...up }, { kind: 'window', x: 3.8, z: 6.5, w: 1.4, ...up },
    { kind: 'window', x: 12, z: 5.6, w: 1.2, ...up }, { kind: 'high', x: 12, z: 1.8, ...up }, { kind: 'high', x: 8.2, z: 0, ...up },
    { kind: 'door', x: 7, z: 2.0, w: 0.8, ...up }, { kind: 'door', x: 7, z: 8.0, ...up },
    { kind: 'door', x: 9.4, z: 5.0, ...up }, { kind: 'door', x: 9.4, z: 2.0, w: 0.8, ...up }, { kind: 'door', x: 8.2, z: 1.6, w: 0.8, ...up },
  ],
  outdoor: {
    surfaces: [
      // the terrace under the pergola, the porch, the back deck by the kitchen slider
      { box: [0, 9.12, 7.0, 12.0], top: 0.13, material: 'floor_porcelain_outdoor' },
      { box: [7.6, 9.12, 9.9, 10.6], top: 0.1, material: 'paving_stone' },
      { box: [4.0, -2.2, 6.6, -0.12], top: 0.08, material: 'paving_stone' },
      ...stones(8.75, 10.95, 8.75, 20.6, 9),
      { box: [-1.0, 5.6, -0.13, 8.4], top: 0.03, material: 'gravel' },
    ],
    pergolas: [{ box: [0, 9.12, 7.0, 12.0], height: 3.05, side: 'south', material: 'wood_walnut' }],
    canopies: [{ box: [7.6, 9.12, 9.9, 10.6], height: 2.75, side: 'south', material: 'cladding_anthracite' }],
  },
  details: {
    // the solar heater on the upper roof, AC units on both roofs (world heights: 3.45 and 6.75)
    solarHeaters: [[6.4, 2.2, 0]],
    acUnits: [[1.8, 3.45, 2.0, 0], [10.6, 6.75, 6.4, 0]],
    downpipes: [[-0.17, 0.3], [-0.17, 8.7], [12.17, 0.3], [12.17, 8.7]],
    wallLights: [[8.0, 2.35, 9.15], [9.5, 2.35, 9.15]],
    splitACs: [[0.125, 2.8, 5.4, 'x+'], [4.6, 6.1, 3.94, 'z-'], [11.6, 6.1, 3.66, 'z+']],
    sockets: [[1.0, 1.25, 0.125, 'z+'], [0.125, 1.25, 1.6, 'x+'], [0.125, 0.45, 7.9, 'x+'], [11.875, 0.8, 7.6, 'x-']],
    panels: [
      // marble backsplash over the hob run (west wall) and the sink run (north wall)
      ['marble_white', 0.125, 0.137, 1.1, 4.1, 1.07, 1.85],
      ['marble_white', 0.5, 3.5, 0.125, 0.137, 1.07, 1.2],
      // the living room's coffee table: an oak slab on four slim black legs
      ['wood_oak', 1.55, 2.15, 6.25, 7.35, 0.53, 0.57],
      ...[[1.58, 6.28], [2.12, 6.28], [1.58, 7.32], [2.12, 7.32]].map(([x, z]) => ['black_matte', x - 0.02, x + 0.02, z - 0.02, z + 0.02, 0.15, 0.53]),
      // an oak worktop over the washer and dryer
      ['wood_oak', 10.0, 11.25, 0.125, 0.725, 1.01, 1.045],
    ],
  },
  garden: {
    trees: [['Oak Small', 2.0, -4.0, 3, 4.5], ['Ash Small', 15.5, -3.0, 11, 4.5], ['Aspen Small', 15.8, 5.0, 5, 5.0], ['Oak Small', 2.0, 17.0, 8, 4.0]],
    bushes: [
      ...hedge(-3.0, 19.9, 7.5, 19.9, 6, 70), ...hedge(10.2, 19.9, 12.4, 19.9, 2, 80),
      ...hedge(-3.0, -5.0, -3.0, 18.5, 8, 40), ...hedge(17.0, -5.0, 17.0, 14.5, 7, 90),
    ],
    beds: [{ kind: 'lavender', clumps: lavender([-1.0, 5.6, -0.13, 8.4], 1) }],
  },
  // [library model, x, z, yaw degrees, options]; upper-floor pieces carry { storey: 1 }
  furniture: [
    // ---- ground floor
    // kitchen: the sink run under the north window, the hob run on the west wall under the wall
    // units, a dining table for six with two pendants
    ['interior/kitchen_base_sink', 2.0, 0.445, 0], ['interior/kitchen_base_hob', 0.445, 2.6, 90],
    ['interior/kitchen_wall_units', 0.32, 2.6, 90, { y: 1.7 }],
    ['interior/dining_table_modern', 4.4, 2.8, 0],
    ...[3.75, 4.4, 5.05].flatMap((x) => [['interior/dining_chair_modern', x, 1.75, 0], ['interior/dining_chair_modern', x, 3.85, 180]]),
    ['interior/pendant_light', 4.0, 2.8, 0, { ceiling: true }], ['interior/pendant_light', 4.8, 2.8, 0, { ceiling: true }],
    // living room: the sofa on the west wall, two armchairs facing it, a rug and a lamp
    ['interior/sofa_modern', 0.6, 6.8, 90], ['interior/rug_large', 1.95, 6.8, 0, { scale: 0.8 }],
    ['interior/armchair_modern', 3.1, 6.3, -90], ['interior/armchair_modern', 3.1, 7.4, -90],
    ['interior/floor_lamp', 0.55, 8.4, 90], ['interior/potted_plant_01', 6.4, 8.5, 0],
    // laundry, guest WC, study
    ['interior/washing_machine', 10.3, 0.425, 0], ['interior/tumble_dryer', 10.95, 0.425, 0],
    ['interior/toilet_wall_hung', 11.605, 3.6, -90, { mount: true }], ['interior/vanity_sink', 10.8, 2.295, 0, { mount: true }],
    ['interior/desk', 11.29, 6.9, -90], ['interior/bookshelf_modern', 10.9, 5.035, 0], ['interior/sofa_bed', 10.4, 8.4, 180],
    // ---- upper floor
    // children's room 1: the bed against the south wall, the desk under the north window
    ['interior/bed_single', 5.0, 2.83, 180, { ...up, recolor: { fabric_rust: [0.32, 0.5, 0.78] } }],
    ['interior/desk', 5.4, 0.71, 0, up], ['interior/drawer_cabinet', 6.695, 3.3, -90, up],
    // children's room 2: a double bed against the north wall, nightstands, the wardrobe
    ['interior/bed_double', 5.4, 5.17, 0, up], ['interior/nightstand_modern', 4.15, 4.285, 0, up], ['interior/nightstand_modern', 6.65, 4.285, 0, up],
    ['interior/wardrobe', 6.668, 6.5, -90, { ...up, scale: 0.85 }],
    // parents' bedroom: the bed against the south wall, the wardrobe on the north wall
    ['interior/bed_double', 10.67, 7.765, 180, up], ['interior/wardrobe', 10.7, 3.932, 0, { ...up, scale: 0.85 }],
    // shower room and bathroom
    ['interior/shower_enclosure', 11.35, 0.58, 0, up], ['interior/toilet_wall_hung', 11.605, 2.0, -90, { ...up, mount: true }],
    ['interior/vanity_sink', 10.6, 3.305, 180, { ...up, mount: true }],
    ['interior/vanity_sink', 7.6, 0.36, 0, { ...up, mount: true }], ['interior/toilet_wall_hung', 9.07, 0.9, -90, { ...up, mount: true }],
    // terrace: a table for six under the pergola, clear of the living room's slider
    ['interior/dining_table_modern', 5.9, 10.6, 90],
    ...[10.0, 10.6, 11.2].flatMap((z) => [['interior/dining_chair_modern', 5.05, z, 90], ['interior/dining_chair_modern', 6.75, z, -90]]),
    ['garden/potted_plant_02', 0.5, 9.6, 0],
  ],
});
