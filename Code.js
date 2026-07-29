// Fitness Tracker — GAS Web App

const WEIGHT_SHEET    = 'Weight';
const FOODS_SHEET     = 'Foods';
const FOOD_LOG_SHEET  = 'FoodLog';
const ACT_SHEET       = 'Activities';
const ACT_LOG_SHEET   = 'ActivityLog';
const MED_SYR_SHEET   = 'MedSyringes';
const MED_SHOTS_SHEET   = 'MedShots';
const SHOTS_PER_SYRINGE = 4;
const WORKOUT_LOG_SHEET = 'WorkoutLog';
const INBOX_LOG_SHEET   = 'InboxLog';

// ── Sheet schemas — single source of truth ────────────────────────────────────
// Column order defined here drives: initFitness/initMeds header rows,
// all read/write index lookups, and validateSheets() header checks.
// To change a column: update the array here — indices shift everywhere.
//
// NOTE on Foods: the sheet columns are ['name','serving_size','serving_note',
// 'calories_per_serving'] but getFoods() returns {serving_name, serving_size}
// (JS property names that predate this schema). serving_name comes from col F.serving_size
// and serving_size comes from col F.serving_note — legacy naming mismatch,
// preserved intentionally. See comment above getFoods().
const SCHEMA = {
  weight:    ['date', 'weight_lbs', 'net_calories', 'delta_weight', 'interpolated', 'food_calories', 'cal_deficit'],
  foods:     ['name', 'serving_size', 'serving_note', 'calories_per_serving'],
  food_log:  ['timestamp', 'date', 'food_name', 'num_servings', 'calories_total', 'meal'],
  act:       ['name', 'type', 'unit', 'goal', 'calories', 'cal_weight1', 'cal_per_unit1', 'cal_weight2', 'cal_per_unit2'],
  act_log:   ['timestamp', 'date', 'activity_name', 'value', 'calories_burned'],
  med_syr:   ['syringe_id', 'order_id', 'date_ordered', 'date_expected', 'date_received', 'date_depleted', 'notes'],
  med_shots:   ['timestamp', 'date', 'syringe_id', 'shot_num', 'notes'],
  workout_log: ['timestamp', 'date', 'warmup', 'push', 'pull', 'legs', 'core', 'cooldown', 'notes'],
  inbox_log:   ['timestamp', 'date', 'processed', 'outstanding', 'minutes', 'notes']
};

// Column data types — used by auditAndFixSheets() and applySheetFormatting().
// 'date'/'datetime' columns get date-number-format applied automatically.
const SCHEMA_TYPES = {
  weight:    { date: 'date', weight_lbs: 'number', net_calories: 'number_optional', delta_weight: 'number_optional', interpolated: 'number_optional', food_calories: 'number_optional', cal_deficit: 'number_optional' },
  foods:     { name: 'text_required', serving_size: 'text', serving_note: 'text', calories_per_serving: 'number' },
  food_log:  { timestamp: 'datetime', date: 'date', food_name: 'text_required', num_servings: 'number', calories_total: 'number', meal: 'text' },
  act:       { name: 'text_required', type: 'text', unit: 'text', goal: 'text', calories: 'number', cal_weight1: 'number_optional', cal_per_unit1: 'number_optional', cal_weight2: 'number_optional', cal_per_unit2: 'number_optional' },
  act_log:   { timestamp: 'datetime', date: 'date', activity_name: 'text_required', value: 'any', calories_burned: 'number' },
  med_syr:   { syringe_id: 'number', order_id: 'text_required', date_ordered: 'date', date_expected: 'date', date_received: 'date', date_depleted: 'date', notes: 'text' },
  med_shots:   { timestamp: 'datetime', date: 'date', syringe_id: 'number', shot_num: 'number', notes: 'text' },
  workout_log: { timestamp: 'datetime', date: 'date', warmup: 'text', push: 'text', pull: 'text', legs: 'text', core: 'text', cooldown: 'text', notes: 'text' },
  inbox_log:   { timestamp: 'datetime', date: 'date', processed: 'number', outstanding: 'number', minutes: 'number_optional', notes: 'text' }
};

// Date display formats — applied to 'date' and 'datetime' columns in all sheets.
const DATE_FORMAT     = 'ddd, MM/dd/yyyy';
const DATETIME_FORMAT = 'ddd, MM/dd/yyyy HH:mm';

function _mkCols(arr) {
  return arr.reduce(function(o, k, i) { o[k] = i; return o; }, {});
}

const W  = _mkCols(SCHEMA.weight);    // W.date, W.weight_lbs, W.net_calories, …
const F  = _mkCols(SCHEMA.foods);     // F.name, F.serving_size, …
const FL = _mkCols(SCHEMA.food_log);  // FL.timestamp, FL.date, FL.food_name, …
const A  = _mkCols(SCHEMA.act);       // A.name, A.type, A.calories, …
const AL = _mkCols(SCHEMA.act_log);   // AL.timestamp, AL.date, AL.activity_name, …
const MS = _mkCols(SCHEMA.med_syr);   // MS.syringe_id, MS.order_id, MS.date_received, …
const MH = _mkCols(SCHEMA.med_shots);    // MH.timestamp, MH.date, MH.syringe_id, …
const WL = _mkCols(SCHEMA.workout_log); // WL.timestamp, WL.date, WL.warmup, …
const IL = _mkCols(SCHEMA.inbox_log);   // IL.timestamp, IL.date, IL.processed, …

// SCHEMA_MAP ties sheet constants to their schema/types for iteration.
// Used by validateSheets(), formatAllSheets(), and auditAndFixSheets().
const SCHEMA_MAP = [
  { name: WEIGHT_SHEET,    key: 'weight'    },
  { name: FOODS_SHEET,     key: 'foods'     },
  { name: FOOD_LOG_SHEET,  key: 'food_log'  },
  { name: ACT_SHEET,       key: 'act'       },
  { name: ACT_LOG_SHEET,   key: 'act_log'   },
  { name: MED_SYR_SHEET,   key: 'med_syr'   },
  { name: MED_SHOTS_SHEET,   key: 'med_shots'   },
  { name: WORKOUT_LOG_SHEET, key: 'workout_log' },
  { name: INBOX_LOG_SHEET,   key: 'inbox_log'   }
];

function doGet() {
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('Fitness Tracker')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ── Spreadsheet helpers ───────────────────────────────────────────────────────

function _ss() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('Run initFitness() first to connect your spreadsheet.');
  return SpreadsheetApp.openById(id);
}

function _sheet(name) { return _ss().getSheetByName(name); }

function _today() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function _ts() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
}

// Sheets auto-converts date-like strings to Date objects on read — normalize to yyyy-MM-dd.
function _dateStr(val) {
  if (!val) return '';
  if (val instanceof Date) return Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return String(val).substring(0, 10);
}

// Normalize to yyyy-MM-dd HH:mm:ss string for timestamp matching.
function _tsStr(val) {
  if (!val) return '';
  if (val instanceof Date) return Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
  return String(val);
}

// ── Sheet formatting ──────────────────────────────────────────────────────────

// Applies standard formatting to a single sheet:
//   - Row 1 bold, frozen, filter on all columns
//   - Date/datetime columns formatted as DATE_FORMAT / DATETIME_FORMAT
// Safe to call on any sheet at any time (idempotent).
function applySheetFormatting(sh, schemaKey) {
  var schema = SCHEMA[schemaKey];
  var types  = SCHEMA_TYPES[schemaKey];
  if (!schema || !types) return;
  var lastCol = schema.length;
  var lastRow = Math.max(sh.getLastRow(), 2);

  sh.getRange(1, 1, 1, lastCol).setFontWeight('bold');
  sh.setFrozenRows(1);

  try { var f = sh.getFilter(); if (f) f.remove(); } catch (e) {}
  sh.getRange(1, 1, lastRow, lastCol).createFilter();

  // Format the full column so future rows inherit the format automatically.
  var maxRow = sh.getMaxRows();
  schema.forEach(function(col, i) {
    var type = types[col];
    if (type === 'date') {
      sh.getRange(2, i + 1, maxRow - 1, 1).setNumberFormat(DATE_FORMAT);
    } else if (type === 'datetime') {
      sh.getRange(2, i + 1, maxRow - 1, 1).setNumberFormat(DATETIME_FORMAT);
    }
  });
}

// Run from the Apps Script editor to apply bold headers, frozen rows, filters,
// and date column formatting to every sheet at once. Safe to re-run.
function formatAllSheets() {
  var ss = _ss();
  var results = [];
  SCHEMA_MAP.forEach(function(entry) {
    var sh = ss.getSheetByName(entry.name);
    if (!sh) { results.push(entry.name + ': not found, skipped'); return; }
    applySheetFormatting(sh, entry.key);
    results.push(entry.name + ': formatted');
  });
  return results.join('\n');
}

