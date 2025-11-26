/**
 * EPI Manager - App Logic
 * Handles IndexedDB, Sync, UI, and Signature
 */

// CONFIGURATION
// REPLACE THIS URL WITH YOUR DEPLOYED GOOGLE APPS SCRIPT WEB APP URL
const API_URL = 'https://script.google.com/macros/s/AKfycbx6NTGNFCPtDSTO1w5S00m0Nlv7GVsy5TffxgksCBwyHwYhdI9LdvMIfpAXwWsyJfP_QA/exec';

const DB_NAME = 'epi_manager_db';
const DB_VERSION = 1;

// STATE
let db;
let currentTab = 'entrega'; // entrega, devolucao, estoque
let signaturePad;
let currentConstruction = null;
let currentSheetId = null;
let currentUser = null;
let deferredPrompt;

// --- INITIALIZATION ---

document.addEventListener('DOMContentLoaded', async () => {
    initSignaturePad();
    await initDB();

    // PWA Install Prompt
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        const installBtn = document.getElementById('btn-install-pwa');
        if (installBtn) {
            installBtn.style.display = 'block';
            installBtn.addEventListener('click', async () => {
                installBtn.style.display = 'none';
                deferredPrompt.prompt();
                const { outcome } = await deferredPrompt.userChoice;
                console.log(`User response to the install prompt: ${outcome}`);
                deferredPrompt = null;
            });
        }
    });

    // Start App Flow (Check for persistent login first)
    initAppFlow();

    // Register Service Worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('SW registered', reg))
            .catch(err => console.error('SW failed', err));
    }

    // Connection Status
    updateConnectionStatus();
    window.addEventListener('online', updateConnectionStatus);
    window.addEventListener('offline', updateConnectionStatus);

    // Registration Events (Global)
    const btnRegister = document.getElementById('btn-submit-registration');
    if (btnRegister) {
        btnRegister.addEventListener('click', handleRegistrationSubmit);
    }

    const btnBackLogin = document.getElementById('btn-back-to-login');
    if (btnBackLogin) {
        btnBackLogin.addEventListener('click', () => {
            document.getElementById('screen-register').style.display = 'none';
            document.getElementById('screen-login').style.display = 'block';
        });
    }

    const linkRequest = document.getElementById('link-request-access');
    if (linkRequest) {
        linkRequest.addEventListener('click', (e) => {
            e.preventDefault();
            document.getElementById('screen-login').style.display = 'none';
            document.getElementById('screen-register').style.display = 'block';
        });
    }

    // Dashboard Events
    document.getElementById('card-delivery').addEventListener('click', () => openAppSection('entrega'));
    document.getElementById('card-return').addEventListener('click', () => openAppSection('devolucao'));
    document.getElementById('card-stock').addEventListener('click', () => openAppSection('estoque'));
    document.getElementById('btn-back-dashboard').addEventListener('click', showDashboard);
    document.getElementById('btn-logout').addEventListener('click', handleLogout);
});

function handleCredentialResponse(response) {
    try {
        const responsePayload = parseJwt(response.credential);
        const email = responsePayload.email;

        console.log("Google ID: " + responsePayload.sub);
        console.log("Email: " + responsePayload.email);

        validateUserEmail(email);

    } catch (e) {
        console.error("Error decoding JWT", e);
        alert("Erro ao processar login do Google.");
    }
}

