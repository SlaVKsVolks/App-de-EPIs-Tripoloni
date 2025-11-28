/**
 * EPI Management System - Google Apps Script Backend
 * 
 * INSTRUCTIONS:
 * 1. Create a new Google Sheet named "EPI_APP_BASE_422" (or use existing).
 * 2. Ensure tabs exist: "Funcionários", "Usuários", "EPIs", "Estoque Principal", "Movimentações".
 * 3. Extensions > Apps Script > Paste this code.
 * 4. Deploy > New Deployment > Type: Web App > Execute as: Me > Who has access: Anyone.
 * 5. Copy the Web App URL and paste it into app.js.
 */

const SCRIPT_PROP = PropertiesService.getScriptProperties();

// CENTRAL REGISTRY SHEET ID (This holds the list of all constructions)
const CONSTRUCTIONS_SHEET_ID = '1n4slOjyiDzL9XFm6GLlFGJxH3eCoSc-ZT9VDpUEuUSg';

// Mapping of requested "tables" to Sheet Tab Names
const SHEET_MAPPING = {
  'employees': 'Funcionários',
  'users': 'Usuários',
  'epis': 'EPIs',
  'stock': 'Estoque Principal',
  'movements': 'Movimentações',
  'constructions': 'Obras' // Assumed tab name in the central sheet
};

