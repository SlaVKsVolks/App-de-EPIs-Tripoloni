import { API_URL } from './config.js';
import { initDB, getFromDB, addPendingTransaction } from './db.js';
import * as UI from './ui.js';
import * as API from './api.js';
import * as Wizard from './wizard.js';

// STATE
let currentTab = 'entrega';
let currentConstruction = null;
let currentSheetId = null;
let currentUser = null;
let deferredPrompt;

// --- DASHBOARD LOADER ---
async function loadDashboard() {
    UI.showDashboard();
    try {
        const history = await getFromDB('movements');
        UI.renderRecentMovements(history);
    } catch (e) {
        console.error("Error loading history", e);
    }
}

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
    UI.initSignaturePad();
    try {
        await initDB();
    } catch (e) {
        console.error('DB Init Failed:', e);
        // Continue anyway so UI works (albeit without offline data)
    }

    // Initialize Wizard module
    await Wizard.initWizard();

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

    // Start App Flow
    initAppFlow();

    // Service Worker
    if ('serviceWorker' in navigator) {
        initServiceWorker();
    } else {
        const splash = document.getElementById('splash-screen');
        if (splash) splash.style.display = 'none';
    }

    // Connection Monitoring
    monitorConnectionQuality();

    setupGlobalEventListeners();
});

// --- CONNECTION MONITORING ---
function monitorConnectionQuality() {
    const PING_HISTORY_SIZE = 5;
    const pingHistory = [];
    let lastState = 'unknown';

    const checkNetworkMetrics = async () => {
        const start = Date.now();
        let success = false;
        let latency = 9999;

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2000);

            await fetch('logo-circle.svg?ping=' + Date.now(), {
                method: 'HEAD',
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            latency = Date.now() - start;
            success = true;
        } catch (e) {
            success = false;
        }

        pingHistory.push({ success, latency });
        if (pingHistory.length > PING_HISTORY_SIZE) pingHistory.shift();

        const successPings = pingHistory.filter(p => p.success);
        const loss = pingHistory.length > 0 ? ((pingHistory.length - successPings.length) / pingHistory.length) * 100 : 0;
        const avgLat = successPings.length > 0 ? successPings.reduce((a, b) => a + b.latency, 0) / successPings.length : 9999;

        return { avgLatency: avgLat, packetLoss: loss };
    };

    const determineState = (latency, loss, type, downlink) => {
        if (!navigator.onLine || loss === 100) return 'offline';
        if (loss >= 20 || latency > 1500) return 'poor';
        if (type && ['slow-2g', '2g'].includes(type)) return 'poor';
        if (downlink && downlink < 0.5) return 'poor';
        if (latency > 500 || (downlink && downlink < 2) || (type === '3g')) return 'moderate';
        return 'good';
    };

    const update = async () => {
        let type = null, downlink = null;
        if ('connection' in navigator && navigator.connection) {
            type = navigator.connection.effectiveType;
            downlink = navigator.connection.downlink;
        }

        const { avgLatency, packetLoss } = await checkNetworkMetrics();
        const newState = determineState(avgLatency, packetLoss, type, downlink);

        if (newState !== lastState) {
            console.log(`Net: ${newState} | Lat: ${Math.round(avgLatency)}ms | Loss: ${packetLoss}%`);
            UI.updateConnectionStatus(newState);

            // Sync ONLY if state IMPROVES to good/moderate from poor/offline
            // This prevents the loop where it keeps trying to sync endlessly if sync fails
            if ((newState === 'good' || newState === 'moderate') && (lastState === 'poor' || lastState === 'offline')) {
                sync();
            }
        }
        lastState = newState;
    };

    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    setInterval(update, 4000);
}

// EXPOSE GOOGLE LOGIN HANDLER TO GLOBAL SCOPE via Bridge
window.onGoogleLogin = function (response) {
    try {
        const responsePayload = parseJwt(response.credential);
        const email = responsePayload.email;
        console.log("Google ID: " + responsePayload.sub);
        validateUserEmail(email);
    } catch (e) {
        console.error("Error decoding JWT", e);
        UI.showToast("Erro ao processar login do Google.", "error");
    }
};

// Check for pending login from before main.js loaded
if (window.pendingGoogleLogin) {
    window.onGoogleLogin(window.pendingGoogleLogin);
    window.pendingGoogleLogin = null;
}

