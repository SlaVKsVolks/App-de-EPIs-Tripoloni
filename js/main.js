
import { API_URL } from './config.js';
import { initDB, getFromDB, addPendingTransaction } from './db.js';
import * as UI from './ui.js';
import * as API from './api.js';

// STATE
let currentTab = 'entrega';
let currentConstruction = null;
let currentSheetId = null;
let currentUser = null;
let deferredPrompt;

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
    UI.initSignaturePad();
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
    const update = () => {
        if (!navigator.onLine) {
            UI.updateConnectionStatus('offline');
            return;
        }

        // Check for Network Information API support
        if ('connection' in navigator && navigator.connection) {
            const conn = navigator.connection;
            const type = conn.effectiveType; // 'slow-2g', '2g', '3g', '4g'
            const rtt = conn.rtt; // Round-trip time in ms
            const downlink = conn.downlink; // Bandwidth in Mbps

            console.log(`Network Status: Type=${type}, RTT=${rtt}ms, Downlink=${downlink}Mbps`);

            // Debugging for user: Show toast if values are extreme or just on change?
            // Let's show it only when it *changes* to poor to avoid spam, or on every change?
            // For now, let's log to UI so user can see it.
            // UI.showToast(`Net: ${type}, RTT:${rtt}, Down:${downlink}`, 'info');

            // Definitions of POOR connection:
            // 1. Explicitly 'slow-2g' or '2g'
            // 2. High latency (RTT > 500ms)
            // 3. Low bandwidth (Downlink < 1Mbps)
            const isPoor = (type === 'slow-2g' || type === '2g' || rtt > 500 || downlink < 1);

            if (isPoor) {
                // Show toast to confirm detection
                UI.showToast(`Conexão lenta detectada: ${rtt}ms`, 'warning');
                UI.updateConnectionStatus('poor');
            } else {
                UI.updateConnectionStatus('online');
                sync(); // Trigger sync if good connection
            }
        } else {
            // Fallback for browsers without API
            UI.updateConnectionStatus('online');
            sync();
        }
    };

    // Initial check
    update();

    // Listeners
    window.addEventListener('online', update);
    window.addEventListener('offline', update);

    if ('connection' in navigator && navigator.connection) {
        navigator.connection.addEventListener('change', update);
    }

    // Polling fallback (every 2 seconds) to catch DevTools throttling changes
    setInterval(update, 2000);
}