// ── One-time init ─────────────────────────────────────────────────────────────

function initFitness() {
  const SPREADSHEET_ID = '11pxgECbfHoNQjZ8nijB6101XWsfNSa53eReusdBz4rE';
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', SPREADSHEET_ID);

  function ensure(name, schemaKey) {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    if (sh.getLastRow() === 0) sh.appendRow(SCHEMA[schemaKey]);
    applySheetFormatting(sh, schemaKey);
    return sh;
  }

  ensure(WEIGHT_SHEET,    'weight');
  ensure(FOODS_SHEET,     'foods');
  ensure(FOOD_LOG_SHEET,  'food_log');
  ensure(ACT_SHEET,       'act');
  ensure(ACT_LOG_SHEET,   'act_log');
  ensure(WORKOUT_LOG_SHEET, 'workout_log');
  ensure(INBOX_LOG_SHEET,   'inbox_log');

  return 'Fitness Tracker initialized. Spreadsheet: ' + ss.getUrl();
}

// ── Daily stats — fill Weight sheet computed columns ─────────────────────────
//
// Writes net_calories (food - activity) and delta_weight (today - yesterday)
// into Weight cols C and D for every row that has a weight entry.
// Fixes the Weight header row on every run (handles the 'timestamp' -> 'date' rename).
// Returns the enriched weight list sorted by date ascending.
// Restored from Apps Script version 40 -- this and the chain it feeds
// (logWeight's gap-fill, getWeightHistory, drawCalStats in index.html) were
// lost from a later edit that was never captured in a git commit.

function computeDailyStats() {
  const ss     = _ss();
  const wSheet = ss.getSheetByName(WEIGHT_SHEET);
  const fSheet = ss.getSheetByName(FOOD_LOG_SHEET);
  const aSheet = ss.getSheetByName(ACT_LOG_SHEET);

  // Always write the canonical header row (handles prior 'timestamp' label and col count).
  wSheet.getRange(1, 1, 1, SCHEMA.weight.length).setValues([SCHEMA.weight]);

  const wLastRow = wSheet.getLastRow();
  if (wLastRow < 2) return [];

  // Read all weight data rows (C/D/F/G may be blank on first run).
  const wCols = Math.max(wSheet.getLastColumn(), SCHEMA.weight.length);
  const wRows = wSheet.getRange(2, 1, wLastRow - 1, wCols).getValues();

  // Sum food calories per date from FoodLog.
  const foodTotals = {};
  if (fSheet && fSheet.getLastRow() > 1) {
    fSheet.getRange(2, 1, fSheet.getLastRow() - 1, SCHEMA.food_log.length).getValues().forEach(r => {
      const d = _dateStr(r[FL.date]);
      if (d) foodTotals[d] = (foodTotals[d] || 0) + (parseFloat(r[FL.calories_total]) || 0);
    });
  }

  // Sum calories burned per date from ActivityLog.
  const actTotals = {};
  if (aSheet && aSheet.getLastRow() > 1) {
    aSheet.getRange(2, 1, aSheet.getLastRow() - 1, SCHEMA.act_log.length).getValues().forEach(r => {
      const d = _dateStr(r[AL.date]);
      if (d) actTotals[d] = (actTotals[d] || 0) + (parseFloat(r[AL.calories_burned]) || 0);
    });
  }

  // Build a sorted list of rows that have valid weight entries.
  const valid = wRows
    .map((r, i) => ({ i, date: _dateStr(r[W.date]), weight: parseFloat(r[W.weight_lbs]) || 0 }))
    .filter(r => r.date && r.weight)
    .sort((a, b) => a.date.localeCompare(b.date));

  // Load BMR settings once -- needed to compute per-row TDEE.
  const bmr = getBMRSettings();

  // Compute all derived columns for each valid row.
  // net_calories   = food - activity_burn; blank when no food logged.
  // delta_weight   = today - yesterday (negative = lost); blank for first entry (no prior day).
  // food_calories  = raw food intake; blank when no food logged.
  // cal_deficit    = TDEE - net_calories (positive = deficit; negative = surplus).
  const computed = {};
  valid.forEach((row, idx) => {
    const food  = foodTotals[row.date] || 0;
    const burn  = Math.round(actTotals[row.date] || 0);
    const net   = food > 0 ? Math.round(food - burn) : '';
    const delta = idx === 0 ? '' : Math.round((row.weight - valid[idx - 1].weight) * 10) / 10;
    const tdee  = _computeTDEE(row.weight, bmr);
    const def   = (net !== '' && tdee) ? Math.round(tdee - net) : '';
    computed[row.i] = { net, delta, food: food > 0 ? Math.round(food) : '', def };
  });

  // Write computed cols in one operation; interpolated is read from wRows to preserve it.
  const writeAll = wRows.map((r, i) => [
    computed[i] ? computed[i].net   : '',
    computed[i] ? computed[i].delta : '',
    r[W.interpolated],
    computed[i] ? computed[i].food  : '',
    computed[i] ? computed[i].def   : ''
  ]);
  wSheet.getRange(2, W.net_calories + 1, writeAll.length, SCHEMA.weight.length - W.net_calories).setValues(writeAll);

  // Return enriched list for immediate use by getHistoryPage.
  return valid.map(row => ({
    date:          row.date,
    weight:        Math.round(row.weight * 10) / 10,
    net_calories:  computed[row.i].net  !== '' ? computed[row.i].net  : null,
    delta_weight:  computed[row.i].delta !== '' ? computed[row.i].delta : null,
    food_calories: computed[row.i].food !== '' ? computed[row.i].food : null,
    cal_deficit:   computed[row.i].def  !== '' ? computed[row.i].def  : null
  }));
}

// ── Weight — chronological, one entry per day ────────────────────────────────
//
// When a weight is logged for date D:
//   1. Any gap days between the last real weight and D are forward-filled with
//      that last real weight and marked interpolated=1.
//   2. If D already has an interpolated value it is overwritten with the real one.
//   3. The sheet is always rewritten in chronological order.

function logWeight(weight, date) {
  const d         = date || _today();
  const newWeight = parseFloat(weight);
  const sheet     = _sheet(WEIGHT_SHEET);
  const lastRow   = sheet.getLastRow();
  const nCols     = Math.max(sheet.getLastColumn(), SCHEMA.weight.length);

  // Read all existing data rows.
  const existing = lastRow > 1
    ? sheet.getRange(2, 1, lastRow - 1, nCols).getValues()
    : [];

  // Build map: date -> { weight, interpolated }
  const rowMap = {};
  existing.forEach(r => {
    const rd = _dateStr(r[W.date]);
    if (rd && parseFloat(r[W.weight_lbs])) rowMap[rd] = { weight: parseFloat(r[W.weight_lbs]), interpolated: !!(r[W.interpolated]) };
  });

  // Mark the logged date as a real (non-interpolated) entry.
  rowMap[d] = { weight: newWeight, interpolated: false };

  // Find the last real weight strictly before d (used as gap-fill value).
  const prevRealDates = Object.keys(rowMap)
    .filter(rd => rd < d && !rowMap[rd].interpolated && rowMap[rd].weight)
    .sort();

  if (prevRealDates.length > 0) {
    const lastRealDate = prevRealDates[prevRealDates.length - 1];
    const fillWeight   = rowMap[lastRealDate].weight;
    const cursor       = new Date(lastRealDate + 'T12:00:00');
    const target       = new Date(d + 'T12:00:00');
    cursor.setDate(cursor.getDate() + 1);
    while (cursor < target) {
      const gd = Utilities.formatDate(cursor, Session.getScriptTimeZone(), 'yyyy-MM-dd');
      // Only fill days that have no real entry already.
      if (!rowMap[gd] || rowMap[gd].interpolated) {
        rowMap[gd] = { weight: fillWeight, interpolated: true };
      }
      cursor.setDate(cursor.getDate() + 1);
    }
  }

  // Update any interpolated rows between d and the next real entry after d.
  // These were previously forward-filled from an older weight; re-fill from newWeight.
  const nextRealDates = Object.keys(rowMap)
    .filter(rd => rd > d && !rowMap[rd].interpolated && rowMap[rd].weight)
    .sort();
  const nextRealDate = nextRealDates.length ? nextRealDates[0] : null;
  const fwdCursor    = new Date(d + 'T12:00:00');
  const fwdTarget    = nextRealDate ? new Date(nextRealDate + 'T12:00:00') : null;
  fwdCursor.setDate(fwdCursor.getDate() + 1);
  while (fwdTarget && fwdCursor < fwdTarget) {
    const gd = Utilities.formatDate(fwdCursor, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    if (rowMap[gd] && rowMap[gd].interpolated) {
      rowMap[gd] = { weight: newWeight, interpolated: true };
    }
    fwdCursor.setDate(fwdCursor.getDate() + 1);
  }

  // Rebuild sheet: clear old rows, write all rows sorted by date.
  const sortedDates = Object.keys(rowMap).sort();
  const writeRows   = sortedDates.map(rd => [
    rd, rowMap[rd].weight, '', '', rowMap[rd].interpolated ? 1 : '', '', ''
  ]);

  if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, nCols).clearContent();
  if (writeRows.length > 0) sheet.getRange(2, 1, writeRows.length, SCHEMA.weight.length).setValues(writeRows);

  return getDateWeight(d);
}

