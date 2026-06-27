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
  ensure(FOODS_SHEET,    ['name', 'serving_name', 'serving_size', 'calories_per_serving']);
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
  const expected = {};
  expected[WEIGHT_SHEET]   = ['date', 'weight_lbs'];
  expected[FOODS_SHEET]    = ['name', 'serving_name', 'serving_size', 'calories_per_serving'];
  expected[FOOD_LOG_SHEET] = ['timestamp', 'date', 'food_name', 'num_servings', 'calories_total', 'meal'];
  expected[ACT_SHEET]      = ['name', 'type', 'unit', 'goal', 'calories', 'cal_weight1', 'cal_per_unit1', 'cal_weight2', 'cal_per_unit2'];
  expected[ACT_LOG_SHEET]  = ['timestamp', 'date', 'activity_name', 'value', 'calories_burned'];

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
      log.push(name + ': headers OK.');
    } else {
      log.push(name + ': MISMATCH -- expected [' + exp.join(', ') + '], found [' + actual.join(', ') + ']. Not auto-fixed -- review before correcting.');
    }
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
