// Every word the app shows, in English and Hebrew. English by default; Hebrew (right to left)
// when the browser prefers it or with ?lang=he (?lang=en forces English).
//
//   import { t, local, lang } from './i18n.js';
//   t('topOn')                        // 'Top view (T)'
//   t('loadedOf', { p: 40, a: 30, b: 90 })
//   local(room.name)                  // a plan's name: a string, or { en, he, ... }
//
// To add a language: add its table below (same keys) and, if it is written right to left, its
// code to RTL. Room and plan names come from the plan files and may be in any language.

const STRINGS = {
  en: {
    title: 'House Walk',
    loading: 'Loading the house…',
    downloaded: '{mb} MB downloaded',
    loadedOf: '{p}% · {a} of {b} MB',
    timeLeft: ' · about {t} left',
    seconds: '{n} seconds',
    minutes: '{n} minutes',
    preparing: '{p}% · preparing the house…',
    baking: 'Working out the light in the house (once)…',
    outside: 'Outside',
    help: 'WASD – walk · Shift – run · Space – jump · mouse – look (click to lock) · wheel – camera distance<br>V – first / third person · E – open or close a door · T – top view · M – dimensions · PgUp/PgDn – floors · H – hide help',
    topOn: 'Top view (T)',
    topOff: 'Back to walking (T)',
    dimsOn: 'Dimensions (M)',
    dimsOff: 'Hide dimensions (M)',
    planPick: 'Plan',
    qualityPick: 'Picture quality',
    qualityFast: 'Quality: fast – more frames',
    qualityBalanced: 'Quality: balanced',
    qualityHigh: 'Quality: high – sharp picture',
    hintTop: 'Top view · drag – turn · wheel – zoom · WASD – move · T – back',
    hintTopTouch: 'Top view · left stick – move · drag – turn · pinch – zoom',
    hintDoor: 'E – open / close the door',
    hintDoorTouch: '"Door" button – open / close',
    touchDoor: 'Door',
    touchJump: 'Jump',
    touchView: 'View',
    touchTop: 'Top',
    touchDims: 'Sizes',
    touchStorey: 'Floor',
    storeyGround: 'Ground floor',
    storeyN: 'Floor {n}',
    hintStoreys: 'PgUp / PgDn – floors',
    dimsAll: 'All floors: gross {g} m² · rooms net {n} m²',
    touchHelp: 'Left stick – walk (all the way out – run) · right stick or drag the screen – look',
    dimsTitle: '<b>Dimensions</b> (metres; rooms are net, between wall faces)',
    dimsGross: 'Gross built area: {a} m² · {w} × {d} m',
    dimsNet: 'Rooms, net total: {a} m²',
    dimsPlot: 'Plot (inside its boundary wall): {plot} m² · yard (without the house): {yard} m²',
    dimsRoofed: ', of which {a} m² under pergolas',
    dimsWalls: 'Outside walls {ext} cm · inside walls {int} cm · small numbers: opening widths in cm',
    metres: '{v} m',
    squareMetres: '{v} m²',
    problems: 'This plan has problems (run npm run check):',
    noAssets: 'The 3D models are not here yet. In a terminal in this folder run <code>npm run assets</code>, then reload.',
    softwareGpu: 'This browser is drawing without the graphics card ({gpu}), so the house will move slowly whatever the quality. Turn on hardware acceleration (Chrome: Settings → System → "Use graphics acceleration when available", then restart the browser) and, on a laptop, plug it in.',
    failed: 'The house could not be loaded:',
  },
  he: {
    title: 'סיור בבית',
    loading: 'טוען את הבית…',
    downloaded: '{mb} MB הורדו',
    loadedOf: '{p}% · {a} מתוך {b} MB',
    timeLeft: ' · נשארו בערך {t}',
    seconds: '{n} שניות',
    minutes: '{n} דקות',
    preparing: '{p}% · מכין את הבית…',
    baking: 'מחשב את האור בבית (פעם אחת)…',
    outside: 'בחוץ',
    help: 'WASD – הליכה · Shift – ריצה · Space – קפיצה · עכבר – הסתכלות (קליק לנעילה) · גלגלת – מרחק מצלמה<br>V – גוף ראשון / שלישי · E – פתיחה וסגירה של דלת · T – מבט מלמעלה · M – מידות · PgUp/PgDn – קומות · H – הסתר עזרה',
    topOn: 'מבט מלמעלה (T)',
    topOff: 'חזרה להליכה (T)',
    dimsOn: 'מידות (M)',
    dimsOff: 'הסתר מידות (M)',
    planPick: 'תכנית',
    qualityPick: 'איכות התמונה',
    qualityFast: 'איכות: מהירה – יותר פריימים',
    qualityBalanced: 'איכות: מאוזנת',
    qualityHigh: 'איכות: גבוהה – תמונה חדה',
    hintTop: 'מבט מלמעלה · גרירה – סיבוב · גלגלת – זום · WASD – הזזה · T – חזרה',
    hintTopTouch: 'מבט מלמעלה · עיגול שמאלי – הזזה · גרירה – סיבוב · צביטה – זום',
    hintDoor: 'E – לפתוח / לסגור את הדלת',
    hintDoorTouch: 'כפתור "דלת" – לפתוח / לסגור',
    touchDoor: 'דלת',
    touchJump: 'קפיצה',
    touchView: 'מבט',
    touchTop: 'מלמעלה',
    touchDims: 'מידות',
    touchStorey: 'קומה',
    storeyGround: 'קומת קרקע',
    storeyN: 'קומה {n}',
    hintStoreys: 'PgUp / PgDn – קומות',
    dimsAll: 'כל הקומות: ברוטו {g} מ"ר · חדרים נטו {n} מ"ר',
    touchHelp: 'עיגול שמאלי – הליכה (עד הקצה – ריצה) · עיגול ימני או גרירה על המסך – הסתכלות',
    dimsTitle: '<b>מידות</b> (מטרים; בחדרים – נטו בין פני הקירות)',
    dimsGross: 'שטח בנוי ברוטו: {a} מ"ר · {w} × {d} מ\'',
    dimsNet: 'סך שטח החדרים נטו: {a} מ"ר',
    dimsPlot: 'שטח המגרש (לפי קיר הגבול): {plot} מ"ר · חצר (בלי הבית): {yard} מ"ר',
    dimsRoofed: ', מתוכה {a} מ"ר מתחת לפרגולה',
    dimsWalls: 'קירות חוץ {ext} ס"מ · קירות פנים {int} ס"מ · מספרים קטנים: רוחב פתחים בס"מ',
    metres: '{v} מ\'',
    squareMetres: '{v} מ"ר',
    problems: 'בתכנית יש בעיות (הריצו npm run check):',
    noAssets: 'המודלים התלת־ממדיים עוד לא כאן. בטרמינל בתיקייה הזו הריצו <code>npm run assets</code> וטענו מחדש.',
    softwareGpu: 'הדפדפן מצייר בלי כרטיס המסך ({gpu}), ולכן הבית יזוז לאט בכל איכות. הפעילו האצת חומרה (בכרום: הגדרות → מערכת → "שימוש בהאצת גרפיקה כשאפשר", ואז הפעלה מחדש של הדפדפן), ובמחשב נייד חברו אותו לחשמל.',
    failed: 'לא הצלחנו לטעון את הבית:',
  },
};
const RTL = new Set(['he', 'ar', 'fa', 'ur']);

function pick() {
  const asked = new URLSearchParams(location.search).get('lang');
  if (asked && STRINGS[asked]) return asked;
  for (const l of navigator.languages ?? [navigator.language]) {
    const code = l.toLowerCase().split('-')[0];
    if (code === 'iw') return 'he';
    if (STRINGS[code]) return code;
  }
  return 'en';
}

export const lang = pick();
export const dir = RTL.has(lang) ? 'rtl' : 'ltr';

export function t(key, vars = {}) {
  const s = STRINGS[lang][key] ?? STRINGS.en[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}

// a name from a plan: a plain string in any language, or one per language { en, he, ... }
export function local(v) {
  if (v == null || typeof v === 'string') return v;
  return v[lang] ?? v.en ?? Object.values(v)[0];
}

// the page's own text: <html lang dir> and every element with data-i18n (its text) or
// data-i18n-label (its aria-label)
export function applyPage(root = document) {
  document.documentElement.lang = lang;
  document.documentElement.dir = dir;
  document.title = t('title');
  for (const el of root.querySelectorAll('[data-i18n]')) el.innerHTML = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-label]')) el.setAttribute('aria-label', t(el.dataset.i18nLabel));
}
