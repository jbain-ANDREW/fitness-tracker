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
  ensure(FOOD_LOG_SHEET, ['timestamp', 'date', 'food_name', 'num_servings', 'calories_total']);
  ensure(ACT_SHEET,      ['name', 'type', 'unit', 'goal', 'calories']);
  ensure(ACT_LOG_SHEET,  ['date', 'activity_name', 'value']);

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

function logFood(foodName, numServings, caloriesTotal, date) {
  const d = date || _today();
  _sheet(FOOD_LOG_SHEET).appendRow([_ts(), d, foodName, parseFloat(numServings), parseFloat(caloriesTotal)]);
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
    timestamp: _tsStr(r[0]), food_name: r[2], num_servings: parseFloat(r[3]), calories: parseFloat(r[4])
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
    result[d].entries.push({ timestamp: _tsStr(r[0]), food_name: r[2], num_servings: parseFloat(r[3]), calories: parseFloat(r[4]) });
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
    calories: parseFloat(r[4]) || 0
  }));
}

function saveActivity(data) {
  const sheet = _sheet(ACT_SHEET);
  const rows  = sheet.getDataRange().getValues();
  const match = data._originalName || data.name;
  const cal   = parseFloat(data.calories) || 0;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === match) {
      sheet.getRange(i + 1, 1, 1, 5).setValues([[data.name, data.type, data.unit, data.goal, cal]]);
      return getActivities();
    }
  }
  sheet.appendRow([data.name, data.type || 'checkbox', data.unit || '', data.goal || '', cal]);
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

function logActivities(entries, date) {
  const d     = date || _today();
  const sheet = _sheet(ACT_LOG_SHEET);
  const rows  = sheet.getDataRange().getValues();
  entries.forEach(entry => {
    let found = false;
    for (let i = 1; i < rows.length; i++) {
      if (_dateStr(rows[i][0]) === d && rows[i][1] === entry.name) {
        sheet.getRange(i + 1, 3).setValue(entry.value);
        rows[i][2] = entry.value;
        found = true;
        break;
      }
    }
    if (!found) {
      sheet.appendRow([d, entry.name, entry.value]);
      rows.push([d, entry.name, entry.value]);
    }
  });
  return getDateActivities(d);
}

function getDateActivities(date) {
  const d    = date || _today();
  const rows = _sheet(ACT_LOG_SHEET).getDataRange().getValues().slice(1);
  const result = {};
  rows.filter(r => _dateStr(r[0]) === d && r[1]).forEach(r => { result[r[1]] = r[2]; });
  return result;
}

function getTodayActivities() { return getDateActivities(_today()); }

function getActivityLog(days) {
  days = parseInt(days) || 7;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const rows   = _sheet(ACT_LOG_SHEET).getDataRange().getValues().slice(1);
  const result = {};
  rows.filter(r => r[0] && new Date(_dateStr(r[0]) + 'T12:00:00') >= cutoff).forEach(r => {
    const d = _dateStr(r[0]);
    if (!result[d]) result[d] = {};
    result[d][r[1]] = r[2];
  });
  return result;
}

// ── Combined loaders ──────────────────────────────────────────────────────────

function getDateSummary(date) {
  const d = date || _today();
  return {
    date,
    weight:            getDateWeight(d),
    food:              getDateFood(d),
    activities:        getDateActivities(d),
    foods_config:      getFoods(),
    activities_config: getActivities()
  };
}

function getTodaySummary() { return getDateSummary(_today()); }

function getHistoryPage(days) {
  return {
    weight:            getWeightHistory(days),
    food:              getFoodLog(days),
    activities:        getActivityLog(days),
    activities_config: getActivities()
  };
}