function parseJwt(token) {
    var base64Url = token.split('.')[1];
    var base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    var jsonPayload = decodeURIComponent(window.atob(base64).split('').map(function (c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));

    return JSON.parse(jsonPayload);
}

async function initAppFlow() {
    console.log('initAppFlow started');

    // CHECK PERSISTENT LOGIN
    const savedUser = localStorage.getItem('currentUser');
    const savedSheetId = localStorage.getItem('currentSheetId');
    const savedConstruction = localStorage.getItem('currentConstruction');

    if (savedUser && savedSheetId && savedConstruction) {
        console.log('Found saved session. Restoring...');
        currentUser = JSON.parse(savedUser);
        currentSheetId = savedSheetId;
        currentConstruction = savedConstruction;

        // Skip to Dashboard
        document.getElementById('screen-construction').style.display = 'none';
        showDashboard();

        // Background Sync
        setupEventListeners();
        if (navigator.onLine) {
            syncData();
        } else {
            loadLocalData();
        }
        return;
    }

    // If no session, start normal flow
    const loadingDiv = document.getElementById('construction-loading');
    const selectContainer = document.getElementById('construction-select-container');
    const select = document.getElementById('select-construction');
    const btnConfirm = document.getElementById('btn-confirm-construction');

    try {
        console.log('Fetching constructions from:', API_URL);
        const response = await fetch(`${API_URL}?action=getConstructions`);
        const result = await response.json();
        console.log('Fetch result:', result);

        if (result.result === 'success') {
            select.innerHTML = '<option value="">Selecione...</option>';
            result.data.forEach(item => {
                const name = item.Obra || item.Nome || item.Name || Object.values(item)[0];
                const sheetId = item['Sheet ID'] || item.sheetId || item.SheetId;

                if (name) {
                    const option = document.createElement('option');
                    option.value = name;
                    option.innerText = name;
                    if (sheetId) {
                        option.dataset.sheetId = sheetId;
                    }
                    select.appendChild(option);
                }
            });

            loadingDiv.style.display = 'none';
            selectContainer.style.display = 'block';
        } else {
            loadingDiv.innerHTML = '<p style="color: #dc3545;">Erro ao carregar obras.</p>';
        }
    } catch (err) {
        console.error(err);
        loadingDiv.innerHTML = '<p style="color: #dc3545;">Erro de conexão. Tente novamente.</p>';
    }

    if (btnConfirm) btnConfirm.addEventListener('click', handleConstructionSelection);
}

function handleConstructionSelection() {
    const select = document.getElementById('select-construction');
    if (!select.value) {
        alert('Por favor, selecione uma obra.');
        return;
    }
    currentConstruction = select.value;
    const selectedOption = select.options[select.selectedIndex];
    currentSheetId = selectedOption.dataset.sheetId;

    if (!currentSheetId) {
        console.warn('No Sheet ID found for selected construction. API calls might fail if not using default.');
    }

    document.getElementById('screen-construction').style.display = 'none';
    document.getElementById('screen-login').style.display = 'block';
}

async function validateUserEmail(email) {
    console.log('validateUserEmail called with email:', email);
    showLoading(true);
    try {
        console.log('Making API request to validate user...');
        const response = await fetch(`${API_URL}?action=validateUser&email=${encodeURIComponent(email)}&sheetId=${encodeURIComponent(currentSheetId)}`);
        console.log('API response received:', response);
        const result = await response.json();
        console.log('Validation result:', result);

        if (result.result === 'success') {
            console.log('User validated successfully:', result.user);
            currentUser = result.user;

            // SAVE SESSION
            localStorage.setItem('currentUser', JSON.stringify(currentUser));
            localStorage.setItem('currentSheetId', currentSheetId);
            localStorage.setItem('currentConstruction', currentConstruction);

            console.log('Switching to Dashboard...');
            document.getElementById('screen-login').style.display = 'none';
            showDashboard();

            setupEventListeners();

            if (navigator.onLine) {
                await syncData();
            } else {
                await loadLocalData();
            }

        } else {
            console.error('User validation failed:', result);
            console.log('Debug info from backend:', result.debug);

            // Show Registration Screen
            try {
                console.log('Attempting to switch to registration screen...');
                const loginScreen = document.getElementById('screen-login');
                const registerScreen = document.getElementById('screen-register');
                const emailInput = document.getElementById('register-email');

                if (loginScreen && registerScreen) {
                    loginScreen.style.display = 'none';
                    registerScreen.style.display = 'block';
                    console.log('Switched to registration screen.');
                } else {
                    console.error('Could not find screen elements:', { loginScreen, registerScreen });
                }

                // Prefill email
                if (emailInput) {
                    emailInput.value = email;
                }
            } catch (uiErr) {
                console.error('Error switching UI:', uiErr);
            }
        }
    } catch (err) {
        console.error('Error in validateUserEmail:', err);
        alert('Erro ao validar usuário. Verifique sua conexão.');
    } finally {
        showLoading(false);
    }
}

function showDashboard() {
    document.getElementById('screen-dashboard').style.display = 'flex'; // Flex for centering if needed, or block
    document.getElementById('app-section').style.display = 'none';
    document.getElementById('screen-login').style.display = 'none';
    document.getElementById('screen-construction').style.display = 'none';
}

function openAppSection(tabName) {
    document.getElementById('screen-dashboard').style.display = 'none';
    document.getElementById('app-section').style.display = 'block';

    // Activate correct tab
    const tabs = document.querySelectorAll('.tab');
    tabs.forEach(t => {
        t.classList.remove('active');
        if (t.dataset.tab === tabName) {
            t.classList.add('active');
        }
    });

    currentTab = tabName;
    updateUIForTab();
}

function updateUIForTab() {
    if (currentTab === 'estoque') {
        document.getElementById('transaction-view').style.display = 'none';
        document.getElementById('stock-view').style.display = 'block';
    } else {
        document.getElementById('transaction-view').style.display = 'block';
        document.getElementById('stock-view').style.display = 'none';

        const title = currentTab === 'entrega' ? 'Registrar Entrega' : 'Registrar Devolução';
        document.getElementById('form-title').innerText = title;
        document.getElementById('btn-submit').innerText = currentTab === 'entrega' ? 'CONFIRMAR ENTREGA' : 'CONFIRMAR DEVOLUÇÃO';
    }
}

function handleLogout() {
    if (confirm('Tem certeza que deseja sair?')) {
        localStorage.clear();
        location.reload();
    }
}

function updateConnectionStatus() {
    const statusEl = document.getElementById('connection-status');
    const indicator = document.getElementById('status-indicator');

    if (navigator.onLine) {
        statusEl.innerText = '🟢 Online';
        indicator.innerText = 'Online';
        indicator.style.background = 'rgba(40, 167, 69, 0.8)';
    } else {
        statusEl.innerText = '🔴 Offline';
        indicator.innerText = 'Offline';
        indicator.style.background = 'rgba(220, 53, 69, 0.8)';
    }
}

// --- INDEXEDDB ---

function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = event => reject('DB Error: ' + event.target.error);

        request.onupgradeneeded = event => {
            const db = event.target.result;
            // Stores for data
            if (!db.objectStoreNames.contains('employees')) db.createObjectStore('employees', { keyPath: 'ID' }); // Assuming ID exists
            if (!db.objectStoreNames.contains('epis')) db.createObjectStore('epis', { keyPath: 'ID' });
            if (!db.objectStoreNames.contains('stock')) db.createObjectStore('stock', { keyPath: 'ID_EPI' }); // Or composite key?

            // Store for pending transactions
            if (!db.objectStoreNames.contains('pending_movements')) {
                db.createObjectStore('pending_movements', { keyPath: 'id' });
            }
        };

        request.onsuccess = event => {
            db = event.target.result;
            resolve(db);
        };
    });
}