function getDateWeight(date) {
  const d    = date || _today();
  const rows = _sheet(WEIGHT_SHEET).getDataRange().getValues().slice(1);
  const row  = rows.find(r => _dateStr(r[W.date]) === d && r[W.weight_lbs]);
  return { weight: row ? Math.round(parseFloat(row[W.weight_lbs]) * 10) / 10 : null };
}

function getTodayWeight() { return getDateWeight(_today()); }

function getWeightHistory(days) {
  days = parseInt(days) || 30;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const sh   = _sheet(WEIGHT_SHEET);
  const nCol = Math.max(sh.getLastColumn(), SCHEMA.weight.length);
  const rows = sh.getRange(1, 1, sh.getLastRow(), nCol).getValues().slice(1);
  return rows
    .filter(r => r[W.weight_lbs] && new Date(_dateStr(r[W.date]) + 'T12:00:00') >= cutoff)
    .map(r => ({
      date:          _dateStr(r[W.date]),
      weight:        Math.round(parseFloat(r[W.weight_lbs]) * 10) / 10,
      net_calories:  (r[W.net_calories]  !== '' && r[W.net_calories]  != null) ? (parseFloat(r[W.net_calories])  || null) : null,
      delta_weight:  (r[W.delta_weight]  !== '' && r[W.delta_weight]  != null) ? parseFloat(r[W.delta_weight])          : null,
      interpolated:  !!(r[W.interpolated]),
      food_calories: (r[W.food_calories] !== '' && r[W.food_calories] != null) ? (parseFloat(r[W.food_calories]) || null) : null,
      cal_deficit:   (r[W.cal_deficit]   !== '' && r[W.cal_deficit]   != null) ? parseFloat(r[W.cal_deficit])           : null
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ── Foods config ──────────────────────────────────────────────────────────────
// Columns (by position, not by header text): name, serving_size, serving_note,
// calories_per_serving. The serving_name/serving_size identifiers below are
// just this code's own internal property names -- they are read/written by
// column INDEX only (r[1], r[2]), never by looking up the sheet's header row,
// so they don't need to match whatever text is actually in row 1. Don't
// assume a "mismatch" between these names and the sheet's header text means
// anything is broken -- check whether the DATA is in the right column
// (sample real rows), not whether a label matches a JS variable name.

function getFoods() {
  const rows = _sheet(FOODS_SHEET).getDataRange().getValues().slice(1);
  // serving_name/serving_size are legacy JS names: serving_name → F.serving_size col,
  // serving_size → F.serving_note col. See SCHEMA note at top.
  return rows.filter(r => r[F.name]).map(r => ({
    name: r[F.name], serving_name: r[F.serving_size], serving_size: r[F.serving_note],
    calories_per_serving: parseFloat(r[F.calories_per_serving]) || 0
  }));
}

function saveFood(data) {
  const sheet = _sheet(FOODS_SHEET);
  const rows  = sheet.getDataRange().getValues();
  const match = data._originalName || data.name;
  const row   = [data.name, data.serving_name, data.serving_size, parseFloat(data.calories_per_serving)];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][F.name] === match) {
      sheet.getRange(i + 1, 1, 1, SCHEMA.foods.length).setValues([row]);
      return getFoods();
    }
  }
  sheet.appendRow(row);
  return getFoods();
}

function deleteFood(name) {
  const sheet = _sheet(FOODS_SHEET);
  const rows  = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][F.name] === name) { sheet.deleteRow(i + 1); break; }
  }
  return getFoods();
}

// ── Food log ──────────────────────────────────────────────────────────────────

function logFood(foodName, numServings, caloriesTotal, date, meal) {
  const d = date || _today();
  _sheet(FOOD_LOG_SHEET).appendRow([_ts(), d, foodName, parseFloat(numServings), parseFloat(caloriesTotal), meal || '']);
  return getDateFood(d);
}

function deleteFoodEntry(timestamp, date) {
  const sheet = _sheet(FOOD_LOG_SHEET);
  const rows  = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (_tsStr(rows[i][FL.timestamp]) === String(timestamp)) { sheet.deleteRow(i + 1); break; }
  }
  return getDateFood(date || _today());
}

function getDateFood(date) {
  const d       = date || _today();
  const rows    = _sheet(FOOD_LOG_SHEET).getDataRange().getValues().slice(1);
  const entries = rows.filter(r => _dateStr(r[FL.date]) === d && r[FL.food_name]).map(r => ({
    timestamp: _tsStr(r[FL.timestamp]), food_name: r[FL.food_name],
    num_servings: parseFloat(r[FL.num_servings]), calories: parseFloat(r[FL.calories_total]), meal: r[FL.meal] || ''
  }));
  return { entries, total_calories: Math.round(entries.reduce((s, e) => s + (e.calories || 0), 0)) };
}

function getTodayFood() { return getDateFood(_today()); }

function getFoodLog(days) {
  days = parseInt(days) || 7;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const rows   = _sheet(FOOD_LOG_SHEET).getDataRange().getValues().slice(1);
  const result = {};
  rows.filter(r => r[FL.date] && new Date(_dateStr(r[FL.date]) + 'T12:00:00') >= cutoff).forEach(r => {
    const d = _dateStr(r[FL.date]);
    if (!result[d]) result[d] = { entries: [], total_calories: 0 };
    result[d].entries.push({ timestamp: _tsStr(r[FL.timestamp]), food_name: r[FL.food_name], num_servings: parseFloat(r[FL.num_servings]), calories: parseFloat(r[FL.calories_total]), meal: r[FL.meal] || '' });
    result[d].total_calories += parseFloat(r[FL.calories_total]) || 0;
  });
  Object.values(result).forEach(day => { day.total_calories = Math.round(day.total_calories); });
  return result;
}

// ── Activities config ─────────────────────────────────────────────────────────

function getActivities() {
  const rows = _sheet(ACT_SHEET).getDataRange().getValues().slice(1);
  return rows.filter(r => r[A.name]).map(r => ({
    name: r[A.name], type: r[A.type] || 'checkbox', unit: r[A.unit] || '', goal: r[A.goal] || '',
    calories:      parseFloat(r[A.calories])      || 0,
    cal_weight1:   parseFloat(r[A.cal_weight1])   || 0,
    cal_per_unit1: parseFloat(r[A.cal_per_unit1]) || 0,
    cal_weight2:   parseFloat(r[A.cal_weight2])   || 0,
    cal_per_unit2: parseFloat(r[A.cal_per_unit2]) || 0
  }));
}

function saveActivity(data) {
  const sheet = _sheet(ACT_SHEET);
  const rows  = sheet.getDataRange().getValues();
  const match = data._originalName || data.name;
  const row   = [
    data.name, data.type || 'checkbox', data.unit || '', data.goal || '',
    parseFloat(data.calories)      || 0,
    parseFloat(data.cal_weight1)   || 0,
    parseFloat(data.cal_per_unit1) || 0,
    parseFloat(data.cal_weight2)   || 0,
    parseFloat(data.cal_per_unit2) || 0
  ];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][A.name] === match) {
      sheet.getRange(i + 1, 1, 1, SCHEMA.act.length).setValues([row]);
      return getActivities();
    }
  }
  sheet.appendRow(row);
  return getActivities();
}

function deleteActivity(name) {
  const sheet = _sheet(ACT_SHEET);
  const rows  = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][A.name] === name) { sheet.deleteRow(i + 1); break; }
  }
  return getActivities();
}

// ── Activity log ──────────────────────────────────────────────────────────────
// Schema: [timestamp, date, activity_name, value, calories_burned]

function logActivity(actName, value, caloriesBurned, date) {
  const d = date || _today();
  _sheet(ACT_LOG_SHEET).appendRow([_ts(), d, actName, value, parseFloat(caloriesBurned) || 0]);
  return getDateActivities(d);
}

function deleteActivityEntry(timestamp, date) {
  const sheet = _sheet(ACT_LOG_SHEET);
  const rows  = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (_tsStr(rows[i][AL.timestamp]) === String(timestamp)) { sheet.deleteRow(i + 1); break; }
  }
  return getDateActivities(date || _today());
}

