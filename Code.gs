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

// ── One-time init ─────────────────────────────────────────────────────────────

function initFitness() {
  const SPREADSHEET_ID = 'YOUR_SPREADSHEET_ID_HERE'; // paste your sheet ID before running

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', SPREADSHEET_ID);

  function ensure(name, headers) {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    if (sh.getLastRow() === 0) sh.appendRow(headers);
    return sh;
  }

  ensure(WEIGHT_SHEET,   ['timestamp', 'weight_lbs']);
  ensure(FOODS_SHEET,    ['name', 'serving_name', 'serving_size', 'calories_per_serving']);
  ensure(FOOD_LOG_SHEET, ['timestamp', 'date', 'food_name', 'num_servings', 'calories_total']);
  ensure(ACT_SHEET,      ['name', 'type', 'unit', 'goal']);
  ensure(ACT_LOG_SHEET,  ['date', 'activity_name', 'value']);

  return 'Fitness Tracker initialized. Spreadsheet: ' + ss.getUrl();
}

// ── Weight ────────────────────────────────────────────────────────────────────

function logWeight(weight) {
  _sheet(WEIGHT_SHEET).appendRow([_ts(), parseFloat(weight)]);
  return getTodayWeight();
}

function getTodayWeight() {
  const today = _today();
  const rows  = _sheet(WEIGHT_SHEET).getDataRange().getValues().slice(1);
  const todayRows = rows.filter(r => String(r[0]).startsWith(today) && r[1]);
  const values = todayRows.map(r => parseFloat(r[1]));
  const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  return {
    entries: todayRows.map(r => ({ time: String(r[0]), weight: parseFloat(r[1]) })),
    average: avg ? Math.round(avg * 10) / 10 : null
  };
}

function getWeightHistory(days) {
  days = parseInt(days) || 30;
  const rows   = _sheet(WEIGHT_SHEET).getDataRange().getValues().slice(1);
  const byDate = {};
  rows.forEach(r => {
    if (!r[1]) return;
    const date = String(r[0]).substring(0, 10);
    if (!byDate[date]) byDate[date] = [];
    byDate[date].push(parseFloat(r[1]));
  });
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return Object.entries(byDate)
    .filter(([d]) => new Date(d) >= cutoff)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, vals]) => ({
      date,
      average: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 10) / 10,
      count: vals.length
    }));
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

function logFood(foodName, numServings, caloriesTotal) {
  _sheet(FOOD_LOG_SHEET).appendRow([_ts(), _today(), foodName, parseFloat(numServings), parseFloat(caloriesTotal)]);
  return getTodayFood();
}

function deleteFoodEntry(timestamp) {
  const sheet = _sheet(FOOD_LOG_SHEET);
  const rows  = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(timestamp)) { sheet.deleteRow(i + 1); break; }
  }
  return getTodayFood();
}

function getTodayFood() {
  const today   = _today();
  const rows    = _sheet(FOOD_LOG_SHEET).getDataRange().getValues().slice(1);
  const entries = rows.filter(r => r[1] === today && r[2]).map(r => ({
    timestamp: r[0], food_name: r[2], num_servings: parseFloat(r[3]), calories: parseFloat(r[4])
  }));
  return { entries, total_calories: Math.round(entries.reduce((s, e) => s + (e.calories || 0), 0)) };
}

function getFoodLog(days) {
  days = parseInt(days) || 7;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const rows   = _sheet(FOOD_LOG_SHEET).getDataRange().getValues().slice(1);
  const result = {};
  rows.filter(r => r[1] && new Date(r[1]) >= cutoff).forEach(r => {
    const d = r[1];
    if (!result[d]) result[d] = { entries: [], total_calories: 0 };
    result[d].entries.push({ timestamp: r[0], food_name: r[2], num_servings: parseFloat(r[3]), calories: parseFloat(r[4]) });
    result[d].total_calories += parseFloat(r[4]) || 0;
  });
  Object.values(result).forEach(day => { day.total_calories = Math.round(day.total_calories); });
  return result;
}

// ── Activities config ─────────────────────────────────────────────────────────

function getActivities() {
  const rows = _sheet(ACT_SHEET).getDataRange().getValues().slice(1);
  return rows.filter(r => r[0]).map(r => ({
    name: r[0], type: r[1] || 'checkbox', unit: r[2] || '', goal: r[3] || ''
  }));
}

function saveActivity(data) {
  const sheet = _sheet(ACT_SHEET);
  const rows  = sheet.getDataRange().getValues();
  const match = data._originalName || data.name;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === match) {
      sheet.getRange(i + 1, 1, 1, 4).setValues([[data.name, data.type, data.unit, data.goal]]);
      return getActivities();
    }
  }
  sheet.appendRow([data.name, data.type || 'checkbox', data.unit || '', data.goal || '']);
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

function logActivities(entries) {
  const today = _today();
  const sheet = _sheet(ACT_LOG_SHEET);
  const rows  = sheet.getDataRange().getValues();
  entries.forEach(entry => {
    let found = false;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] === today && rows[i][1] === entry.name) {
        sheet.getRange(i + 1, 3).setValue(entry.value);
        rows[i][2] = entry.value;
        found = true;
        break;
      }
    }
    if (!found) {
      sheet.appendRow([today, entry.name, entry.value]);
      rows.push([today, entry.name, entry.value]);
    }
  });
  return getTodayActivities();
}

function getTodayActivities() {
  const today  = _today();
  const rows   = _sheet(ACT_LOG_SHEET).getDataRange().getValues().slice(1);
  const result = {};
  rows.filter(r => r[0] === today && r[1]).forEach(r => { result[r[1]] = r[2]; });
  return result;
}

function getActivityLog(days) {
  days = parseInt(days) || 7;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const rows   = _sheet(ACT_LOG_SHEET).getDataRange().getValues().slice(1);
  const result = {};
  rows.filter(r => r[0] && new Date(r[0]) >= cutoff).forEach(r => {
    if (!result[r[0]]) result[r[0]] = {};
    result[r[0]][r[1]] = r[2];
  });
  return result;
}

// ── Combined loaders ──────────────────────────────────────────────────────────

function getTodaySummary() {
  return {
    date:              _today(),
    weight:            getTodayWeight(),
    food:              getTodayFood(),
    activities:        getTodayActivities(),
    foods_config:      getFoods(),
    activities_config: getActivities()
  };
}

function getHistoryPage(days) {
  return {
    weight:     getWeightHistory(days),
    food:       getFoodLog(days),
    activities: getActivityLog(days)
  };
}