function doGet(e) {
  const lock = LockService.getScriptLock();
  lock.tryLock(10000);

  try {
    const action = e.parameter.action;
    const obra = e.parameter.obra; // Optional filter
    const sheetId = e.parameter.sheetId; // Dynamic Sheet ID from frontend

    if (!action) {
      return ContentService.createTextOutput(JSON.stringify({ 'result': 'error', 'error': 'No action specified' })).setMimeType(ContentService.MimeType.JSON);
    }

    // 1. ACTION: GET CONSTRUCTIONS (Uses Central Registry)
    if (action === 'getConstructions') {
      const constructionsDoc = SpreadsheetApp.openById(CONSTRUCTIONS_SHEET_ID);
      const sheet = constructionsDoc.getSheets()[0]; // Get first sheet
      const data = sheet.getDataRange().getValues();
      const headers = data[0];
      const rows = data.slice(1);

      const result = rows.map(row => {
        let obj = {};
        headers.forEach((header, index) => {
          obj[header] = row[index];
        });
        return obj;
      });

      return ContentService.createTextOutput(JSON.stringify({ 'result': 'success', 'data': result })).setMimeType(ContentService.MimeType.JSON);
    }

    // 2. VALIDATE SHEET ID FOR OTHER ACTIONS
    if (!sheetId) {
      return ContentService.createTextOutput(JSON.stringify({ 'result': 'error', 'error': 'Missing sheetId' })).setMimeType(ContentService.MimeType.JSON);
    }

    const doc = SpreadsheetApp.openById(sheetId);

    // 3. ACTION: GET DATA (Employees, EPIs, Stock)
    if (action === 'getData') {
      const result = {};

      // Fetch Employees
      result.employees = getSheetData(doc, SHEET_MAPPING.employees, obra ? { colIndex: getColIndex(doc, SHEET_MAPPING.employees, 'Obra'), value: obra } : null);

      // Fetch EPIs
      result.epis = getSheetData(doc, SHEET_MAPPING.epis);

      // Fetch Stock
      result.stock = getSheetData(doc, SHEET_MAPPING.stock, obra ? { colIndex: getColIndex(doc, SHEET_MAPPING.stock, 'Obra'), value: obra } : null);

      return ContentService.createTextOutput(JSON.stringify({ 'result': 'success', 'data': result })).setMimeType(ContentService.MimeType.JSON);
    }

    // 4. ACTION: VALIDATE USER
    if (action === 'validateUser') {
      return validateUser(e, doc);
    }

    return ContentService.createTextOutput(JSON.stringify({ 'result': 'error', 'error': 'Invalid action' })).setMimeType(ContentService.MimeType.JSON);

  } catch (e) {
    return ContentService.createTextOutput(JSON.stringify({ 'result': 'error', 'error': e.toString() })).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

function validateUser(e, doc) {
  var email = e.parameter.email;

  if (!email) {
    return ContentService.createTextOutput(JSON.stringify({ result: 'error', error: 'Email is required' })).setMimeType(ContentService.MimeType.JSON);
  }

  var debugInfo = {
    receivedEmail: email,
    sheetName: doc.getName(),
    usersFound: 0,
    headers: []
  };

  try {
    var userSheet = doc.getSheetByName(SHEET_MAPPING.users);
    if (!userSheet) {
      return ContentService.createTextOutput(JSON.stringify({
        result: 'error',
        error: 'Tab "Usuários" not found in sheet: ' + debugInfo.sheetName,
        debug: debugInfo
      })).setMimeType(ContentService.MimeType.JSON);
    }

    var data = userSheet.getDataRange().getValues();
    var headers = data[0].map(function (h) { return String(h).toLowerCase().trim(); });
    debugInfo.headers = headers;

    // Find email column (flexible matching)
    var emailColIndex = headers.indexOf('email');
    if (emailColIndex === -1) emailColIndex = headers.indexOf('e-mail');
    if (emailColIndex === -1) emailColIndex = headers.indexOf('usuario'); // Fallback

    if (emailColIndex === -1) {
      return ContentService.createTextOutput(JSON.stringify({
        result: 'error',
        error: 'Email column not found',
        debug: debugInfo
      })).setMimeType(ContentService.MimeType.JSON);
    }

    var user = null;
    var cleanInputEmail = email.trim().toLowerCase();

    // Debug: Log first 5 emails found
    debugInfo.firstFewEmails = [];

    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      var rowEmail = String(row[emailColIndex]).trim().toLowerCase();

      if (debugInfo.firstFewEmails.length < 5) {
        debugInfo.firstFewEmails.push(rowEmail);
      }

      if (rowEmail === cleanInputEmail) {
        user = {};
        for (var j = 0; j < headers.length; j++) {
          user[headers[j]] = row[j]; // Map all columns
        }
        break;
      }
    }

    if (user) {
      return ContentService.createTextOutput(JSON.stringify({ result: 'success', user: user, debug: debugInfo })).setMimeType(ContentService.MimeType.JSON);
    } else {
      return ContentService.createTextOutput(JSON.stringify({ result: 'error', error: 'User not found', debug: debugInfo })).setMimeType(ContentService.MimeType.JSON);
    }

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      result: 'error',
      error: err.toString(),
      debug: debugInfo
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.tryLock(10000);

  try {
    const postData = JSON.parse(e.postData.contents);
    const action = postData.action;
    const sheetId = postData.sheetId;

    if (!action) {
      return ContentService.createTextOutput(JSON.stringify({ 'result': 'error', 'error': 'No action specified' })).setMimeType(ContentService.MimeType.JSON);
    }

    // ACTION: REQUEST ACCESS
    if (action === 'requestAccess') {
      const email = postData.email;
      const name = postData.name;
      const position = postData.position;
      const reason = postData.reason || 'No reason provided';

      // REPLACE WITH YOUR EMAIL (The admin who should receive requests)
      const ADMIN_EMAIL = 'apptripoloni@gmail.com';

      const subject = `[EPI App] Solicitação de Acesso: ${name}`;
      const body = `
            Nova Solicitação de Acesso:
            
            Nome: ${name}
            Email: ${email}
            Cargo: ${position}
            Motivo: ${reason}
            
            Acesse a planilha 'Usuários' da obra correspondente para liberar o acesso.
        `;

      try {
        MailApp.sendEmail(ADMIN_EMAIL, subject, body);
        return ContentService.createTextOutput(JSON.stringify({ 'result': 'success', 'message': 'Request sent' })).setMimeType(ContentService.MimeType.JSON);
      } catch (mailError) {
        return ContentService.createTextOutput(JSON.stringify({ 'result': 'error', 'error': 'Error sending email: ' + mailError.toString() })).setMimeType(ContentService.MimeType.JSON);
      }
    }

    // VALIDATE SHEET ID FOR DB ACTIONS
    if (!sheetId) {
      return ContentService.createTextOutput(JSON.stringify({ 'result': 'error', 'error': 'Missing sheetId' })).setMimeType(ContentService.MimeType.JSON);
    }

    // ACTION: SYNC TRANSACTIONS
    if (action === 'syncTransactions') {
      const transactions = postData.transactions;
      const doc = SpreadsheetApp.openById(sheetId);
      const movementSheet = doc.getSheetByName(SHEET_MAPPING.movements);
      const stockSheet = doc.getSheetByName(SHEET_MAPPING.stock);

      const processedIds = [];
      const errors = [];

      transactions.forEach(tx => {
        try {
          // Append Row
          movementSheet.appendRow([
            tx.id,
            new Date(tx.timestamp), // Or tx.dateString
            tx.userId,
            tx.employeeId,
            tx.epiId,
            tx.type, // 'ENTREGA' or 'DEVOLUCAO'
            tx.quantity,
            tx.obra || '',
            tx.signature || ''
          ]);

          // 2. Update Stock
          updateStock(stockSheet, tx.epiId, tx.quantity, tx.type, tx.obra);

          processedIds.push(tx.id);
        } catch (err) {
          errors.push({ id: tx.id, error: err.toString() });
        }
      });

      return ContentService.createTextOutput(JSON.stringify({
        'result': 'success',
        'processed': processedIds,
        'errors': errors
      })).setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({ 'result': 'error', 'error': 'Invalid action' })).setMimeType(ContentService.MimeType.JSON);

  } catch (e) {
    return ContentService.createTextOutput(JSON.stringify({ 'result': 'error', 'error': e.toString() })).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

// --- Helper Functions ---

function getSheetData(doc, sheetName, filter) {
  const sheet = doc.getSheetByName(sheetName);
  if (!sheet) return [];

  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const rows = data.slice(1);

  const result = rows.map(row => {
    let obj = {};
    headers.forEach((header, index) => {
      obj[header] = row[index];
    });
    return obj;
  });

  if (filter && filter.colIndex !== -1) {
    return result.filter(item => {
      const key = headers[filter.colIndex];
      return String(item[key]) === String(filter.value);
    });
  }

  return result;
}

function getColIndex(doc, sheetName, colNamePartial) {
  const sheet = doc.getSheetByName(sheetName);
  if (!sheet) return -1;
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  return headers.findIndex(h => h.toString().toLowerCase().includes(colNamePartial.toLowerCase()));
}

function updateStock(sheet, epiId, qty, type, obra) {
  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  const idCol = headers.findIndex(h => h.toString().toLowerCase().includes('id_epi') || h.toString().toLowerCase() === 'id');
  const qtyCol = headers.findIndex(h => h.toString().toLowerCase().includes('quantidade') || h.toString().toLowerCase().includes('qtd'));
  const obraCol = headers.findIndex(h => h.toString().toLowerCase().includes('obra'));

  if (idCol === -1 || qtyCol === -1) return;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (String(row[idCol]) === String(epiId)) {
      if (obraCol !== -1 && obra) {
        if (String(row[obraCol]) !== String(obra)) continue;
      }

      let currentQty = Number(row[qtyCol]);
      let change = Number(qty);

      if (type === 'ENTREGA') {
        currentQty -= change;
      } else if (type === 'DEVOLUCAO') {
        currentQty += change;
      }

      sheet.getRange(i + 1, qtyCol + 1).setValue(currentQty);
      return;
    }
  }
}