function parseJwt(token) {
    var base64Url = token.split('.')[1];
    var base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    var jsonPayload = decodeURIComponent(window.atob(base64).split('').map(function (c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
    return JSON.parse(jsonPayload);
}

// --- LOGIC ---

async function initAppFlow() {
    const loadingDiv = document.getElementById('construction-loading');
    const gridContainer = document.getElementById('construction-grid');
    const selectContainer = document.getElementById('construction-select-container');

    // CHECK PERSISTENT LOGIN
    const savedUser = localStorage.getItem('currentUser');
    const savedSheetId = localStorage.getItem('currentSheetId');
    const savedConstruction = localStorage.getItem('currentConstruction');

    if (savedUser && savedSheetId && savedConstruction) {
        console.log('Found saved session');
        currentUser = JSON.parse(savedUser);
        currentSheetId = savedSheetId;
        currentConstruction = savedConstruction;

        const constructionScreen = document.getElementById('screen-construction');
        if (constructionScreen) {
            constructionScreen.classList.remove('d-flex');
            constructionScreen.classList.add('d-none');
        }
        UI.showDashboard();

        // Force hide splash screen immediately
        const splash = document.getElementById('splash-screen');
        if (splash) splash.style.display = 'none';

        loadLocalData().then(sync);
        return;
    }

    // If no session, fetch constructions
    try {
        UI.showLoading(true); // Maybe localized loading is better, but simpler for now
        const result = await API.fetchConstructions();

        if (result.result === 'success') {
            console.log('Constructions fetched:', result.data); // DEBUG
            gridContainer.innerHTML = '';

            if (result.data.length === 0) {
                gridContainer.innerHTML = '<p class="text-center w-100">Nenhuma obra encontrada na planilha.</p>';
            }

            result.data.forEach(item => {
                // Normalization of keys to handle loose matching
                const getVal = (keys) => {
                    for (let k of keys) if (item[k]) return item[k];
                    // Try case-insensitive
                    const lowerKeys = keys.map(k => k.toLowerCase());
                    for (let k in item) {
                        if (lowerKeys.includes(k.toLowerCase())) return item[k];
                    }
                    return '';
                };

                const name = getVal(['Obra', 'Nome', 'Name', 'construction']);
                const sheetId = getVal(['Sheet ID', 'SheetId', 'ID_Planilha', 'id', 'Id']);
                const number = getVal(['Número', 'Numero', 'Number']);
                const city = getVal(['Cidade', 'City']);

                if (name) {
                    const card = document.createElement('div');
                    card.className = 'construction-card';

                    // Format: "Obra 422 - Paraguaçu Paulista"
                    let headerText = '';
                    if (number || city) {
                        headerText = `Obra ${number}`;
                        if (city) headerText += ` - ${city}`;
                    }

                    card.innerHTML = `
                        <div class="card-header-text">${headerText}</div>
                        <h3 class="card-title-text">${name}</h3>
                    `;

                    if (!sheetId) card.style.border = '1px solid red';

                    card.onclick = () => {
                        if (sheetId) {
                            handleCardSelection(name, sheetId);
                        } else {
                            UI.showToast('Erro: ID da planilha não configurado.', 'error');
                        }
                    };
                    gridContainer.appendChild(card);
                }
            });
            loadingDiv.classList.add('d-none');
            loadingDiv.classList.remove('d-flex');

            selectContainer.classList.remove('d-none');
            selectContainer.classList.add('d-block');
            selectContainer.classList.add('animate-slide-up');
        } else {
            console.error('API Error:', result);
            loadingDiv.innerHTML = `<p style="color: red;">Erro ao carregar obras: ${result.error || 'Erro desconhecido'}</p>`;
        }
    } catch (error) {
        console.error(error);
        loadingDiv.innerHTML = '<p style="color: red;">Erro de conexão.</p>';
    } finally {
        UI.showLoading(false);
    }
}

function handleCardSelection(name, sheetId) {
    console.log(`Selected: ${name} (${sheetId})`); // DEBUG
    currentConstruction = name;
    currentSheetId = sheetId;

    const screenConstruction = document.getElementById('screen-construction');
    const screenLogin = document.getElementById('screen-login');

    if (screenConstruction) {
        screenConstruction.classList.add('d-none');
        screenConstruction.classList.remove('d-flex');
        screenConstruction.style.display = 'none'; // Force hide
    }

    if (screenLogin) {
        screenLogin.classList.remove('d-none');
        screenLogin.classList.add('d-block');
        screenLogin.style.display = 'flex'; // Force show as flex
        screenLogin.classList.add('animate-fade-in');
    }
}

async function validateUserEmail(email) {
    UI.showLoading(true);
    try {
        const result = await API.validateUserEmail(email, currentSheetId);

        if (result.result === 'success') {
            currentUser = result.user;
            localStorage.setItem('currentUser', JSON.stringify(currentUser));
            localStorage.setItem('currentSheetId', currentSheetId);
            localStorage.setItem('currentConstruction', currentConstruction);

            const loginScreen = document.getElementById('screen-login');
            if (loginScreen) {
                loginScreen.classList.remove('d-flex');
                loginScreen.classList.remove('d-block');
                loginScreen.classList.add('d-none');
            }
            loadDashboard();

            // Request Notification Permission on Login
            if ('Notification' in window && Notification.permission === 'default') {
                Notification.requestPermission().then(perm => {
                    console.log('Notification permission:', perm);
                });
            }

            loadLocalData().then(sync);

        } else {
            // Show Registration
            document.getElementById('screen-login').style.display = 'none';
            document.getElementById('screen-register').style.display = 'block';

            const emailInput = document.getElementById('register-email');
            if (emailInput) emailInput.value = email;

            const googleBtnContainer = document.getElementById('register-google-btn-container');
            if (googleBtnContainer) googleBtnContainer.style.display = 'none';
        }
    } catch (err) {
        console.error(err);
        UI.showToast('Erro ao validar usuário.', 'error');
    } finally {
        UI.showLoading(false);
    }
}

async function loadLocalData() {
    const employees = await getFromDB('employees');
    const epis = await getFromDB('epis');
    const stock = await getFromDB('stock');
    const pending = await getFromDB('pending_movements');

    updatePendingCount(pending.length);

    // Capture current selection to preserve it (using new hidden ID fields)
    const currentEmp = document.getElementById('colaborador-id')?.value;
    const currentEpi = document.getElementById('epi-id')?.value;

    UI.populateDropdowns(employees, epis, currentEmp, currentEpi);
    // Stock is now rendered on demand in the 'Estoque' tab via renderEntityList
}

async function sync() {
    if (!navigator.onLine) return;
    try {
        await API.syncData(currentSheetId, currentConstruction, currentUser);
        loadLocalData();
    } catch (e) {
        // Handled in API
    }
}

function updateUIForTab(tabName) {
    // Define title and button text based on transaction type
    let title = 'Lançamento';
    let btnText = 'CONFIRMAR';

    switch (tabName) {
        case 'entrega':
            title = 'Entrega de EPI';
            btnText = 'REGISTRAR ENTREGA';
            break;
        case 'devolucao':
            title = 'Devolução de EPI';
            btnText = 'REGISTRAR DEVOLUÇÃO';
            break;
        case 'compra':
            title = 'Entrada de Compra';
            btnText = 'REGISTRAR COMPRA';
            break;
        case 'ajuste':
            title = 'Ajuste de Estoque';
            btnText = 'REGISTRAR AJUSTE';
            break;
    }

    // Show the transaction form
    const transactionView = document.getElementById('transaction-view');
    if (transactionView) {
        transactionView.classList.remove('d-none');
        transactionView.style.display = 'block';
    }

    // Update form title and button
    const formTitle = document.getElementById('form-title');
    if (formTitle) formTitle.innerText = title;

    const btnSubmit = document.getElementById('btn-submit');
    if (btnSubmit) btnSubmit.innerText = btnText;

    // Resize signature pad after element is visible
    setTimeout(() => {
        UI.resizeSignaturePad();
    }, 50);
}

async function handleTransactionSubmit() {
    // Use the new autocomplete hidden ID fields
    const empId = document.getElementById('colaborador-id')?.value;
    const epiId = document.getElementById('epi-id')?.value;
    const qty = document.getElementById('qtd').value;
    const canvas = document.getElementById('signature-pad');

    // Validate using the UI function which also marks invalid fields
    if (!UI.validateAutocompleteFields()) {
        UI.showToast('Selecione um colaborador e um EPI válidos da lista!', 'warning');
        return;
    }

    if (!qty || parseInt(qty) < 1) {
        UI.showToast('Informe uma quantidade válida!', 'warning');
        return;
    }

    if (UI.isCanvasBlank(canvas)) {
        UI.showToast('Assinatura obrigatória!', 'warning');
        return;
    }

    const transaction = {
        id: Date.now().toString(),
        timestamp: new Date().toISOString(),
        userId: currentUser ? (currentUser.id || currentUser.email) : 'unknown',
        employeeId: empId,
        epiId: epiId,
        type: currentTab === 'entrega' ? 'ENTREGA' : 'DEVOLUCAO',
        quantity: parseInt(qty),
        signature: canvas.toDataURL(),
        obra: currentConstruction,
        sheetId: currentSheetId
    };

    // Fix type case
    if (currentTab === 'entrega') transaction.type = 'ENTREGA';
    if (currentTab === 'devolucao') transaction.type = 'DEVOLUCAO';


    try {
        await addPendingTransaction(transaction);
        UI.showToast('Transação salva localmente!', 'success');

        UI.showDashboard();

        // Clear using the new autocomplete clear function
        UI.clearAutocompleteFields();
        document.getElementById('qtd').value = '1';
        UI.clearSignature();

        const pending = await getFromDB('pending_movements');
        updatePendingCount(pending.length);

        if (navigator.onLine) {
            sync();
        } else {
            // Register Background Sync if supported
            if ('serviceWorker' in navigator && 'SyncManager' in window) {
                try {
                    const sw = await navigator.serviceWorker.ready;
                    await sw.sync.register('sync-transactions');
                    console.log('Background Sync registered: sync-transactions');
                } catch (err) {
                    console.warn('Background Sync registration failed:', err);
                }
            }
        }

    } catch (err) {
        console.error(err);
        UI.showToast('Erro ao salvar transação.', 'error');
    }
}

async function handleRegistrationSubmit() {
    const name = document.getElementById('register-name').value;
    const email = document.getElementById('register-email').value;
    const position = document.getElementById('register-position').value;
    const reason = document.getElementById('register-reason').value;

    if (!name || !email || !position) {
        UI.showToast('Preencha todos os campos.', 'warning');
        return;
    }

    UI.showLoading(true);
    try {
        const result = await API.requestAccess({ name, email, position, reason });
        if (result.result === 'success') {
            document.getElementById('register-form-container').style.display = 'none';
            document.getElementById('register-success').style.display = 'block';
        } else {
            UI.showToast('Erro: ' + result.error, 'error');
        }
    } catch (e) {
        UI.showToast('Erro de conexão.', 'error');
    } finally {
        UI.showLoading(false);
    }
}

function updatePendingCount(count) {
    const el = document.getElementById('pending-count');
    if (el) el.innerText = count;
}

// --- SW INIT ---
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

    if (!navigator.onLine) {
        hideSplash();
        return;
    }

    // Register as Module
    navigator.serviceWorker.register('./sw.js', { type: 'module' }).then(reg => {
        setTimeout(() => { if (splash && !splash.classList.contains('hidden')) hideSplash(); }, 3500);
        if (splashStatus) splashStatus.innerText = 'Verificando atualizações...';

        reg.update().then(() => {
            if (!reg.waiting && !reg.installing) hideSplash();
        });

        reg.onupdatefound = () => {
            const installingWorker = reg.installing;
            if (installingWorker) {
                installingWorker.onstatechange = () => {
                    if (installingWorker.state === 'installed') {
                        if (navigator.serviceWorker.controller) {
                            if (splashStatus) splashStatus.innerText = 'Atualizando aplicação...';
                        } else {
                            hideSplash();
                        }
                    }
                };
            }
        };
    }).catch((err) => {
        console.error('SW Register failed:', err);
        hideSplash();
    });

    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!refreshing) {
            refreshing = true;
            window.location.reload();
        }
    });
}

