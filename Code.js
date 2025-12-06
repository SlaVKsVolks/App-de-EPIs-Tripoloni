/**
 * EPI Management System - Google Apps Script Backend
 * 
 * VERSION: v2.3 (Business Logic & Data Quality Fixes)
 * 
 * INSTRUCTIONS:
 * 1. Extensions > Apps Script > Paste this code.
 * 2. Deploy > New Deployment > Type: Web App > Execute as: Me > Who has access: Anyone.
 * 3. Copy the Web App URL and update 'js/config.js' in the frontend.
 */

const SCRIPT_PROP = PropertiesService.getScriptProperties();

// CENTRAL REGISTRY SHEET ID (Holds the list of all constructions)
const CONSTRUCTIONS_SHEET_ID = '1n4slOjyiDzL9XFm6GLlFGJxH3eCoSc-ZT9VDpUEuUSg';

const SHEET_MAPPING = {
  'employees': 'Funcionários',
  'users': 'Usuários',
  'epis': 'EPIs',
  'stock': 'Estoque Principal',
  'movements': 'Movimentações',
  'constructions': 'Obras'
};

function doGet(e) {
  return handleRequest(e, 'GET');
}

function doPost(e) {
  return handleRequest(e, 'POST');
}

function handleRequest(e, method) {
  const lock = LockService.getScriptLock();
  lock.tryLock(30000);

  try {
    const params = method === 'POST' ? JSON.parse(e.postData.contents) : e.parameter;
    const action = params.action;
    const sheetId = params.sheetId;

    if (!action) return jsonResponse({ 'result': 'error', 'error': 'No action specified' });

    // --- NON-DB ACTIONS ---
    if (action === 'getConstructions') return getConstructions();
    if (action === 'requestAccess') return requestAccess(params);

    // --- DB ACTIONS (Require Sheet ID) ---
    if (!sheetId) return jsonResponse({ 'result': 'error', 'error': 'Missing sheetId' });

    const doc = SpreadsheetApp.openById(sheetId);

    if (action === 'getData') return getData(doc, params.obra);
    if (action === 'validateUser') return validateUser(doc, params.email);
    if (action === 'syncTransactions') return syncTransactions(doc, params.transactions);

    return jsonResponse({ 'result': 'error', 'error': 'Invalid action' });

  } catch (err) {
    return jsonResponse({ 'result': 'error', 'error': err.toString() });
  } finally {
    lock.releaseLock();
  }
}

// ==========================================
// ACTION HANDLERS
// ==========================================

function getConstructions() {
  const doc = SpreadsheetApp.openById(CONSTRUCTIONS_SHEET_ID);
  const sheet = doc.getSheets()[0];
  const data = getSheetDataAsJson(sheet);
  return jsonResponse({ 'result': 'success', 'data': data });
}

function getData(doc, obraFilter) {
  const result = {};

  // Employees: Filter by Obra if provided
  const empSheet = doc.getSheetByName(SHEET_MAPPING.employees);
  result.employees = getSheetDataAsJson(empSheet, obraFilter ? { col: 'Obra', val: obraFilter } : null);

  // EPIs: All
  const epiSheet = doc.getSheetByName(SHEET_MAPPING.epis);
  result.epis = getSheetDataAsJson(epiSheet);

  // Stock: Filter by Obra if provided
  const stockSheet = doc.getSheetByName(SHEET_MAPPING.stock);
  result.stock = getSheetDataAsJson(stockSheet, obraFilter ? { col: 'Obra', val: obraFilter } : null);

  // Users: All (for validation/listing)
  const usersSheet = doc.getSheetByName(SHEET_MAPPING.users);
  result.users = getSheetDataAsJson(usersSheet);

  // Movements: Recent History (Last 50)
  const movSheet = doc.getSheetByName(SHEET_MAPPING.movements);
  result.movements = getRecentMovements(movSheet);

  return jsonResponse({ 'result': 'success', 'data': result });
}

function getRecentMovements(sheet) {
  if (!sheet) return [];
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const startRow = Math.max(2, lastRow - 49); // Read last 50
  const numRows = lastRow - startRow + 1;

  const data = sheet.getRange(startRow, 1, numRows, sheet.getLastColumn()).getValues();

  // Map and Reverse (Newest first)
  return data.map(row => {
    let obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  }).reverse();
}

function validateUser(doc, email) {
  if (!email) return jsonResponse({ result: 'error', error: 'Email is required' });

  const sheet = doc.getSheetByName(SHEET_MAPPING.users);
  if (!sheet) return jsonResponse({ result: 'error', error: 'Tab "Usuários" not found' });

  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(h => String(h).toLowerCase().trim());

  // Flexible Email Column Finding
  let emailIdx = headers.indexOf('email');
  if (emailIdx === -1) emailIdx = headers.indexOf('e-mail');
  if (emailIdx === -1) emailIdx = headers.indexOf('usuario');

  if (emailIdx === -1) {
    return jsonResponse({ result: 'error', error: 'Email column not found', debug: headers });
  }

  const cleanEmail = email.trim().toLowerCase();

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (String(row[emailIdx]).trim().toLowerCase() === cleanEmail) {
      const userObj = {};
      headers.forEach((h, idx) => userObj[h] = row[idx]);

      // Ensure 'id' key exists for frontend
      const idIdx = headers.indexOf('id');
      if (idIdx !== -1) userObj.id = row[idIdx];

      return jsonResponse({ result: 'success', user: userObj });
    }
  }

  return jsonResponse({ result: 'error', error: 'User not found' });
}