function getDateActivities(date) {
  const d    = date || _today();
  const rows = _sheet(ACT_LOG_SHEET).getDataRange().getValues().slice(1);
  return rows
    .filter(r => {
      const ts = _tsStr(r[AL.timestamp]);
      return ts.length > 10 && _dateStr(r[AL.date]) === d && r[AL.activity_name];
    })
    .map(r => ({
      timestamp:       _tsStr(r[AL.timestamp]),
      activity_name:   String(r[AL.activity_name]),
      value:           r[AL.value],
      calories_burned: parseFloat(r[AL.calories_burned]) || 0
    }));
}

function getTodayActivities() { return getDateActivities(_today()); }

function getActivityLog(days) {
  days = parseInt(days) || 7;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const rows   = _sheet(ACT_LOG_SHEET).getDataRange().getValues().slice(1);
  const result = {};
  rows
    .filter(r => {
      const ts = _tsStr(r[AL.timestamp]);
      return ts.length > 10 && r[AL.date] && new Date(_dateStr(r[AL.date]) + 'T12:00:00') >= cutoff;
    })
    .forEach(r => {
      const d = _dateStr(r[AL.date]);
      if (!result[d]) result[d] = [];
      result[d].push({
        timestamp:       _tsStr(r[AL.timestamp]),
        activity_name:   String(r[AL.activity_name]),
        value:           r[AL.value],
        calories_burned: parseFloat(r[AL.calories_burned]) || 0
      });
    });
  return result;
}

// ── Daily calorie goal ────────────────────────────────────────────────────────

function getGoal() {
  const v = PropertiesService.getScriptProperties().getProperty('DAILY_CALORIE_GOAL');
  return v ? parseInt(v) : 0;
}

function setGoal(n) {
  PropertiesService.getScriptProperties().setProperty('DAILY_CALORIE_GOAL', String(parseInt(n) || 0));
  return getGoal();
}

// ── BMR / TDEE settings ───────────────────────────────────────────────────────

function getBMRSettings() {
  const p = PropertiesService.getScriptProperties();
  return {
    weight1:     parseFloat(p.getProperty('BMR_WEIGHT1'))     || 0,
    tdee1:       parseFloat(p.getProperty('BMR_TDEE1'))       || 0,
    weight2:     parseFloat(p.getProperty('BMR_WEIGHT2'))     || 0,
    tdee2:       parseFloat(p.getProperty('BMR_TDEE2'))       || 0,
    baseSteps:   parseInt(p.getProperty('BMR_BASE_STEPS'))    || 0,
    goalLbsWeek: parseFloat(p.getProperty('GOAL_LBS_WEEK'))   || 0
  };
}

function setBMRSettings(data) {
  PropertiesService.getScriptProperties().setProperties({
    BMR_WEIGHT1:    String(parseFloat(data.weight1)     || 0),
    BMR_TDEE1:      String(parseFloat(data.tdee1)       || 0),
    BMR_WEIGHT2:    String(parseFloat(data.weight2)     || 0),
    BMR_TDEE2:      String(parseFloat(data.tdee2)       || 0),
    BMR_BASE_STEPS: String(parseInt(data.baseSteps)     || 0),
    GOAL_LBS_WEEK:  String(parseFloat(data.goalLbsWeek) || 0)
  });
  return getBMRSettings();
}

function _computeTDEE(weight, s) {
  if (!s.weight1 || !s.tdee1 || !s.weight2 || !s.tdee2 || s.weight1 === s.weight2) return 0;
  const slope = (s.tdee2 - s.tdee1) / (s.weight2 - s.weight1);
  return Math.round(s.tdee1 + slope * (weight - s.weight1));
}

// ── One-time maintenance (run manually from the Apps Script editor) ───────────
// Run via: Extensions > Apps Script > select auditAndFixSheets > Run.
// View results: View > Logs (or the returned value in the execution log).

function auditAndFixSheets() {
  const ss  = _ss();
  const log = [];

  // 1. Remove a blank Sheet1 (Google auto-creates one for every new spreadsheet).
  const sheet1 = ss.getSheetByName('Sheet1');
  if (!sheet1) {
    log.push('Sheet1: not present -- OK.');
  } else {
    const isBlank = !sheet1.getDataRange().getValues().some(row => row.some(cell => cell !== ''));
    if (isBlank) {
      ss.deleteSheet(sheet1);
      log.push('Sheet1: was blank -- removed.');
    } else {
      log.push('Sheet1: NOT blank -- left alone, review manually before deleting.');
    }
  }

  // 2. Check every sheet's header row for presence and correctness against the
  //    canonical schema. Only auto-writes headers when the row is fully blank
  //    (no data to misalign); any other mismatch is reported, not auto-fixed,
  //    since silently relabeling could mask a real column-order problem.
  //
  //    Header text alone doesn't prove the data is right (or wrong) -- this
  //    code reads/writes by fixed column index, never by header name. Three
  //    independent checks run per sheet, because a text/order comparison of
  //    the header row by itself CANNOT detect a shift (a blank-header column
  //    sitting right next to its real, mislabeled data looks identical to a
  //    blank-header column with no data at all, under a pure text compare):
  //      a) header text vs. expected, in order (quick signal, not proof)
  //      b) data-quality scan at the code's fixed column positions, by type
  //      c) column-by-column header-vs-fill-rate, every column, every row --
  //         this is the one that actually answers "do headings align with
  //         data" by checking each column's fill pattern against its header,
  //         not just comparing header text to a hardcoded list
  //
  //    IMPORTANT: these lists must match the actual chosen header TEXT in
  //    each sheet -- they intentionally do NOT have to match the JS property
  //    names used elsewhere in this file (e.g. getFoods()'s serving_name/
  //    serving_size are just internal variable names, unrelated to what the
  //    Foods sheet's header row actually says). Update this list by hand
  //    whenever you deliberately change a header label; don't assume it can
  //    be derived from the code that reads the column.
  // expected{} and colTypes{} are derived from SCHEMA_MAP — the single source of truth.
  const expected  = {};
  const colTypes  = {};
  SCHEMA_MAP.forEach(function(e) {
    expected[e.name] = SCHEMA[e.key];
    colTypes[e.name] = SCHEMA[e.key].map(function(col) { return SCHEMA_TYPES[e.key][col] || 'any'; });
  });

  // colTypes derived above from SCHEMA_TYPES via SCHEMA_MAP.

  function isOk(val, type) {
    if (type === 'any') return true;
    if (type === 'date' || type === 'datetime') {
      return (val instanceof Date) || (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}/.test(val));
    }
    if (type === 'number') return val !== '' && val != null && !isNaN(parseFloat(val));
    if (type === 'number_optional') return val === '' || val == null || !isNaN(parseFloat(val));
    if (type === 'text_required') return val !== '' && val != null;
    return true; // plain 'text' -- blank is allowed (e.g. optional notes/meal)
  }

  function scanDataQuality(sh, types, headers) {
    const lastRow = sh.getLastRow();
    if (lastRow < 2) return ['  (no data rows to check)'];
    const data   = sh.getRange(2, 1, lastRow - 1, types.length).getValues();
    const issues = [];
    types.forEach(function (type, colIdx) {
      const badRows = [];
      data.forEach(function (row, rowIdx) {
        if (!isOk(row[colIdx], type)) badRows.push(rowIdx + 2);
      });
      if (badRows.length) {
        issues.push('  column "' + headers[colIdx] + '" (expects ' + type + '): ' +
          badRows.length + ' bad value(s) -- row(s) ' + badRows.slice(0, 5).join(', ') +
          (badRows.length > 5 ? ', ...' : ''));
      }
    });
    return issues.length ? issues : ['  data quality OK (' + (lastRow - 1) + ' row(s) checked)'];
  }

  // The real alignment check: does each column's HEADER agree with whether
  // that column actually HAS data, across every row (not a sample, not just
  // type-matching)? This is what a simple "does header text match the
  // expected list, in order" comparison cannot catch -- a blank-header
  // column sitting right next to its mislabeled data looks fine under a
  // pure text/order comparison, but is exactly the shift-by-N bug pattern
  // found in Activities and ActivityLog. Runs over the FULL actual width
  // of the sheet (not just the expected column count), so it also catches
  // shifts into columns the schema doesn't even know about.
  function scanHeaderDataAlignment(sh, expLabels, expTypes) {
    const lastRow = sh.getLastRow();
    const lastCol = sh.getLastColumn();
    if (lastCol === 0) return ['  (no columns)'];
    const headerRow = sh.getRange(1, 1, 1, lastCol).getValues()[0];
    const dataRows  = lastRow > 1 ? sh.getRange(2, 1, lastRow - 1, lastCol).getValues() : [];
    const total = dataRows.length;
    const lines = [];
    const optionalTypes = ['text', 'number_optional', 'any'];
    for (let col = 0; col < lastCol; col++) {
      const header = String(headerRow[col] || '').trim();
      const filled = dataRows.filter(function (row) { return row[col] !== '' && row[col] != null; }).length;
      const pct = total ? Math.round((filled / total) * 100) : 0;
      const expectedHere = col < expLabels.length ? expLabels[col] : '(none expected -- beyond schema)';
      // A field marked optional (text/number_optional/any) being unfilled is
      // expected, not a shift signal -- e.g. Foods' serving_note is a real,
      // correctly-positioned column nobody has used yet. Only flag "never
      // filled" for fields the code treats as required.
      const isOptional = col < expTypes.length && optionalTypes.indexOf(expTypes[col]) !== -1;
      let flag = '';
      if (!header && filled > 0) {
        flag = '  <<== BLANK HEADER BUT HAS DATA in ' + filled + ' row(s) -- likely a missing/shifted label, INVESTIGATE';
      } else if (header && total > 0 && filled === 0 && col < expLabels.length && !isOptional) {
        flag = '  <<== HEADER PRESENT BUT NEVER FILLED (required field) -- likely this label\'s real data moved to a different column, INVESTIGATE';
      }
      lines.push('  col ' + (col + 1) + ': header="' + header + '" | expected="' + expectedHere +
        '" | filled ' + filled + '/' + total + ' (' + pct + '%)' + flag);
    }
    return lines;
  }

  Object.keys(expected).forEach(function (name) {
    const sh = ss.getSheetByName(name);
    if (!sh) { log.push(name + ': MISSING SHEET.'); return; }

    const exp     = expected[name];
    const width   = Math.max(exp.length, sh.getLastColumn());
    const actual  = width > 0 ? sh.getRange(1, 1, 1, width).getValues()[0] : [];
    const allBlank = actual.every(function (c) { return c === ''; });

    if (sh.getLastRow() === 0 || allBlank) {
      sh.getRange(1, 1, 1, exp.length).setValues([exp]);
      log.push(name + ': header row was blank -- wrote expected headers.');
      return;
    }

    let mismatch = false;
    for (let i = 0; i < exp.length; i++) {
      if (String(actual[i] || '').trim() !== exp[i]) { mismatch = true; break; }
    }
    const hasExtra = actual.slice(exp.length).some(function (c) { return c !== ''; });

    if (!mismatch && !hasExtra) {
      log.push(name + ': headers OK (text matches expected, in order).');
    } else {
      log.push(name + ': MISMATCH -- expected [' + exp.join(', ') + '], found [' + actual.join(', ') + ']. Not auto-fixed -- review before correcting.');
    }

    // Sample rows -- always, regardless of header match status.
    const lastRow = sh.getLastRow();
    if (lastRow > 1) {
      const sampleCount = Math.min(2, lastRow - 1);
      sh.getRange(2, 1, sampleCount, width).getValues().forEach(function (row, idx) {
        log.push('  sample row ' + (idx + 2) + ': [' + row.join(', ') + ']');
      });
    } else {
      log.push('  (no data rows yet)');
    }

    // Data-quality scan at the code's actual column positions -- independent
    // of header match status, so good headers with bad data get caught too.
    scanDataQuality(sh, colTypes[name], exp).forEach(function (line) { log.push(line); });

    // Full column-by-column header/data alignment -- the actual answer to
    // "do headings align with data," checked explicitly, every column,
    // every row, not inferred from text-order matching or a 2-row sample.
    log.push('  -- column-by-column header/data alignment for ' + name + ' --');
    scanHeaderDataAlignment(sh, exp, colTypes[name]).forEach(function (line) { log.push(line); });
  });

  // 3. Show day-of-week alongside date for food and exercise logging, so
  //    manually scanning/editing rows is easier. Cosmetic only -- the
  //    underlying Date values and all read/write logic are unaffected.
  [FOOD_LOG_SHEET, ACT_LOG_SHEET].forEach(function (name) {
    const sh = ss.getSheetByName(name);
    if (!sh) return;
    sh.getRange('B2:B').setNumberFormat('ddd yyyy-mm-dd');
    log.push(name + ": date column (B) formatted as 'ddd yyyy-mm-dd' (e.g. 'Tue 2026-06-27').");
  });

  const report = log.join('\n');
  Logger.log(report);
  return report;
}

