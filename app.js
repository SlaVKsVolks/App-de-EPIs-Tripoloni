/**
 * EPI Manager - App Logic
 * Handles IndexedDB, Sync, UI, and Signature
 */

// CONFIGURATION
// REPLACE THIS URL WITH YOUR DEPLOYED GOOGLE APPS SCRIPT WEB APP URL
const API_URL = 'https://script.google.com/macros/s/AKfycbz9o19FS3ZqrS5CG77fizVXVZAoLxSE7pfA6MC3Yp4Lal76MXQsmGzCP7TL5ynp4tBg9g/exec';
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

    // Register Service Worker with Smart Splash & Force Update
    if ('serviceWorker' in navigator) {
        initServiceWorker();
    } else {
        // Fallback for no SW support
        const splash = document.getElementById('splash-screen');
        if (splash) splash.style.display = 'none';
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
            document.getElementById('screen-login').style.display = 'flex';

            // Move Google Button back to Login Screen
            const loginContainer = document.querySelector('#screen-login > div');
            const googleBtn = document.querySelector('.g_id_signin');
            const googleBtnContainer = document.getElementById('register-google-btn-container');
            const pLink = document.querySelector('#screen-login p:last-child'); // "Não tem acesso?" link

            if (loginContainer && googleBtn && pLink) {
                loginContainer.insertBefore(googleBtn, pLink);
                if (googleBtnContainer) googleBtnContainer.style.display = 'none';
            }
        });
    }

    const linkRequest = document.getElementById('link-request-access');
    if (linkRequest) {
        linkRequest.addEventListener('click', (e) => {
            e.preventDefault();
            document.getElementById('screen-login').style.display = 'none';
            document.getElementById('screen-register').style.display = 'flex';

            // Move Google Button to Registration Screen at Email Field
            const googleBtnContainer = document.getElementById('register-google-btn-container');
            const googleBtn = document.querySelector('.g_id_signin');
            if (googleBtnContainer && googleBtn) {
                googleBtnContainer.appendChild(googleBtn);
                googleBtnContainer.style.display = 'block';
            }
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
    const loadingDiv = document.getElementById('construction-loading');
    const gridContainer = document.getElementById('construction-grid');
    const selectContainer = document.getElementById('construction-select-container');

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

    // If no session, fetch constructions
    try {
        console.log('Fetching constructions from:', API_URL);
        const response = await fetch(`${API_URL}?action=getConstructions`);
        const result = await response.json();
        console.log('Fetch result:', result);

        if (result.result === 'success') {
            gridContainer.innerHTML = ''; // Clear existing

            result.data.forEach(item => {
                console.log('Construction Item:', item); // Debug log

                // Robustly find the Name
                const name = item.Obra || item.Nome || item.Name || item.construction || Object.values(item)[0];

                // Robustly find the Sheet ID
                // Check for various possible column headers
                const sheetId = item['Sheet ID'] || item.SheetId || item.ID_Planilha || item.id || item.ID || item.Planilha || item.SpreadsheetId || item.sheet_id;

                if (name) {
                    const card = document.createElement('div');
                    card.className = 'construction-card';
                    card.innerHTML = `<h3>${name}</h3>`;

                    if (!sheetId) {
                        console.warn('No Sheet ID found for:', name, item);
                        card.style.border = '1px solid red';
                        card.title = 'Erro: ID da planilha não encontrado';
                    }

                    card.onclick = () => {
                        if (sheetId) {
                            handleCardSelection(name, sheetId);
                        } else {
                            alert('Erro: ID da planilha não configurado para esta obra. Verifique a planilha "APP_INICIAL".');
                        }
                    };
                    gridContainer.appendChild(card);
                }
            });

            loadingDiv.style.display = 'none';
            selectContainer.style.display = 'block';
            selectContainer.classList.add('animate-slide-up');

        } else {
            loadingDiv.innerHTML = '<p style="color: red;">Erro ao carregar obras.</p>';
        }
    } catch (error) {
        console.error('Error fetching constructions:', error);
        loadingDiv.innerHTML = '<p style="color: red;">Erro de conexão.</p>';
    }
}

function handleCardSelection(name, sheetId) {
    if (!name) return;

    currentConstruction = name;
    currentSheetId = sheetId;
    console.log('Construction selected:', currentConstruction, 'Sheet ID:', currentSheetId);

    document.getElementById('screen-construction').style.display = 'none';
    document.getElementById('screen-login').style.display = 'block';
}

async function validateUserEmail(email) {
    console.log('validateUserEmail called with email:', email);
    showLoading(true);
    try {
        console.log('Making API request to validate user...');
        const response = await fetch(`${API_URL}?action=validateUser&email=${encodeURIComponent(email)}&sheetId=${encodeURIComponent(currentSheetId)}`);
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

            // Show Registration Screen
            document.getElementById('screen-login').style.display = 'none';
            document.getElementById('screen-register').style.display = 'block';

            const emailInput = document.getElementById('register-email');
            if (emailInput) {
                emailInput.value = email;
            }

            // Hide Google Button if it was moved here
            const googleBtnContainer = document.getElementById('register-google-btn-container');
            if (googleBtnContainer) {
                googleBtnContainer.style.display = 'none';
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
    const statusText = document.getElementById('status-text');
    const switchTrack = document.getElementById('status-switch-track');
    const statusIndicator = document.getElementById('status-indicator');

    const isOnline = navigator.onLine;
    console.log('Connection status:', isOnline ? 'Online' : 'Offline');

    if (isOnline) {
        if (statusText) statusText.innerText = 'Online';
        if (switchTrack) switchTrack.classList.add('online');
        if (statusIndicator) statusIndicator.style.background = 'rgba(40, 167, 69, 0.8)';
    } else {
        if (statusText) statusText.innerText = 'Offline';
        if (switchTrack) switchTrack.classList.remove('online');
        if (statusIndicator) statusIndicator.style.background = 'rgba(220, 53, 69, 0.8)';
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
        let url = `${API_URL}?action=getData&sheetId=${encodeURIComponent(currentSheetId)}`;

        // If NOT Admin, filter by current construction
        // If Admin, fetch ALL data (omit obra param)
        if (!currentUser || currentUser.tipo !== 'Admin') {
            url += `&obra=${encodeURIComponent(currentConstruction)}`;
        } else {
            console.log('Admin user detected: Fetching ALL data (skipping obra filter)');
        }

        const response = await fetch(url);
        const data = await response.json();

        if (data.result === 'success') {
            // NORMALIZE DATA KEYS FOR INDEXEDDB
            // IDB expects 'ID' for employees/epis and 'ID_EPI' for stock

            console.log('Raw Data received:', data.data);

            const normalize = (list, idFieldNames, targetIdField) => {
                return list.map(item => {
                    // Find the first matching key from idFieldNames
                    let foundId = null;
                    for (const key of idFieldNames) {
                        if (item[key]) {
                            foundId = item[key];
                            break;
                        }
                    }

                    // Create new object with normalized key
                    const newItem = { ...item };
                    if (foundId) {
                        newItem[targetIdField] = foundId;
                    }
                    return newItem;
                }).filter(item => {
                    const isValid = item[targetIdField] !== undefined && item[targetIdField] !== null && item[targetIdField] !== '';
                    if (!isValid) {
                        console.warn(`Skipping invalid item (missing ${targetIdField}):`, item);
                    }
                    return isValid;
                });
            };

            const employees = normalize(data.data.employees, ['ID', 'id', 'ID do Funcionário', 'ID Funcionario'], 'ID');
            const epis = normalize(data.data.epis, ['ID', 'id', 'ID do EPI', 'ID EPI', 'ID do Epi'], 'ID');
            const stock = normalize(data.data.stock, ['ID_EPI', 'id_epi', 'ID do EPI', 'ID EPI'], 'ID_EPI');

            console.log('Normalized Employees:', employees);
            console.log('Normalized EPIs:', epis);
            console.log('Normalized Stock:', stock);

            await saveToDB('employees', employees);
            await saveToDB('epis', epis);
            await saveToDB('stock', stock);

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

// --- SERVICE WORKER & SMART SPLASH ---

function initServiceWorker() {
    const splash = document.getElementById('splash-screen');
    const splashStatus = document.getElementById('splash-status');
    let refreshing = false;

    function hideSplash() {
        if (splash && !splash.classList.contains('hidden')) {
            splash.classList.add('hidden');
            setTimeout(() => splash.style.display = 'none', 500);
        }
    }

    // 1. Strict Offline Handling
    if (!navigator.onLine) {
        console.log('Offline detected. Skipping SW update check.');
        hideSplash();
        return;
    }

    // 2. Register SW
    navigator.serviceWorker.register('./sw.js').then(reg => {
        console.log('SW Registered:', reg);

        // 3. Timeout Safety Net (3.5s)
        setTimeout(() => {
            if (splash && !splash.classList.contains('hidden')) {
                console.warn('Splash timeout. Forcing removal.');
                hideSplash();
            }
        }, 3500);

        // 4. Force Update Check
        if (splashStatus) splashStatus.innerText = 'Verificando atualizações...';

        // Check for updates immediately
        reg.update().then(() => {
            console.log('SW update check finished.');
            // If no update found (waiting/installing), hide splash
            if (!reg.waiting && !reg.installing) {
                hideSplash();
            }
        }).catch(err => {
            console.error('SW update failed:', err);
            hideSplash();
        });

        // 5. Handle Updates
        reg.onupdatefound = () => {
            const installingWorker = reg.installing;
            if (installingWorker) {
                installingWorker.onstatechange = () => {
                    if (installingWorker.state === 'installed') {
                        if (navigator.serviceWorker.controller) {
                            // New update available
                            console.log('New content available; please refresh.');
                            if (splashStatus) splashStatus.innerText = 'Atualizando aplicação...';
                            // Splash stays visible until controllerchange reloads page
                        } else {
                            // Content is cached for the first time
                            console.log('Content is cached for use offline.');
                            hideSplash();
                        }
                    }
                };
            }
        };
    }).catch(error => {
        console.error('SW registration failed:', error);
        hideSplash();
    });

    // 6. Controller Change (Reload)
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!refreshing) {
            console.log('Controller changed, reloading...');
            refreshing = true;
            window.location.reload();
        }
    });

    // 7. Visibility Trigger (Resume)
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && navigator.onLine) {
            console.log('App resumed. Checking for updates...');
            navigator.serviceWorker.ready.then(reg => reg.update());
        }
    });
}
