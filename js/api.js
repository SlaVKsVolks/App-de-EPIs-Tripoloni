
import { API_URL } from './config.js';
import { saveToDB, getFromDB, clearPendingTransactions } from './db.js';
import { showToast } from './ui.js';

export async function syncData(currentSheetId, currentConstruction, currentUser) {
    try {
        // 1. Push Pending Transactions
        const pending = await getFromDB('pending_movements');

        if (pending.length > 0) {
            console.log('Pushing transactions...', pending);
            const response = await fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({
                    action: 'syncTransactions',
                    transactions: pending,
                    sheetId: currentSheetId
                })
            });

            const result = await response.json();
            if (result.result === 'success') {
                await clearPendingTransactions(result.processed);
                showToast('Sincronização realizada com sucesso!', 'success');
            } else {
                console.error('Sync error:', result);
                const msg = result.error || 'Erro desconhecido ao sincronizar.';
                showToast('Erro: ' + msg, 'error');
            }
        }

        // 2. Fetch Fresh Data
        let url = `${API_URL}?action=getData&sheetId=${encodeURIComponent(currentSheetId)}`;

        if (!currentUser || currentUser.tipo !== 'Admin') {
            url += `&obra=${encodeURIComponent(currentConstruction)}`;
        } else {
            console.log('Admin user detected: Fetching ALL data');
        }

        const dataResponse = await fetch(url);
        const data = await dataResponse.json();

        if (data.result === 'success') {
            await saveDataToLocal(data.data);
            return 'success';
        }

    } catch (err) {
        console.error('Sync failed:', err);
        throw err;
    }
}

async function saveDataToLocal(data) {
    const normalize = (list, idFieldNames, targetIdField) => {
        return list.map(item => {
            let foundId = null;
            for (const key of idFieldNames) {
                if (item[key]) {
                    foundId = item[key];
                    break;
                }
            }
            const newItem = { ...item };
            if (foundId) newItem[targetIdField] = foundId;
            return newItem;
        }).filter(item => item[targetIdField] !== undefined && item[targetIdField] !== null && item[targetIdField] !== '');
    };

    const employees = normalize(data.employees, ['ID', 'id', 'ID do Funcionário', 'ID Funcionario'], 'ID');
    const epis = normalize(data.epis, ['ID', 'id', 'ID do EPI', 'ID EPI', 'ID do Epi'], 'ID');
    const stock = normalize(data.stock, ['ID_EPI', 'id_epi', 'ID do EPI', 'ID EPI'], 'ID_EPI');

    // Users (flexible ID)
    const users = normalize(data.users, ['ID', 'id', 'Id', 'Email'], 'ID');

    // Movements (History)
    const movements = data.movements || [];

    await saveToDB('employees', employees);
    await saveToDB('epis', epis);
    await saveToDB('stock', stock);
    await saveToDB('users', users);
    await saveToDB('movements', movements);
}

export async function validateUserEmail(email, sheetId) {
    const response = await fetch(`${API_URL}?action=validateUser&email=${encodeURIComponent(email)}&sheetId=${encodeURIComponent(sheetId)}`);
    return await response.json();
}

export async function requestAccess(data) {
    const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
            action: 'requestAccess',
            ...data
        })
    });
    return await response.json();
}

export async function fetchConstructions() {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 10000); // 10s timeout

    try {
        const response = await fetch(`${API_URL}?action=getConstructions`, {
            signal: controller.signal
        });
        clearTimeout(id);
        if (!response.ok) throw new Error('Network response was not ok');
        return await response.json();
    } catch (e) {
        clearTimeout(id);
        console.error("Fetch Constructions Failed:", e);
        throw e; // Propagate to main.js catch block
    }
}