// Fixes the two confirmed header-only problems from auditAndFixSheets()'s
// last run: Activities' 5 stray blank header cells + 5 dead trailing
// columns (confirmed empty in all rows), and ActivityLog's scrambled
// header order (confirmed the data itself already sits at the positions
// the code expects, for the 67/68 rows with full data). Does NOT touch the
// single legacy 3-column ActivityLog row, and does NOT touch Foods --
// those need a decision first, not a structural fix.
// Run via: Extensions > Apps Script > select fixActivityHeaders > Run.
function fixActivityHeaders() {
  const ss  = _ss();
  const log = [];

  // Activities: rewrite header to the correct 9 columns, then delete the
  // 5 dead trailing columns (J:N) -- already confirmed empty in every row.
  (function () {
    const sh = ss.getSheetByName(ACT_SHEET);
    const correct = ['name', 'type', 'unit', 'goal', 'calories', 'cal_weight1', 'cal_per_unit1', 'cal_weight2', 'cal_per_unit2'];
    sh.getRange(1, 1, 1, correct.length).setValues([correct]);
    if (sh.getLastColumn() > correct.length) {
      sh.deleteColumns(correct.length + 1, sh.getLastColumn() - correct.length);
    }
    log.push('Activities: header fixed to ' + correct.length + ' columns, dead trailing columns removed.');
  })();

  // ActivityLog: verify columns F:G are empty in every row before touching
  // anything (same caution as Activities) -- if clean, rewrite header to
  // the correct 5 columns and delete the dead columns; if not, fix the
  // header only and leave the extra columns for manual review.
  (function () {
    const sh = ss.getSheetByName(ACT_LOG_SHEET);
    const correct = ['timestamp', 'date', 'activity_name', 'value', 'calories_burned'];
    const lastRow = sh.getLastRow();
    const lastCol = sh.getLastColumn();
    let deadColsClean = true;
    if (lastRow > 1 && lastCol > correct.length) {
      const extra = sh.getRange(2, correct.length + 1, lastRow - 1, lastCol - correct.length).getValues();
      deadColsClean = !extra.some(function (row) { return row.some(function (c) { return c !== ''; }); });
    }
    sh.getRange(1, 1, 1, correct.length).setValues([correct]);
    if (deadColsClean && lastCol > correct.length) {
      sh.deleteColumns(correct.length + 1, lastCol - correct.length);
      log.push('ActivityLog: header fixed to ' + correct.length + ' columns, dead trailing columns removed.');
    } else if (lastCol > correct.length) {
      log.push('ActivityLog: header fixed, but columns beyond ' + correct.length + ' had data -- left in place, review manually.');
    } else {
      log.push('ActivityLog: header fixed to ' + correct.length + ' columns.');
    }
  })();

  const report = log.join('\n');
  Logger.log(report);
  return report;
}

// ── Combined loaders ──────────────────────────────────────────────────────────

function getDateSummary(date) {
  const d          = date || _today();
  const weightData = getDateWeight(d);
  const bmr        = getBMRSettings();
  const tdee       = (weightData.weight && bmr.weight1 && bmr.weight2)
    ? _computeTDEE(weightData.weight, bmr) : 0;
  const deficit    = Math.round((bmr.goalLbsWeek || 0) * 3500 / 7);
  return {
    date,
    weight:            weightData,
    food:              getDateFood(d),
    activities:        getDateActivities(d),
    foods_config:      getFoods(),
    activities_config: getActivities(),
    goal:              getGoal(),
    sheet_url:         _ss().getUrl(),
    bmr:               bmr,
    tdee:              tdee,
    cal_target:        tdee ? tdee - deficit : getGoal()
  };
}

function getTodaySummary() { return getDateSummary(_today()); }

function getHistoryPage(days) {
  days = parseInt(days) || 30;

  // Weight is returned in full ("all time" chart option, 2026-07-29) --
  // food/activities stay windowed to `days` since those logs could get
  // large over years and don't need the same long horizon.
  const weight = computeDailyStats();

  return {
    weight,
    food:              getFoodLog(days),
    activities:        getActivityLog(days),
    activities_config: getActivities(),
    goal:              getGoal()
  };
}

// ── Diagnostics -- run from GAS editor, check Execution Log ──────────────────
//
// Mirrors the frontend drawCalStats() logic exactly.
// Shows raw weight rows, wtNetMap, wtDeltas, and all stat calculations
// so you can trace where a number diverges from expectations.