function requestAccess(data) {
  const ADMIN_EMAIL = 'apptripoloni@gmail.com';
  const subject = `[EPI App] Solicitação de Acesso: ${data.name}`;
  const body = `
      Nova Solicitação de Acesso:
      Nome: ${data.name}
      Email: ${data.email}
      Cargo: ${data.position}
      Motivo: ${data.reason || 'N/A'}
      
      Acesse a planilha 'Usuários' da obra correspondente para liberar o acesso.
  `;

  try {
    MailApp.sendEmail(ADMIN_EMAIL, subject, body);
    return jsonResponse({ 'result': 'success', 'message': 'Request sent' });
  } catch (err) {
    return jsonResponse({ 'result': 'error', 'error': 'Email error: ' + err.toString() });
  }
}

// ==========================================
// DATA SYNC LOGIC
// ==========================================

// ==========================================
// DATA SYNC LOGIC
// ==========================================

function syncTransactions(doc, transactions) {
  if (!transactions || transactions.length === 0) {
    return jsonResponse({ 'result': 'success', 'processed': [] });
  }

  const stockSheet = doc.getSheetByName(SHEET_MAPPING.stock);
  const movementSheet = doc.getSheetByName(SHEET_MAPPING.movements);

  if (!stockSheet) return jsonResponse({ 'result': 'error', 'error': `Tab '${SHEET_MAPPING.stock}' not found` });
  if (!movementSheet) return jsonResponse({ 'result': 'error', 'error': `Tab '${SHEET_MAPPING.movements}' not found` });

  // 1. MAP HEADERS (STOCK)
  const stockRange = stockSheet.getDataRange();
  const stockValues = stockRange.getValues();
  if (stockValues.length === 0) return jsonResponse({ 'result': 'error', 'error': 'Stock sheet is empty' });

  const stockHeaders = stockValues[0].map(h => String(h).toLowerCase().trim());

  // Flexible Matching
  const idxId = stockHeaders.findIndex(h => h === 'id' || h === 'id_epi' || h === 'idepi' || h === 'id do epi' || h.includes('id epi'));
  const idxQty = stockHeaders.findIndex(h => h === 'qtd' || h === 'quantidade' || h.includes('quant') || h === 'estoque atual' || h === 'estoque');
  const idxObra = stockHeaders.findIndex(h => h.includes('obra') || h.includes('local'));

  if (idxId === -1 || idxQty === -1) {
    return jsonResponse({
      'result': 'error',
      'error': `CRITICAL: Columns missing in Stock. Need 'ID/ID_EPI' and 'Qtd/Estoque'. Found: [${stockValues[0].join(', ')}]`
    });
  }

  // 2. PROCESS TRANSACTIONS
  const processedIds = [];
  const errors = [];
  const stockUpdates = {};

  // Get Next Launch ID
  let nextIdNum = getNextId(movementSheet);

  transactions.forEach(tx => {
    try {
      // Find Stock Row
      let rowIndex = -1;
      for (let i = 1; i < stockValues.length; i++) {
        const row = stockValues[i];
        if (String(row[idxId]) === String(tx.epiId)) {
          if (idxObra !== -1 && tx.obra) {
            if (String(row[idxObra]) === String(tx.obra)) {
              rowIndex = i;
              break;
            }
          } else {
            rowIndex = i;
            break;
          }
        }
      }

      // Update Stock Logic
      if (rowIndex !== -1) {
        let currentQty;
        if (stockUpdates[rowIndex] !== undefined) {
          currentQty = stockUpdates[rowIndex];
        } else {
          currentQty = Number(stockValues[rowIndex][idxQty]);
        }

        const change = Number(tx.quantity);
        const typeNormal = tx.type.toUpperCase();

        if (typeNormal === 'ENTREGA') {
          currentQty -= change;
        } else if (typeNormal === 'DEVOLUCAO' || typeNormal === 'COMPRA') {
          currentQty += change;
        } else if (typeNormal === 'AJUSTE') {
          currentQty += change; // Can be negative
        }
        stockUpdates[rowIndex] = currentQty;
      }

      // Generate Data for Row
      const newLaunchId = 'LNC' + String(nextIdNum).padStart(5, '0');
      nextIdNum++;

      let typeTitle;
      if (tx.type.toLowerCase() === 'entrega') typeTitle = 'Entrega';
      else if (tx.type.toLowerCase() === 'devolucao') typeTitle = 'Devolução';
      else if (tx.type.toLowerCase() === 'compra') typeTitle = 'Compra';
      else if (tx.type.toLowerCase() === 'ajuste') typeTitle = 'Ajuste';
      else typeTitle = tx.type;

      let origin, dest, condition;

      if (typeTitle === 'Entrega') {
        origin = 'Estoque Principal';
        dest = `${tx.employeeId}`;
        condition = 'N/A';
      } else if (typeTitle === 'Devolução') {
        origin = `${tx.employeeId}`;
        dest = 'Estoque Principal';
        condition = 'Usado';
      } else if (typeTitle === 'Compra') {
        origin = 'Fornecedor';
        dest = 'Estoque Principal';
        condition = 'Novo';
      } else if (typeTitle === 'Ajuste') {
        origin = 'Ajuste Manual';
        dest = 'Estoque Principal';
        condition = 'N/A';
      } else {
        origin = 'Desconhecido';
        dest = 'Desconhecido';
        condition = 'N/A';
      }

      // Append Row (Columns A-N)
      const rowData = [
        newLaunchId,
        new Date(),
        new Date(tx.timestamp),
        tx.userId,
        typeTitle,
        tx.employeeId,
        tx.epiId,
        tx.quantity,
        condition,
        origin,
        dest,
        '', // Placeholder for signature
        'Sincronizado',
        ''
      ];

      movementSheet.appendRow(rowData);
      const lastRow = movementSheet.getLastRow();

      // HANDLE SIGNATURE (SAVE TO DRIVE + CELL IMAGE)
      if (tx.signature && tx.signature.startsWith('data:image')) {
        try {
          const folder = getOrCreateFolder("EPI_Assinaturas");
          const base64 = tx.signature.split(',')[1];
          const blob = Utilities.newBlob(Utilities.base64Decode(base64), 'image/png', `sig_${newLaunchId}.png`);

          // Save to Drive
          const file = folder.createFile(blob);
          file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); // Ensure visibility

          // Create CellImage from Drive URL
          // Note: setSourceUrl needs a publicly accessible URL or appropriate rights. 
          // `getDownloadUrl()` often works best for internal scripts.
          // Alternatively use =IMAGE(url, 4, 50, 100) if newCellImage fails.
          // Using Builder is safer for embedding.

          try {
            // Method A: CellImage (Modern, Embedded)
            const builder = SpreadsheetApp.newCellImage();
            builder.setSourceUrl(file.getDownloadUrl());
            builder.setAltTextDescription(`Assinatura ${newLaunchId}`);
            const cellImage = builder.build();
            movementSheet.getRange(lastRow, 12).setValue(cellImage);
          } catch (e2) {
            // Method B: Fallback to IMAGE Formula
            // Thumbnail link is usually reliable for IMAGE() function.
            const thumbUrl = file.getThumbnailLink().replace('sz=w220', 'sz=w1000'); // HACK: Get larger view
            movementSheet.getRange(lastRow, 12).setFormula(`=IMAGE("${thumbUrl}")`);
          }

        } catch (imgErr) {
          movementSheet.getRange(lastRow, 12).setValue('Erro Imagem: ' + imgErr.toString());
        }
      }

      processedIds.push(tx.id);

    } catch (e) {
      errors.push({ id: tx.id, error: e.toString() });
    }
  });

  // Apply Stock Updates
  for (const [rIdx, qty] of Object.entries(stockUpdates)) {
    stockSheet.getRange(parseInt(rIdx) + 1, idxQty + 1).setValue(qty);
  }

  return jsonResponse({ 'result': 'success', 'processed': processedIds, 'errors': errors });
}