// --- EVENT LISTENERS (DELEGATION) ---
function setupGlobalEventListeners() {
    // Global Click Delegation
    document.body.addEventListener('click', async (e) => {
        const target = e.target;

        // 1. Menu Toggle
        if (target.closest('#menu-toggle')) {
            UI.toggleMenu(true);
        }
        else if (target.closest('#btn-close-menu') || target.id === ('menu-backdrop')) {
            UI.toggleMenu(false);
        }

        // 2. Dashboard Actions
        else if (target.closest('#btn-new-transaction')) {
            UI.showTransactionSelector();
        }
        else if (target.closest('#btn-cancel-transaction')) {
            UI.hideTransactionSelector();
        }
        else if (target.closest('#btn-cancel-form')) {
            // Go back to transaction type selector
            UI.hideTransactionForm();
            UI.showTransactionSelector();
        }
        else if (target.closest('#btn-back-dashboard')) {
            UI.hideTransactionForm();
            loadDashboard();
        }

        // 3. Transaction Types
        else if (target.closest('.dashboard-card[data-type]')) {
            const card = target.closest('.dashboard-card[data-type]');
            const type = card.dataset.type;
            currentTab = type;

            // Use wizard for entrega and devolucao
            if (type === 'entrega' || type === 'devolucao') {
                Wizard.openWizard(type);
                // Setup finish handler with current context
                const finishBtn = document.getElementById('btn-finish-transaction');
                if (finishBtn) {
                    // Remove old listeners
                    const newBtn = finishBtn.cloneNode(true);
                    finishBtn.parentNode.replaceChild(newBtn, finishBtn);
                    newBtn.addEventListener('click',
                        Wizard.createFinishHandler(currentUser, currentConstruction, currentSheetId, sync)
                    );
                }
            } else {
                // For other types (compra, ajuste), keep using old form for now
                UI.openAppSection(type, updateUIForTab);
            }
            document.getElementById('screen-transaction-type').style.display = 'none';
        }

        // 4. Bottom Navigation
        else if (target.closest('.nav-item')) {
            const navBtn = target.closest('.nav-item');
            const nav = navBtn.dataset.nav;
            UI.updateBottomNav(nav);

            if (nav === 'dashboard') {
                loadDashboard();
            } else {
                try {
                    let dbKey = nav;
                    if (nav === 'funcionarios') dbKey = 'employees';
                    if (nav === 'epis') dbKey = 'epis';
                    if (nav === 'estoque') dbKey = 'stock';

                    const data = await getFromDB(dbKey);
                    UI.renderEntityList(data, nav);
                } catch (e) {
                    console.error("Error loading list", e);
                    UI.showToast("Erro ao carregar dados.", "error");
                }
            }
        }

        // 5. Submit & Clear Sig
        else if (target.closest('#btn-submit')) {
            handleTransactionSubmit();
        }
        else if (target.closest('#clear-signature')) {
            UI.clearSignature();
        }

        // 6. Logout
        else if (target.closest('#btn-logout-menu')) {
            if (confirm('Tem certeza que deseja sair?')) {
                localStorage.clear();
                location.reload();
            }
        }
    });

    // Inputs (Change/Input events)
    const chkTestNet = document.getElementById('chk-test-net');
    if (chkTestNet) {
        chkTestNet.addEventListener('change', (e) => {
            const debugBtn = document.getElementById('btn-debug-net');
            if (debugBtn) debugBtn.style.display = e.target.checked ? 'inline-block' : 'none';
        });
    }
    // Debug Net Button
    const btnDebug = document.getElementById('btn-debug-net');
    if (btnDebug) {
        btnDebug.style.display = 'none';
        btnDebug.addEventListener('click', async () => {
            const start = Date.now();
            let msg = '';
            try {
                await fetch('logo-circle.svg?ping=' + Date.now(), { method: 'HEAD' });
                const latency = Date.now() - start;
                msg = `Status: OK\nLatency: ${latency}ms`;
                if (navigator.connection) {
                    msg += `\nAPI: ${navigator.connection.effectiveType}`;
                }
            } catch (e) {
                console.error(e);
                msg = 'Status: FAILED (Offline?)';
            }
            alert(msg);
        });
    }

    // Registration
    const btnRegister = document.getElementById('btn-submit-registration');
    if (btnRegister) btnRegister.addEventListener('click', handleRegistrationSubmit);

    const btnBackLogin = document.getElementById('btn-back-to-login');
    if (btnBackLogin) {
        btnBackLogin.addEventListener('click', () => {
            document.getElementById('screen-register').style.display = 'none';
            document.getElementById('screen-login').style.display = 'flex';
        });
    }

    const linkRequest = document.getElementById('link-request-access');
    if (linkRequest) {
        linkRequest.addEventListener('click', (e) => {
            e.preventDefault();
            document.getElementById('screen-login').style.display = 'none';
            document.getElementById('screen-register').style.display = 'flex';
        });
    }
}