function diagCalStats() {
  const lines = ['=== diagCalStats ===', `today: ${_today()}`];

  // Run computeDailyStats to refresh the sheet, get all weight rows.
  const allWeight = computeDailyStats();
  lines.push(`\n--- Weight rows (all, sorted) ---`);
  allWeight.forEach(p => {
    lines.push(`  ${p.date}  wt=${p.weight}  net_cal=${p.net_calories ?? '—'}  delta_wt=${p.delta_weight ?? '—'}  interp=${p.interpolated ? 'Y' : 'N'}  food_cal=${p.food_calories ?? '—'}  cal_def=${p.cal_deficit ?? '—'}`);
  });

  // Build maps exactly as the frontend does.
  const wtList = allWeight.slice().sort((a, b) => a.date.localeCompare(b.date));

  // wtDefMap: per-row TDEE(that day's weight) - net_calories -- matches Weight tab cal_deficit column.
  const wtDefMap = {};
  wtList.forEach(p => {
    if (p.cal_deficit !== null && p.cal_deficit !== undefined) wtDefMap[p.date] = p.cal_deficit;
  });

  const wtDeltas = wtList
    .filter(p => p.delta_weight !== null && p.delta_weight !== undefined)
    .map(p => ({ date: p.date, delta: -p.delta_weight }));

  lines.push(`\n--- wtDefMap (${Object.keys(wtDefMap).length} entries, TDEE-net_cal) ---`);
  Object.keys(wtDefMap).sort().forEach(d => {
    lines.push(`  ${d}  cal_deficit=${wtDefMap[d]}`);
  });

  lines.push(`\n--- wtDeltas (${wtDeltas.length} entries, positive=lost) ---`);
  wtDeltas.forEach(d => lines.push(`  ${d.date}  delta=${d.delta.toFixed(3)}`));

  // Stat helpers -- identical logic to frontend.
  const today = _today();
  function deficitsIn(since) {
    return Object.keys(wtDefMap)
      .filter(ds => ds < today && (!since || ds >= since))
      .map(ds => wtDefMap[ds]);
  }
  function wtDeltasIn(since) {
    return wtDeltas.filter(d => d.date < today && (!since || d.date >= since));
  }

  function sinceDate(n) {
    const d = new Date(_today() + 'T00:00:00');
    d.setDate(d.getDate() - (n - 1));
    return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }

  function avgDailyLoss(since) {
    const ds = wtDeltasIn(since);
    if (!ds.length) return null;
    return ds.reduce((s, d) => s + d.delta, 0) / ds.length;
  }
  function avgDailyDeficit(since) {
    const vals = deficitsIn(since);
    if (!vals.length) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }
  function efficiency(since) {
    const adl = avgDailyLoss(since);
    const add = avgDailyDeficit(since);
    if (adl === null || add === null || !add) return null;
    return adl / (add / 3500);
  }

  const windows = [
    { label: '7 days',   since: sinceDate(7) },
    { label: '14 days',  since: sinceDate(14) },
    { label: '30 days',  since: sinceDate(30) },
    { label: 'All time', since: null },
  ];

  lines.push('\n--- Calculations ---');
  windows.forEach(w => {
    const ds   = wtDeltasIn(w.since);
    const defs = deficitsIn(w.since);
    const adl  = avgDailyLoss(w.since);
    const add  = avgDailyDeficit(w.since);
    const eff  = efficiency(w.since);
    lines.push(`\n[${w.label}]  since=${w.since || 'beginning'}`);
    lines.push(`  weight entries: ${ds.length}   deficit entries: ${defs.length}`);
    lines.push(`  avg daily weight loss:          ${adl !== null ? adl.toFixed(4) + ' lbs' : '—'}`);
    lines.push(`  avg weekly weight loss:         ${adl !== null ? (adl * 7).toFixed(3) + ' lbs' : '—'}`);
    lines.push(`  avg daily deficit:              ${add !== null ? Math.round(add) + ' cal' : '—'}`);
    lines.push(`  avg daily deficit (in lbs):     ${add !== null ? (add / 3500).toFixed(4) + ' lbs' : '—'}`);
    lines.push(`  avg weekly deficit (in lbs):    ${add !== null ? (add / 3500 * 7).toFixed(3) + ' lbs' : '—'}`);
    lines.push(`  efficiency (actual ÷ predicted): ${eff !== null ? eff.toFixed(3) : '—'}`);
  });

  const report = lines.join('\n');
  Logger.log(report);
  return report;
}

