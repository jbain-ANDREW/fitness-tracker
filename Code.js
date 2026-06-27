// Fitness Tracker — GAS Web App

const WEIGHT_SHEET   = 'Weight';
const FOODS_SHEET    = 'Foods';
const FOOD_LOG_SHEET = 'FoodLog';
const ACT_SHEET      = 'Activities';
const ACT_LOG_SHEET  = 'ActivityLog';

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

// ── One-time init ─────────────────────────────────────────────────────────────

function initFitness() {
  const SPREADSHEET_ID = '11pxgECbfHoNQjZ8nijB6101XWsfNSa53eReusdBz4rE';
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', SPREADSHEET_ID);

  function ensure(name, headers) {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    if (sh.getLastRow() === 0) sh.appendRow(headers);
    return sh;
  }

  ensure(WEIGHT_SHEET,   ['date', 'weight_lbs']);
  // Header text only -- see the comment above getFoods() for why this list
  // doesn't need to match that function's internal property names.
  ensure(FOODS_SHEET,    ['name', 'serving_size', 'serving_note', 'calories_per_serving']);
  ensure(FOOD_LOG_SHEET, ['timestamp', 'date', 'food_name', 'num_servings', 'calories_total', 'meal']);
  ensure(ACT_SHEET,      ['name', 'type', 'unit', 'goal', 'calories', 'cal_weight1', 'cal_per_unit1', 'cal_weight2', 'cal_per_unit2']);
  ensure(ACT_LOG_SHEET,  ['timestamp', 'date', 'activity_name', 'value', 'calories_burned']);

  return 'Fitness Tracker initialized. Spreadsheet: ' + ss.getUrl();
}

// ── Weight — one entry per day (overwrite) ────────────────────────────────────

function logWeight(weight, date) {
  const d     = date || _today();
  const sheet = _sheet(WEIGHT_SHEET);
  const rows  = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (_dateStr(rows[i][0]) === d) {
      sheet.getRange(i + 1, 1, 1, 2).setValues([[d, parseFloat(weight)]]);
      return getDateWeight(d);
    }
  }
  sheet.appendRow([d, parseFloat(weight)]);
  return getDateWeight(d);
}

function getDateWeight(date) {
  const d    = date || _today();
  const rows = _sheet(WEIGHT_SHEET).getDataRange().getValues().slice(1);
  const row  = rows.find(r => _dateStr(r[0]) === d && r[1]);
  return { weight: row ? Math.round(parseFloat(row[1]) * 10) / 10 : null };
}

function getTodayWeight() { return getDateWeight(_today()); }

function getWeightHistory(days) {
  days = parseInt(days) || 30;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const rows = _sheet(WEIGHT_SHEET).getDataRange().getValues().slice(1);
  return rows
    .filter(r => r[1] && new Date(_dateStr(r[0]) + 'T12:00:00') >= cutoff)
    .map(r => ({ date: _dateStr(r[0]), weight: Math.round(parseFloat(r[1]) * 10) / 10 }))
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
  return rows.filter(r => r[0]).map(r => ({
    name: r[0], serving_name: r[1], serving_size: r[2],
    calories_per_serving: parseFloat(r[3]) || 0
  }));
}

function saveFood(data) {
  const sheet = _sheet(FOODS_SHEET);
  const rows  = sheet.getDataRange().getValues();
  const match = data._originalName || data.name;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === match) {
      sheet.getRange(i + 1, 1, 1, 4).setValues([[
        data.name, data.serving_name, data.serving_size, parseFloat(data.calories_per_serving)
      ]]);
      return getFoods();
    }
  }
  sheet.appendRow([data.name, data.serving_name, data.serving_size, parseFloat(data.calories_per_serving)]);
  return getFoods();
}

function deleteFood(name) {
  const sheet = _sheet(FOODS_SHEET);
  const rows  = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === name) { sheet.deleteRow(i + 1); break; }
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
    if (_tsStr(rows[i][0]) === String(timestamp)) { sheet.deleteRow(i + 1); break; }
  }
  return getDateFood(date || _today());
}