async function saveToDB(storeName, data) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);

        // Clear existing data for catalogs (full refresh strategy)
        if (storeName !== 'pending_movements') {
            store.clear();
        }

        data.forEach(item => {
            // Ensure we have a valid key if using keyPath
            // For stock, if ID_EPI is missing, we might have issues.
            store.put(item);
        });

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function getFromDB(storeName) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const request = store.getAll();

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function addPendingTransaction(transaction) {
    return new Promise((resolve, reject) => {
        const tx = db.transaction('pending_movements', 'readwrite');
        const store = tx.objectStore('pending_movements');
        store.add(transaction);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function clearPendingTransactions(idsToRemove) {
    const tx = db.transaction('pending_movements', 'readwrite');
    const store = tx.objectStore('pending_movements');

    idsToRemove.forEach(id => store.delete(id));

    return new Promise((resolve) => {
        tx.oncomplete = () => resolve();
    });
}

// --- SYNC LOGIC ---

async function syncData() {
    showLoading(true);
    try {
        // 1. Push Pending Transactions
        const pending = await getFromDB('pending_movements');
        updatePendingCount(pending.length);

        if (pending.length > 0) {
            console.log('Pushing transactions...', pending);
            const response = await fetch(API_URL, {
                method: 'POST',
                // GAS Web App with ContentService supports CORS for text/plain requests.
                headers: {
                    'Content-Type': 'text/plain;charset=utf-8', // Avoid preflight
                },
                body: JSON.stringify({
                    action: 'syncTransactions',
                    transactions: pending,
                    sheetId: currentSheetId
                })
            });

            // With 'no-cors', we can't check response. 
            // If we use standard CORS, we can.
            // Let's assume standard CORS works (it usually does with ContentService).

            const result = await response.json();
            if (result.result === 'success') {
                await clearPendingTransactions(result.processed);
                updatePendingCount(0); // Assuming all synced
                alert('Sincronização realizada com sucesso!');
            } else {
                console.error('Sync error:', result);
                alert('Erro ao sincronizar transações.');
            }
        }

        // 2. Fetch Fresh Data
        const response = await fetch(`${API_URL}?action=getData&obra=${encodeURIComponent(currentConstruction)}&sheetId=${encodeURIComponent(currentSheetId)}`);
        const data = await response.json();

        if (data.result === 'success') {
            await saveToDB('employees', data.data.employees);
            await saveToDB('epis', data.data.epis);
            await saveToDB('stock', data.data.stock);

            loadLocalData(); // Refresh UI
        }

    } catch (err) {
        console.error('Sync failed:', err);
        // alert('Falha na sincronização. Verifique sua conexão.');
    } finally {
        showLoading(false);
    }
}

async function loadLocalData() {
    const employees = await getFromDB('employees');
    const epis = await getFromDB('epis');
    const stock = await getFromDB('stock');
    const pending = await getFromDB('pending_movements');

    updatePendingCount(pending.length);
    populateDropdowns(employees, epis);
    renderStock(stock);
}

// --- UI LOGIC ---

function setupEventListeners() {
    // Tabs
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            currentTab = tab.dataset.tab;
            updateUIForTab();
        });
    });

    // Signature Clear
    document.getElementById('clear-signature').addEventListener('click', () => {
        const canvas = document.getElementById('signature-pad');
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
    });


    // Save current selection
    const empSelect = document.getElementById('colaborador');
    const epiSelect = document.getElementById('epi');

    // Transaction Submit
    document.getElementById('btn-submit').addEventListener('click', handleTransactionSubmit);

    // Force Sync
    document.getElementById('btn-force-sync').addEventListener('click', syncData);
}