// ==========================================
// HELPERS
// ==========================================

function getOrCreateFolder(folderName) {
  const folders = DriveApp.getFoldersByName(folderName);
  if (folders.hasNext()) {
    return folders.next();
  } else {
    return DriveApp.createFolder(folderName);
  }
}

function getNextId(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 1;

  const lastIdVal = sheet.getRange(lastRow, 1).getValue();
  const match = String(lastIdVal).match(/LNC(\d+)/);
  if (match) {
    return parseInt(match[1]) + 1;
  }
  return 1;
}

function getSheetDataAsJson(sheet, filterConfig = null) {
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];

  const headers = data[0];
  const rows = data.slice(1);
  let filterColIdx = -1;

  if (filterConfig) {
    filterColIdx = headers.findIndex(h => String(h).toLowerCase() === String(filterConfig.col).toLowerCase());
  }

  const result = [];
  for (const row of rows) {
    if (filterConfig && filterColIdx !== -1) {
      if (String(row[filterColIdx]) !== String(filterConfig.val)) continue;
    }

    let obj = {};
    headers.forEach((h, i) => {
      obj[h] = row[i];
    });
    result.push(obj);
  }
  return result;
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ==========================================
// SETUP & AUTH (Run once manually to fix permissions)
// ==========================================
function setupAuth() {
  DriveApp.createFolder("Temp_Auth_Test");
  console.log("Permissões de ESCRITA concedidas! Agora o App pode criar pastas.");
}