// Compact version of diagCalStats() -- skips the per-row dump (which made
// the full report too large for the Apps Script log viewer) and only shows
// the BMR goal setting plus the final calculations per window.
function diagCalStatsCompact() {
  const lines = ['=== diagCalStatsCompact ===', `today: ${_today()}`];

  const bmr = getBMRSettings();
  lines.push(`\n--- BMR settings ---`);
  lines.push(`  weight1=${bmr.weight1}  tdee1=${bmr.tdee1}  weight2=${bmr.weight2}  tdee2=${bmr.tdee2}  goalLbsWeek=${bmr.goalLbsWeek}`);
  if (!bmr.goalLbsWeek) {
    lines.push(`  *** goalLbsWeek is falsy -- the frontend stats panel returns '' entirely when this is unset. ***`);
  }

  const allWeight = computeDailyStats();
  const wtList    = allWeight.slice().sort((a, b) => a.date.localeCompare(b.date));

  const wtDefMap = {};
  wtList.forEach(p => { if (p.cal_deficit !== null && p.cal_deficit !== undefined) wtDefMap[p.date] = p.cal_deficit; });

  const wtDeltas = wtList
    .filter(p => p.delta_weight !== null && p.delta_weight !== undefined)
    .map(p => ({ date: p.date, delta: -p.delta_weight }));

  lines.push(`\n--- Counts ---`);
  lines.push(`  total weight rows: ${wtList.length}   rows with cal_deficit: ${Object.keys(wtDefMap).length}   rows with delta_weight: ${wtDeltas.length}`);

  const today = _today();
  function deficitsIn(since) {
    return Object.keys(wtDefMap).filter(ds => ds < today && (!since || ds >= since)).map(ds => wtDefMap[ds]);
  }
  function wtDeltasIn(since) {
    return wtDeltas.filter(d => d.date < today && (!since || d.date >= since));
  }
  function sinceDate(n) {
    const d = new Date(_today() + 'T00:00:00');
    d.setDate(d.getDate() - (n - 1));
    return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  function avgDailyLoss(since) {
    const ds = wtDeltasIn(since);
    if (!ds.length) return null;
    return ds.reduce((s, d) => s + d.delta, 0) / ds.length;
  }
  function avgDailyDeficit(since) {
    const vals = deficitsIn(since);
    if (!vals.length) return null;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }
  function efficiency(since) {
    const adl = avgDailyLoss(since);
    const add = avgDailyDeficit(since);
    if (adl === null || add === null || !add) return null;
    return adl / (add / 3500);
  }

  const windows = [
    { label: '7 days',   since: sinceDate(7) },
    { label: '14 days',  since: sinceDate(14) },
    { label: '30 days',  since: sinceDate(30) },
    { label: 'All time', since: null },
  ];

  lines.push('\n--- Calculations ---');
  windows.forEach(w => {
    const ds   = wtDeltasIn(w.since);
    const defs = deficitsIn(w.since);
    const adl  = avgDailyLoss(w.since);
    const add  = avgDailyDeficit(w.since);
    const eff  = efficiency(w.since);
    lines.push(`[${w.label}] since=${w.since || 'beginning'}  weight_entries=${ds.length}  deficit_entries=${defs.length}  ` +
      `avg_weekly_loss=${adl !== null ? (adl * 7).toFixed(2) + 'lbs' : '—'}  ` +
      `avg_daily_deficit=${add !== null ? Math.round(add) + 'cal' : '—'}  ` +
      `efficiency=${eff !== null ? eff.toFixed(2) : '—'}`);
  });

  const report = lines.join('\n');
  Logger.log(report);
  return report;
}

// ── Medication Inventory ──────────────────────────────────────────────────────
//
// Two sheets — syringe_id is the key that links every transaction:
//
//   MedSyringes — one row per physical syringe, full lifecycle in one place
//     syringe_id | order_id | date_ordered | date_expected | date_received | date_depleted | notes
//     Status derived from date columns:
//       date_ordered set, date_received blank  → On order / in transit
//       date_received set, date_depleted blank → Reserve or current (shots computed from MedShots)
//       date_depleted set                      → Depleted
//
//   MedShots — one row per injection
//     timestamp | date | syringe_id | shot_num | notes
//     shot_num (1–4) is computed at log time from existing rows for that syringe.
//
// MedLog and MedOrders (from earlier versions) are superseded by this design.
// Re-run initMeds() to create / reset sheet headers.

// Run from the Apps Script editor to wipe ALL med data and rebuild clean sheets.
// Deletes MedSyringes and MedShots (plus the legacy MedLog and MedOrders sheets
// if they still exist), then calls initMeds() to create fresh sheets with the
// correct headers. IRREVERSIBLE — only run when you are sure the data is gone.
function resetMeds() {
  const ss = _ss();
  ['MedSyringes', 'MedShots', 'MedLog', 'MedOrders'].forEach(name => {
    const sh = ss.getSheetByName(name);
    if (sh) ss.deleteSheet(sh);
  });
  return initMeds();
}

// Run once from the Apps Script editor (safe to re-run — uses ensure pattern).
function initMeds() {
  const ss = _ss();
  function ensure(name, schemaKey) {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    if (sh.getLastRow() === 0) sh.appendRow(SCHEMA[schemaKey]);
    applySheetFormatting(sh, schemaKey);
    return sh;
  }
  ensure(MED_SYR_SHEET,   'med_syr');
  ensure(MED_SHOTS_SHEET, 'med_shots');
  return 'Med sheets ready (MedSyringes, MedShots).';
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function _nextSyringeId() {
  const sh = _sheet(MED_SYR_SHEET);
  if (!sh) return 1;
  const rows = sh.getDataRange().getValues().slice(1).filter(r => r[0]);
  if (!rows.length) return 1;
  return Math.max(...rows.map(r => parseInt(r[0]) || 0)) + 1;
}

function _shotsBySyringe() {
  // Returns { syringeId: shotsUsed } count from MedShots.
  const sh = _sheet(MED_SHOTS_SHEET);
  if (!sh || sh.getLastRow() < 2) return {};
  const counts = {};
  sh.getDataRange().getValues().slice(1).filter(r => r[MH.timestamp]).forEach(r => {
    const sid = String(parseInt(r[MH.syringe_id]) || '');
    if (sid) counts[sid] = (counts[sid] || 0) + 1;
  });
  return counts;
}

function _readSyringes(shotCounts) {
  const sh = _sheet(MED_SYR_SHEET);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getDataRange().getValues().slice(1)
    .filter(r => r[MS.syringe_id])
    .map(r => ({
      syringe_id:    parseInt(r[MS.syringe_id]),
      order_id:      String(r[MS.order_id]      || ''),
      date_ordered:  _dateStr(r[MS.date_ordered]),
      date_expected: _dateStr(r[MS.date_expected]),
      date_received: _dateStr(r[MS.date_received]),
      date_depleted: _dateStr(r[MS.date_depleted]),
      notes:         String(r[MS.notes]          || ''),
      shots_used:    (shotCounts || {})[String(parseInt(r[MS.syringe_id]))] || 0
    }))
    .sort((a, b) => a.syringe_id - b.syringe_id);
}

// ── Status ────────────────────────────────────────────────────────────────────

function getMedStatus() {
  const syrSheet   = _sheet(MED_SYR_SHEET);
  const shotsSheet = _sheet(MED_SHOTS_SHEET);
  if (!syrSheet || !shotsSheet) return { error: 'Run initMeds() first.' };

  const shotCounts = _shotsBySyringe();
  const syringes   = _readSyringes(shotCounts);

  // On order: date_ordered set, date_received blank
  const onOrder = syringes.filter(s => s.date_ordered && !s.date_received);

  // In hand: date_received set, not depleted
  const inHand = syringes.filter(s => s.date_received && !s.date_depleted);

  // Current syringe: in-hand, lowest ID, with shots remaining
  const active = inHand.filter(s => s.shots_used < SHOTS_PER_SYRINGE);
  const current = active.length ? active[0] : null;
  const currentShots = current ? SHOTS_PER_SYRINGE - current.shots_used : 0;

  // Reserve: in-hand, not started (shots_used === 0), not the current one
  const reserve = inHand.filter(s =>
    s.shots_used === 0 && (!current || s.syringe_id !== current.syringe_id)
  );

  // Last injection date from MedShots
  const lastShotDate = shotsSheet.getDataRange().getValues().slice(1)
    .filter(r => r[MH.timestamp])
    .reduce((max, r) => { const d = _dateStr(r[MH.date]); return d > max ? d : max; }, '');

  // Group on-order syringes by order_id for the UI
  const orderGroups = {};
  onOrder.forEach(s => {
    const oid = s.order_id || s.date_ordered;
    if (!orderGroups[oid]) orderGroups[oid] = {
      order_id:      oid,
      date_ordered:  s.date_ordered,
      date_expected: s.date_expected,
      syringe_ids:   []
    };
    orderGroups[oid].syringe_ids.push(s.syringe_id);
  });

  return {
    current_syringe_id:  current ? current.syringe_id : null,
    current_shots:       currentShots,
    shots_per_syringe:   SHOTS_PER_SYRINGE,
    syringes_in_reserve: reserve.length,
    reserve_ids:         reserve.map(s => s.syringe_id),
    on_order:            Object.values(orderGroups).sort((a, b) => b.date_ordered.localeCompare(a.date_ordered)),
    last_shot_date:      lastShotDate,
    syringes:            syringes
  };
}

// ── Actions ───────────────────────────────────────────────────────────────────

function logMedShot(date, syringeId, notes) {
  const d   = date || _today();
  const sid = parseInt(syringeId);
  if (!sid) throw new Error('syringe_id required');

  const shotNum = (_shotsBySyringe()[String(sid)] || 0) + 1;
  _sheet(MED_SHOTS_SHEET).appendRow([_ts(), d, sid, shotNum, notes || '']);

  // Auto-deplete after the last shot
  if (shotNum >= SHOTS_PER_SYRINGE) {
    const syrSheet = _sheet(MED_SYR_SHEET);
    const rows = syrSheet.getDataRange().getValues();
    for (let i = 1; i < rows.length; i++) {
      if (parseInt(rows[i][MS.syringe_id]) === sid && !rows[i][MS.date_depleted]) {
        syrSheet.getRange(i + 1, MS.date_depleted + 1).setValue(d);
        break;
      }
    }
  }
  return getMedStatus();
}

// Place an order — creates MedSyringes rows immediately with order dates,
// date_received blank (they're in transit). Syringe IDs are assigned now.
function placeMedOrder(dateOrdered, dateExpected, qty, notes) {
  const orderId = _ts();
  const syrSheet = _sheet(MED_SYR_SHEET);
  let nextId = _nextSyringeId();
  const n = parseInt(qty) || 1;
  for (let i = 0; i < n; i++) {
    // cols: syringe_id | order_id | date_ordered | date_expected | date_received | date_depleted | notes
    syrSheet.appendRow([nextId++, orderId, dateOrdered || _today(), dateExpected || '', '', '', notes || '']);
  }
  return getMedStatus();
}

// Mark one or more syringes as received (sets date_received).
function receiveMedSyringes(syringeIds, dateReceived) {
  const arrived  = dateReceived || _today();
  const syrSheet = _sheet(MED_SYR_SHEET);
  const rows     = syrSheet.getDataRange().getValues();
  const idSet    = new Set(syringeIds.map(id => parseInt(id)));
  for (let i = 1; i < rows.length; i++) {
    if (idSet.has(parseInt(rows[i][MS.syringe_id])) && !rows[i][MS.date_received]) {
      syrSheet.getRange(i + 1, MS.date_received + 1).setValue(arrived);
    }
  }
  return getMedStatus();
}

// Receive all syringes from a given order at once.
function receiveMedOrder(orderId, dateReceived) {
  const arrived  = dateReceived || _today();
  const syrSheet = _sheet(MED_SYR_SHEET);
  const rows     = syrSheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][MS.order_id]) === String(orderId) && !rows[i][MS.date_received]) {
      syrSheet.getRange(i + 1, MS.date_received + 1).setValue(arrived);
    }
  }
  return getMedStatus();
}

function getMedHistory(days) {
  const shotsSheet = _sheet(MED_SHOTS_SHEET);
  const syrSheet   = _sheet(MED_SYR_SHEET);
  if (!shotsSheet || !syrSheet) return [];

  days = parseInt(days) || 90;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const shots = shotsSheet.getDataRange().getValues().slice(1)
    .filter(r => r[MH.timestamp] && new Date(_dateStr(r[MH.date]) + 'T12:00:00') >= cutoff)
    .map(r => ({
      timestamp:  _tsStr(r[MH.timestamp]),
      date:       _dateStr(r[MH.date]),
      syringe_id: parseInt(r[MH.syringe_id]),
      shot_num:   parseInt(r[MH.shot_num]),
      notes:      String(r[MH.notes] || ''),
      event:      'shot'
    }));

  const receives = syrSheet.getDataRange().getValues().slice(1)
    .filter(r => r[MS.syringe_id] && r[MS.date_received] && new Date(_dateStr(r[MS.date_received]) + 'T12:00:00') >= cutoff)
    .map(r => ({
      date:       _dateStr(r[MS.date_received]),
      syringe_id: parseInt(r[MS.syringe_id]),
      order_id:   String(r[MS.order_id] || ''),
      event:      'received'
    }));

  const orders = syrSheet.getDataRange().getValues().slice(1)
    .filter(r => r[MS.syringe_id] && r[MS.date_ordered] && new Date(_dateStr(r[MS.date_ordered]) + 'T12:00:00') >= cutoff)
    .reduce((acc, r) => {
      const oid = String(r[MS.order_id] || r[MS.date_ordered]);
      if (!acc[oid]) acc[oid] = { date: _dateStr(r[MS.date_ordered]), order_id: oid, syringe_ids: [], event: 'ordered' };
      acc[oid].syringe_ids.push(parseInt(r[MS.syringe_id]));
      return acc;
    }, {});

  return [...shots, ...receives, ...Object.values(orders)]
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .slice(0, 60);
}