function getDateFood(date) {
  const d       = date || _today();
  const rows    = _sheet(FOOD_LOG_SHEET).getDataRange().getValues().slice(1);
  const entries = rows.filter(r => _dateStr(r[1]) === d && r[2]).map(r => ({
    timestamp: _tsStr(r[0]), food_name: r[2], num_servings: parseFloat(r[3]), calories: parseFloat(r[4]), meal: r[5] || ''
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
  rows.filter(r => r[1] && new Date(_dateStr(r[1]) + 'T12:00:00') >= cutoff).forEach(r => {
    const d = _dateStr(r[1]);
    if (!result[d]) result[d] = { entries: [], total_calories: 0 };
    result[d].entries.push({ timestamp: _tsStr(r[0]), food_name: r[2], num_servings: parseFloat(r[3]), calories: parseFloat(r[4]), meal: r[5] || '' });
    result[d].total_calories += parseFloat(r[4]) || 0;
  });
  Object.values(result).forEach(day => { day.total_calories = Math.round(day.total_calories); });
  return result;
}

// ── Activities config ─────────────────────────────────────────────────────────

function getActivities() {
  const rows = _sheet(ACT_SHEET).getDataRange().getValues().slice(1);
  return rows.filter(r => r[0]).map(r => ({
    name: r[0], type: r[1] || 'checkbox', unit: r[2] || '', goal: r[3] || '',
    calories:      parseFloat(r[4]) || 0,
    cal_weight1:   parseFloat(r[5]) || 0,
    cal_per_unit1: parseFloat(r[6]) || 0,
    cal_weight2:   parseFloat(r[7]) || 0,
    cal_per_unit2: parseFloat(r[8]) || 0
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
    if (rows[i][0] === match) {
      sheet.getRange(i + 1, 1, 1, 9).setValues([row]);
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
    if (rows[i][0] === name) { sheet.deleteRow(i + 1); break; }
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
    if (_tsStr(rows[i][0]) === String(timestamp)) { sheet.deleteRow(i + 1); break; }
  }
  return getDateActivities(date || _today());
}

function getDateActivities(date) {
  const d    = date || _today();
  const rows = _sheet(ACT_LOG_SHEET).getDataRange().getValues().slice(1);
  return rows
    .filter(r => {
      const ts = _tsStr(r[0]);
      return ts.length > 10 && _dateStr(r[1]) === d && r[2];
    })
    .map(r => ({
      timestamp:       _tsStr(r[0]),
      activity_name:   String(r[2]),
      value:           r[3],
      calories_burned: parseFloat(r[4]) || 0
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
      const ts = _tsStr(r[0]);
      return ts.length > 10 && r[1] && new Date(_dateStr(r[1]) + 'T12:00:00') >= cutoff;
    })
    .forEach(r => {
      const d = _dateStr(r[1]);
      if (!result[d]) result[d] = [];
      result[d].push({
        timestamp:       _tsStr(r[0]),
        activity_name:   String(r[2]),
        value:           r[3],
        calories_burned: parseFloat(r[4]) || 0
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
  const expected = {};
  expected[WEIGHT_SHEET]   = ['date', 'weight_lbs'];
  expected[FOODS_SHEET]    = ['name', 'serving_size', 'serving_note', 'calories_per_serving'];
  expected[FOOD_LOG_SHEET] = ['timestamp', 'date', 'food_name', 'num_servings', 'calories_total', 'meal'];
  expected[ACT_SHEET]      = ['name', 'type', 'unit', 'goal', 'calories', 'cal_weight1', 'cal_per_unit1', 'cal_weight2', 'cal_per_unit2'];
  expected[ACT_LOG_SHEET]  = ['timestamp', 'date', 'activity_name', 'value', 'calories_burned'];

  // Type of value the code actually expects at each position, in the same
  // order as `expected` above -- this is what app correctness depends on,
  // independent of whatever the header row says.
  const colTypes = {};
  colTypes[WEIGHT_SHEET]   = ['date', 'number'];
  colTypes[FOODS_SHEET]    = ['text_required', 'text', 'text', 'number'];
  colTypes[FOOD_LOG_SHEET] = ['datetime', 'date', 'text_required', 'number', 'number', 'text'];
  // cal_weight1/cal_per_unit1/cal_weight2/cal_per_unit2 are optional -- only
  // used by activities with the alternate weight-based calorie formula.
  colTypes[ACT_SHEET]      = ['text_required', 'text', 'text', 'text', 'number', 'number_optional', 'number_optional', 'number_optional', 'number_optional'];
  colTypes[ACT_LOG_SHEET]  = ['datetime', 'date', 'text_required', 'any', 'number'];

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
  return {
    weight:            getWeightHistory(days),
    food:              getFoodLog(days),
    activities:        getActivityLog(days),
    activities_config: getActivities(),
    goal:              getGoal()
  };
}
