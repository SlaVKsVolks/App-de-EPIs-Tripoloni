
import { API_URL } from './config.js';
import { saveToDB, getFromDB, clearPendingTransactions } from './db.js';
import { showToast } from './ui.js';

export async function syncData(currentSheetId, currentConstruction, currentUser) {
    try {
        // 1. Push Pending Transactions
        const pending = await getFromDB('pending_movements');
        // Notify pending count to main/UI? We will return it or use a callback mechanism if we were strictly clean, 
        // but for now let's return stats or just do the work.

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
                showToast('Erro ao sincronizar transações.', 'error');
            }
        }

        // 2. Fetch Fresh Data
        let url = `${API_URL}?action=getData&sheetId=${encodeURIComponent(currentSheetId)}`;

        if (!currentUser || currentUser.tipo !== 'Admin') {
            url += `&obra=${encodeURIComponent(currentConstruction)}`;
        } else {
            console.log('Admin user detected: Fetching ALL data');
        }

        const response = await fetch(url);
        const data = await response.json();

        if (data.result === 'success') {
            await saveDataToLocal(data.data);
            return 'success';
        }
    } catch (err) {
        console.error('Sync failed:', err);
        // showToast('Falha na sincronização. Verifique sua conexão.', 'warning'); // Be less annoying
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

    await saveToDB('employees', employees);
    await saveToDB('epis', epis);
    await saveToDB('stock', stock);
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
    const response = await fetch(`${API_URL}?action=getConstructions`);
    return await response.json();
}
