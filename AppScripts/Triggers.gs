// Keeps the reference-data cache in InventoryService.gs (getLocations,
// getPaymentTypes, getExpenseCategories, getPriceMap_) correct without a
// time-based guess at freshness: Справочники is only ever edited by a human
// in the Sheets UI, so a real onEdit is the exact moment to invalidate.

// Simple trigger — Apps Script runs this automatically on every edit to the
// bound spreadsheet, no manual trigger setup needed. Only clears the cache
// when the edit actually touched Справочники; any other sheet is a no-op.
function onEdit(e) {
  if (!e || !e.range) return;
  if (e.range.getSheet().getName() !== SHEET_REFERENCES) return;
  invalidateReferenceCache_();
}

// Safety net in case an edit ever reaches Справочники without onEdit firing
// (e.g. a future change that writes to it programmatically instead of by
// hand). Not wired up automatically — run installDailyTrigger_() once from
// the Apps Script editor to schedule this; same "run once by hand" pattern
// as testExpenseLayerWiring in ExpenseService.gs.
function dailyReferenceCacheRefresh_() {
  invalidateReferenceCache_();
}

function installDailyTrigger_() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'dailyReferenceCacheRefresh_'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('dailyReferenceCacheRefresh_')
    .timeBased()
    .everyDays(1)
    .atHour(3)
    .create();
  Logger.log('Ежедневный сброс кэша справочников установлен на ~03:00 (Asia/Tashkent).');
}