// EXPOSE GOOGLE LOGIN CALLBACK TO GLOBAL SCOPE
window.handleCredentialResponse = function (response) {
    try {
        const responsePayload = parseJwt(response.credential);
        const email = responsePayload.email;
        console.log("Google ID: " + responsePayload.sub);
        console.log("Email: " + responsePayload.email);
        validateUserEmail(email);
    } catch (e) {
        console.error("Error decoding JWT", e);
        UI.showToast("Erro ao processar login do Google.", "error");
    }
};

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

        document.getElementById('screen-construction').style.display = 'none';
        UI.showDashboard();
        loadLocalData().then(sync);
        return;
    }

    // If no session, fetch constructions
    try {
        UI.showLoading(true); // Maybe localized loading is better, but simpler for now
        const result = await API.fetchConstructions();

        if (result.result === 'success') {
            gridContainer.innerHTML = '';
            result.data.forEach(item => {
                const name = item.Obra || item.Nome || item.Name || item.construction;
                const sheetId = item['Sheet ID'] || item.SheetId || item.ID_Planilha || item.id;

                if (name) {
                    const card = document.createElement('div');
                    card.className = 'construction-card';
                    card.innerHTML = `<h3>${name}</h3>`;

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
            loadingDiv.style.display = 'none';
            selectContainer.style.display = 'block';
            selectContainer.classList.add('animate-slide-up');
        } else {
            loadingDiv.innerHTML = '<p style="color: red;">Erro ao carregar obras.</p>';
        }
    } catch (error) {
        console.error(error);
        loadingDiv.innerHTML = '<p style="color: red;">Erro de conexão.</p>';
    } finally {
        UI.showLoading(false);
    }
}

function handleCardSelection(name, sheetId) {
    currentConstruction = name;
    currentSheetId = sheetId;
    document.getElementById('screen-construction').style.display = 'none';
    document.getElementById('screen-login').style.display = 'block';
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

            document.getElementById('screen-login').style.display = 'none';
            UI.showDashboard();
            loadLocalData().then(sync);

        } else {
            // Show Registration
            document.getElementById('screen-login').style.display = 'none';
            document.getElementById('screen-register').style.display = 'block';

            const emailInput = document.getElementById('register-email');
            if (emailInput) emailInput.value = email;

            // Hide Google Button if it was moved
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
    UI.populateDropdowns(employees, epis);
    UI.renderStock(stock);
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

function setupGlobalEventListeners() {
    // Dashboard
    document.getElementById('card-delivery').addEventListener('click', () => {
        currentTab = 'entrega';
        UI.openAppSection('entrega', updateUIForTab);
    });
    document.getElementById('card-return').addEventListener('click', () => {
        currentTab = 'devolucao';
        UI.openAppSection('devolucao', updateUIForTab);
    });
    document.getElementById('card-stock').addEventListener('click', () => {
        currentTab = 'estoque';
        UI.openAppSection('estoque', updateUIForTab);
    });

    document.getElementById('btn-back-dashboard').addEventListener('click', UI.showDashboard);

    document.getElementById('btn-logout').addEventListener('click', () => {
        if (confirm('Tem certeza que deseja sair?')) {
            localStorage.clear();
            location.reload();
        }
    });

    // Form
    document.getElementById('btn-submit').addEventListener('click', handleTransactionSubmit);
    document.getElementById('clear-signature').addEventListener('click', UI.clearSignature);
    document.getElementById('btn-force-sync').addEventListener('click', sync);

    // Debug Net Button
    const btnDebug = document.getElementById('btn-debug-net');
    if (btnDebug) {
        btnDebug.addEventListener('click', () => {
            if (navigator.connection) {
                const { effectiveType, rtt, downlink, saveData } = navigator.connection;
                alert(`Debug:\nType: ${effectiveType}\nRTT: ${rtt}ms\nDownlink: ${downlink}Mbps\nSaveData: ${saveData}`);
            } else {
                alert('Navigator.connection API not supported.');
            }
        });
    }

    // Registration
    const btnRegister = document.getElementById('btn-submit-registration');
    if (btnRegister) btnRegister.addEventListener('click', handleRegistrationSubmit);

    // ... (Back to login logic, similar to original)
    const btnBackLogin = document.getElementById('btn-back-to-login');
    if (btnBackLogin) {
        btnBackLogin.addEventListener('click', () => {
            document.getElementById('screen-register').style.display = 'none';
            document.getElementById('screen-login').style.display = 'flex';
            // Logic to move google button back omitted for brevity but should be here if crucial
        });
    }

    const linkRequest = document.getElementById('link-request-access');
    if (linkRequest) {
        linkRequest.addEventListener('click', (e) => {
            e.preventDefault();
            document.getElementById('screen-login').style.display = 'none';
            document.getElementById('screen-register').style.display = 'flex';
            // Logic to move google button omitted
        });
    }
}

function updateUIForTab(tabName) {
    if (tabName === 'estoque') {
        document.getElementById('transaction-view').style.display = 'none';
        document.getElementById('stock-view').style.display = 'block';
    } else {
        document.getElementById('transaction-view').style.display = 'block';
        document.getElementById('stock-view').style.display = 'none';
        const title = tabName === 'entrega' ? 'Registrar Entrega' : 'Registrar Devolução';
        document.getElementById('form-title').innerText = title;
        document.getElementById('btn-submit').innerText = tabName === 'entrega' ? 'CONFIRMAR ENTREGA' : 'CONFIRMAR DEVOLUÇÃO';
    }
}

async function handleTransactionSubmit() {
    const empId = document.getElementById('colaborador').value;
    const epiId = document.getElementById('epi').value;
    const qty = document.getElementById('qtd').value;
    const canvas = document.getElementById('signature-pad');

    if (!empId || !epiId || !qty) {
        UI.showToast('Preencha todos os campos!', 'warning');
        return;
    }

    if (UI.isCanvasBlank(canvas)) {
        UI.showToast('Assinatura obrigatória!', 'warning');
        return;
    }

    const transaction = {
        id: Date.now().toString(),
        timestamp: new Date().toISOString(),
        userId: currentUser ? currentUser.email : 'unknown',
        employeeId: empId,
        epiId: epiId,
        type: currentTab === 'ENTREGA' ? 'ENTREGA' : (currentTab === 'devolucao' ? 'DEVOLUCAO' : 'ENTREGA'), // Fix case sensitivity
        quantity: parseInt(qty),
        signature: canvas.toDataURL(),
        obra: currentConstruction
    };

    // Fix type case
    if (currentTab === 'entrega') transaction.type = 'ENTREGA';
    if (currentTab === 'devolucao') transaction.type = 'DEVOLUCAO';


    try {
        await addPendingTransaction(transaction);
        UI.showToast('Transação salva localmente!', 'success');

        // Clear
        document.getElementById('colaborador').value = '';
        document.getElementById('epi').value = '';
        document.getElementById('qtd').value = '1';
        UI.clearSignature();

        const pending = await getFromDB('pending_movements');
        updatePendingCount(pending.length);

        if (navigator.onLine) sync();

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

    navigator.serviceWorker.register('./sw.js').then(reg => {
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
    }).catch(() => hideSplash());

    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!refreshing) {
            refreshing = true;
            window.location.reload();
        }
    });
}