function populateDropdowns(employees, epis) {
    const empSelect = document.getElementById('colaborador');
    const epiSelect = document.getElementById('epi');

    // Save current selection
    const currentEmp = empSelect.value;
    const currentEpi = epiSelect.value;

    empSelect.innerHTML = '<option value="">Selecione...</option>';
    employees.forEach(emp => {
        // Adjust property names based on your CSV/Sheet headers
        const name = emp.Nome || emp.NOME || emp.nome;
        const id = emp.ID || emp.id;
        if (name) {
            const option = document.createElement('option');
            option.value = id;
            option.innerText = name;
            empSelect.appendChild(option);
        }
    });

    epiSelect.innerHTML = '<option value="">Selecione...</option>';
    epis.forEach(epi => {
        const name = epi.Descrição || epi.DESCRICAO || epi.descricao || epi.Nome;
        const id = epi.ID || epi.id;
        if (name) {
            const option = document.createElement('option');
            option.value = id;
            option.innerText = name;
            epiSelect.appendChild(option);
        }
    });

    // Restore selection if possible
    empSelect.value = currentEmp;
    epiSelect.value = currentEpi;
}

function renderStock(stock) {
    const list = document.getElementById('stock-list');
    list.innerHTML = '';

    if (stock.length === 0) {
        list.innerHTML = '<p>Estoque vazio ou não carregado.</p>';
        return;
    }

    const ul = document.createElement('ul');
    ul.style.listStyle = 'none';
    ul.style.padding = 0;

    stock.forEach(item => {
        const li = document.createElement('li');
        li.style.padding = '10px';
        li.style.borderBottom = '1px solid #eee';
        li.style.display = 'flex';
        li.style.justifyContent = 'space-between';

        // We need to look up EPI name from ID if stock only has ID
        // For now, assume stock item has ID_EPI and Quantidade
        const id = item.ID_EPI || item.id_epi;
        const qty = item.Quantidade || item.quantidade;

        li.innerHTML = `<span>EPI #${id}</span> <strong>${qty} un</strong>`;
        ul.appendChild(li);
    });

    list.appendChild(ul);
}