// ── Workout log ───────────────────────────────────────────────────────────────
// Stores one row per LA Fitness session: which exercise was chosen from each
// category (warmup / push / pull / legs / core / cooldown) plus optional notes.
// Not linked to calorie accounting — that connection can be added later.
//
// A session's row is upserted field-by-field (updateWorkoutField), not written
// once at the end — a workout takes 30-60 min and the page can get killed by
// the phone backgrounding the browser mid-session, so every pick needs to be
// durable the moment it's made, the same way logWeight upserts a day's row
// instead of requiring one final submit.

const WORKOUT_FIELDS = ['warmup', 'push', 'pull', 'legs', 'core', 'cooldown', 'notes'];

// Run from the Apps Script editor to create the WorkoutLog sheet (safe to re-run).
function initWorkout() {
  const ss = _ss();
  let sh = ss.getSheetByName(WORKOUT_LOG_SHEET);
  if (!sh) sh = ss.insertSheet(WORKOUT_LOG_SHEET);
  if (sh.getLastRow() === 0) sh.appendRow(SCHEMA.workout_log);
  applySheetFormatting(sh, 'workout_log');
  return 'WorkoutLog sheet ready.';
}

// 1-indexed sheet row for `date`'s WorkoutLog entry, or -1 if none exists yet.
function _findWorkoutRow(sheet, date) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  const dates = sheet.getRange(2, WL.date + 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < dates.length; i++) {
    if (_dateStr(dates[i][0]) === date) return i + 2;
  }
  return -1;
}

function updateWorkoutField(date, field, value) {
  if (WORKOUT_FIELDS.indexOf(field) === -1) {
    throw new Error('Unknown workout field: ' + field);
  }
  const d = date || _today();

  // Quick picks during a session can fire several updateWorkoutField calls
  // close together; without a lock, two concurrent "no row yet" reads could
  // each append their own row for the same date. LockService serializes the
  // find-or-create so that can't happen.
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = _sheet(WORKOUT_LOG_SHEET);
    const row = _findWorkoutRow(sheet, d);

    if (row === -1) {
      const blank = SCHEMA.workout_log.map(function() { return ''; });
      blank[WL.timestamp] = _ts();
      blank[WL.date] = d;
      blank[WL[field]] = value;
      sheet.appendRow(blank);
    } else {
      sheet.getRange(row, WL[field] + 1).setValue(value);
      sheet.getRange(row, WL.timestamp + 1).setValue(_ts());
    }
  } finally {
    lock.releaseLock();
  }
  return getWorkoutEntry(d);
}

// Current saved state for one day, or null if nothing logged yet — used both
// as updateWorkoutField's return value and to rehydrate the menu on load/date
// switch, so a reload mid-session shows what's already saved instead of blank.
function getWorkoutEntry(date) {
  const d = date || _today();
  const sheet = _sheet(WORKOUT_LOG_SHEET);
  const row = _findWorkoutRow(sheet, d);
  if (row === -1) return null;
  const r = sheet.getRange(row, 1, 1, SCHEMA.workout_log.length).getValues()[0];
  return {
    timestamp: _tsStr(r[WL.timestamp]),
    date:      _dateStr(r[WL.date]),
    warmup:    String(r[WL.warmup]   || ''),
    push:      String(r[WL.push]     || ''),
    pull:      String(r[WL.pull]     || ''),
    legs:      String(r[WL.legs]     || ''),
    core:      String(r[WL.core]     || ''),
    cooldown:  String(r[WL.cooldown] || ''),
    notes:     String(r[WL.notes]    || '')
  };
}

function getWorkoutLog(days) {
  days = parseInt(days) || 30;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const sh = _sheet(WORKOUT_LOG_SHEET);
  if (!sh || sh.getLastRow() < 2) return [];
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, SCHEMA.workout_log.length).getValues();
  return rows
    .filter(r => r[WL.timestamp] && new Date(_dateStr(r[WL.date]) + 'T12:00:00') >= cutoff)
    .map(r => ({
      timestamp: _tsStr(r[WL.timestamp]),
      date:      _dateStr(r[WL.date]),
      warmup:    String(r[WL.warmup]   || ''),
      push:      String(r[WL.push]     || ''),
      pull:      String(r[WL.pull]     || ''),
      legs:      String(r[WL.legs]     || ''),
      core:      String(r[WL.core]     || ''),
      cooldown:  String(r[WL.cooldown] || ''),
      notes:     String(r[WL.notes]    || '')
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

// ── Inbox triage log ─────────────────────────────────────────────────────────

// Run from the Apps Script editor to create the InboxLog sheet (safe to re-run).
function initInbox() {
  const ss = _ss();
  let sh = ss.getSheetByName(INBOX_LOG_SHEET);
  if (!sh) sh = ss.insertSheet(INBOX_LOG_SHEET);
  if (sh.getLastRow() === 0) sh.appendRow(SCHEMA.inbox_log);
  applySheetFormatting(sh, 'inbox_log');
}

function logInboxSession(date, data) {
  const d = date || _today();
  _sheet(INBOX_LOG_SHEET).appendRow([
    _ts(),
    d,
    Number(data.processed  || 0),
    Number(data.outstanding || 0),
    data.minutes ? Number(data.minutes) : '',
    String(data.notes || '')
  ]);
}

function getInboxLog(days) {
  days = parseInt(days) || 30;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const sh = _sheet(INBOX_LOG_SHEET);
  if (!sh || sh.getLastRow() < 2) return [];
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, SCHEMA.inbox_log.length).getValues();
  return rows
    .filter(r => r[IL.timestamp] && new Date(_dateStr(r[IL.date]) + 'T12:00:00') >= cutoff)
    .map(r => ({
      timestamp:   _tsStr(r[IL.timestamp]),
      date:        _dateStr(r[IL.date]),
      processed:   Number(r[IL.processed]   || 0),
      outstanding: Number(r[IL.outstanding] || 0),
      minutes:     r[IL.minutes] !== '' ? Number(r[IL.minutes]) : null,
      notes:       String(r[IL.notes] || '')
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

// ── Schema validation — on-demand only (reads Sheet header rows via Sheets API)
//
// Compares actual Sheet header rows against the canonical SCHEMA definitions.
// Returns one entry per sheet: ok (bool), and per-column match status.
// Called by the Schema tab in Configure — never runs automatically.
function validateSheets() {
  var ss = _ss();
  return SCHEMA_MAP.map(function(entry) {
    var name   = entry.name;
    var schema = SCHEMA[entry.key];
    var types  = SCHEMA_TYPES[entry.key];
    var sh     = ss.getSheetByName(name);
    if (!sh) return { sheet: name, exists: false, ok: false, cols: [], fmt: {} };

    // Column header check
    var ncols  = Math.max(sh.getLastColumn(), schema.length);
    var actual = sh.getLastRow() > 0 ? sh.getRange(1, 1, 1, ncols).getValues()[0] : [];
    var cols   = schema.map(function(exp, i) {
      return { col: i + 1, expected: exp, actual: actual[i] || '', ok: (actual[i] || '') === exp };
    });

    // Formatting checks
    var headerBold   = sh.getRange(1, 1).getFontWeight() === 'bold';
    var topFrozen    = sh.getFrozenRows() >= 1;
    var filterExists = sh.getFilter() !== null;

    // Date column format check — sample row 2 (if present)
    var lastRow = sh.getLastRow();
    var dateCols = [];
    schema.forEach(function(col, i) {
      var t = types[col];
      if (t !== 'date' && t !== 'datetime') return;
      var expected = t === 'date' ? DATE_FORMAT : DATETIME_FORMAT;
      var actual_fmt = sh.getRange(2, i + 1).getNumberFormat(); // row 2 always has format since applySheetFormatting uses getMaxRows()
      dateCols.push({ col: col, expected: expected, actual: actual_fmt, ok: actual_fmt === expected });
    });

    var fmtOk = headerBold && topFrozen && filterExists && dateCols.every(function(d) { return d.ok; });
    return {
      sheet: name, exists: true,
      ok: cols.every(function(c) { return c.ok; }) && fmtOk,
      cols: cols,
      fmt: { header_bold: headerBold, top_frozen: topFrozen, filter: filterExists, date_cols: dateCols, ok: fmtOk }
    };
  });
}