async function handleTransactionSubmit() {
    const empId = document.getElementById('colaborador').value;
    const epiId = document.getElementById('epi').value;
    const qty = document.getElementById('qtd').value;
    const canvas = document.getElementById('signature-pad');

    if (!empId || !epiId || !qty) {
        alert('Preencha todos os campos!');
        return;
    }

    // Check signature
    if (isCanvasBlank(canvas)) {
        alert('Assinatura obrigatória!');
        return;
    }

    const signatureData = canvas.toDataURL();

    const transaction = {
        id: Date.now().toString(), // Simple unique ID
        timestamp: new Date().toISOString(),
        userId: 'current_user', // TODO: Implement user login
        employeeId: empId,
        epiId: epiId,
        type: currentTab === 'entrega' ? 'ENTREGA' : 'DEVOLUCAO',
        quantity: parseInt(qty),
        signature: signatureData,
        obra: currentConstruction
    };

    try {
        await addPendingTransaction(transaction);

        // Optimistic UI Update (Optional: update local stock immediately)
        // For now, just clear form and notify

        alert('Transação salva localmente!');

        // Clear form
        document.getElementById('colaborador').value = '';
        document.getElementById('epi').value = '';
        document.getElementById('qtd').value = '1';
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Update pending count
        const pending = await getFromDB('pending_movements');
        updatePendingCount(pending.length);

        // Try sync
        if (navigator.onLine) {
            syncData();
        }

    } catch (err) {
        console.error(err);
        alert('Erro ao salvar transação.');
    }
}

function updatePendingCount(count) {
    document.getElementById('pending-count').innerText = count;
}

function showLoading(show) {
    document.getElementById('loading-overlay').style.display = show ? 'flex' : 'none';
}

// --- SIGNATURE PAD ---

function initSignaturePad() {
    const canvas = document.getElementById('signature-pad');
    const ctx = canvas.getContext('2d');
    let writing = false;

    // Resize canvas to fit container
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;

    // Mouse Events
    canvas.addEventListener('mousedown', startPosition);
    canvas.addEventListener('mouseup', endPosition);
    canvas.addEventListener('mousemove', draw);

    // Touch Events
    canvas.addEventListener('touchstart', (e) => {
        e.preventDefault(); // Prevent scrolling
        startPosition(e.touches[0]);
    });
    canvas.addEventListener('touchend', endPosition);
    canvas.addEventListener('touchmove', (e) => {
        e.preventDefault();
        draw(e.touches[0]);
    });

    function startPosition(e) {
        writing = true;
        draw(e);
    }

    function endPosition() {
        writing = false;
        ctx.beginPath();
    }

    function draw(e) {
        if (!writing) return;

        const rect = canvas.getBoundingClientRect();
        const x = (e.clientX || e.pageX) - rect.left;
        const y = (e.clientY || e.pageY) - rect.top;

        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.strokeStyle = '#000';

        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x, y);
    }
}

function isCanvasBlank(canvas) {
    const context = canvas.getContext('2d');
    const pixelBuffer = new Uint32Array(
        context.getImageData(0, 0, canvas.width, canvas.height).data.buffer
    );
    return !pixelBuffer.some(color => color !== 0);
}

async function handleRegistrationSubmit() {
    const name = document.getElementById('register-name').value;
    const email = document.getElementById('register-email').value;
    const position = document.getElementById('register-position').value;
    const reason = document.getElementById('register-reason').value;

    if (!name || !email || !position) {
        alert('Por favor, preencha todos os campos obrigatórios.');
        return;
    }

    showLoading(true);
    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain;charset=utf-8',
            },
            body: JSON.stringify({
                action: 'requestAccess',
                name: name,
                email: email,
                position: position,
                reason: reason
            })
        });

        const result = await response.json();
        if (result.result === 'success') {
            // SHOW SUCCESS MESSAGE INSTEAD OF ALERT
            document.getElementById('register-form-container').style.display = 'none';
            document.getElementById('register-success').style.display = 'block';
        } else {
            alert('Erro ao enviar solicitação: ' + (result.error || 'Erro desconhecido'));
        }
    } catch (err) {
        console.error(err);
        alert('Erro de conexão ao enviar solicitação.');
    } finally {
        showLoading(false);
    }
}
