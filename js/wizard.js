/**
 * Transaction Wizard Module
 * Handles the 3-step transaction flow: Employee -> EPI -> Signature
 */

import { getFromDB, addPendingTransaction } from './db.js';
import * as UI from './ui.js';
import * as API from './api.js';

// WIZARD STATE
let wizardState = {
    currentStep: 1,
    transactionType: 'entrega', // entrega, devolucao
    selectedEmployee: null,
    selectedEPI: null,
    quantity: 1
};

// DATA CACHE
let employeesData = [];
let episData = [];
let stockData = [];

// SYNONYMS for intelligent search
const EPI_SYNONYMS = {
    'botina': ['calçado', 'bota', 'sapato', 'calçado de segurança'],
    'bota': ['calçado', 'botina', 'calçado de segurança'],
    'capacete': ['elmo', 'capacete de segurança'],
    'luva': ['luvas', 'proteção das mãos'],
    'óculos': ['oculos', 'proteção ocular', 'viseira'],
    'protetor auricular': ['abafador', 'proteção auditiva', 'plug auricular'],
    'cinto': ['cinto de segurança', 'talabarte'],
    'colete': ['colete refletivo', 'colete refletivo'],
    'máscara': ['mascara', 'respirador', 'proteção respiratória', 'pff2', 'n95'],
    'uniforme': ['farda', 'roupa', 'vestimenta'],
    'avental': ['jaleco', 'epi descartável'],
};

/**
 * Initialize the wizard module
 */
export async function initWizard() {
    await loadData();
    setupWizardEventListeners();
}

/**
 * Load data from IndexedDB
 */
async function loadData() {
    try {
        employeesData = await getFromDB('employees');
        episData = await getFromDB('epis');
        stockData = await getFromDB('stock');
        console.log(`[Wizard] Loaded: ${employeesData.length} employees, ${episData.length} EPIs`);
    } catch (e) {
        console.error('[Wizard] Failed to load data:', e);
    }
}

/**
 * Open the wizard for a specific transaction type
 */
export function openWizard(type) {
    // Reset state
    wizardState = {
        currentStep: 1,
        transactionType: type,
        selectedEmployee: null,
        selectedEPI: null,
        quantity: 1
    };

    // Update title
    const title = document.getElementById('wizard-title');
    if (title) {
        title.textContent = type === 'entrega' ? 'Entrega de EPI' :
            type === 'devolucao' ? 'Devolução de EPI' : 'Lançamento';
    }

    // Hide bottom navigation
    const bottomNav = document.getElementById('bottom-nav');
    if (bottomNav) bottomNav.style.display = 'none';

    // Show wizard screen
    UI.hideAllScreens();
    const wizard = document.getElementById('transaction-wizard');
    if (wizard) {
        wizard.classList.remove('d-none');
        wizard.style.display = 'flex';
    }

    // Go to step 1
    goToStep(1);

    // Reload data in case there were updates
    loadData();
}

/**
 * Close the wizard
 */
export function closeWizard() {
    const wizard = document.getElementById('transaction-wizard');
    if (wizard) {
        wizard.classList.add('d-none');
        wizard.style.display = 'none';
    }

    // Show bottom navigation again
    const bottomNav = document.getElementById('bottom-nav');
    if (bottomNav) bottomNav.style.display = '';

    resetWizard();
}

/**
 * Reset wizard state
 */
function resetWizard() {
    wizardState = {
        currentStep: 1,
        transactionType: 'entrega',
        selectedEmployee: null,
        selectedEPI: null,
        quantity: 1
    };

    // Clear search fields
    const empSearch = document.getElementById('employee-search');
    const epiSearch = document.getElementById('epi-search');
    if (empSearch) empSearch.value = '';
    if (epiSearch) epiSearch.value = '';

    // Hide employee card
    const empCard = document.getElementById('employee-card');
    if (empCard) empCard.classList.add('d-none');

    // Hide EPI card and quantity
    const epiCard = document.getElementById('epi-card');
    const qtySection = document.getElementById('quantity-section');
    if (epiCard) epiCard.classList.add('d-none');
    if (qtySection) qtySection.classList.add('d-none');

    // Reset quantity
    const qtyInput = document.getElementById('epi-quantity');
    if (qtyInput) qtyInput.value = '1';

    // Hide next buttons
    document.querySelectorAll('.btn-wizard-action').forEach(btn => btn.classList.add('d-none'));

    // Hide search results
    document.querySelectorAll('.search-results').forEach(el => el.classList.remove('show'));
}

/**
 * Navigate to a specific step
 */
function goToStep(stepNumber) {
    wizardState.currentStep = stepNumber;

    // Update step indicators
    document.querySelectorAll('.wizard-step').forEach(step => {
        const num = parseInt(step.dataset.step);
        step.classList.remove('active', 'completed');
        if (num < stepNumber) step.classList.add('completed');
        if (num === stepNumber) step.classList.add('active');
    });

    // Update step lines
    const lines = document.querySelectorAll('.wizard-step-line');
    lines.forEach((line, index) => {
        if (index < stepNumber - 1) line.classList.add('completed');
        else line.classList.remove('completed');
    });

    // Show/hide content
    document.querySelectorAll('.wizard-content').forEach(content => {
        content.classList.remove('active');
    });
    const stepContent = document.getElementById(`wizard-step-${stepNumber}`);
    if (stepContent) stepContent.classList.add('active');

    // Step-specific setup
    if (stepNumber === 3) {
        setupSignatureStep();
    }
}

/**
 * Setup the signature step with summary
 */
function setupSignatureStep() {
    // Update summary
    document.getElementById('summary-employee').textContent =
        wizardState.selectedEmployee?.name || '-';
    document.getElementById('summary-epi').textContent =
        wizardState.selectedEPI?.name || '-';
    document.getElementById('summary-qty').textContent =
        wizardState.quantity;

    // Initialize signature pad
    setTimeout(() => {
        initWizardSignaturePad();
    }, 100);
}

/**
 * Initialize signature pad for wizard
 */
let signatureCtx = null;
let isDrawing = false;

function initWizardSignaturePad() {
    const canvas = document.getElementById('wizard-signature-pad');
    if (!canvas) return;

    // Resize canvas
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = Math.max(180, rect.height);

    signatureCtx = canvas.getContext('2d');
    signatureCtx.lineWidth = 2;
    signatureCtx.lineCap = 'round';
    signatureCtx.strokeStyle = '#000';

    // Remove old listeners (if any)
    canvas.replaceWith(canvas.cloneNode(true));
    const newCanvas = document.getElementById('wizard-signature-pad');
    signatureCtx = newCanvas.getContext('2d');
    signatureCtx.lineWidth = 2;
    signatureCtx.lineCap = 'round';
    signatureCtx.strokeStyle = '#000';

    // Add event listeners
    newCanvas.addEventListener('mousedown', startDraw);
    newCanvas.addEventListener('mousemove', draw);
    newCanvas.addEventListener('mouseup', stopDraw);
    newCanvas.addEventListener('mouseleave', stopDraw);

    newCanvas.addEventListener('touchstart', (e) => {
        e.preventDefault();
        const touch = e.touches[0];
        startDraw({ clientX: touch.clientX, clientY: touch.clientY });
    });
    newCanvas.addEventListener('touchmove', (e) => {
        e.preventDefault();
        const touch = e.touches[0];
        draw({ clientX: touch.clientX, clientY: touch.clientY });
    });
    newCanvas.addEventListener('touchend', stopDraw);
}

function startDraw(e) {
    isDrawing = true;
    const canvas = document.getElementById('wizard-signature-pad');
    const rect = canvas.getBoundingClientRect();
    signatureCtx.beginPath();
    signatureCtx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
}

function draw(e) {
    if (!isDrawing) return;
    const canvas = document.getElementById('wizard-signature-pad');
    const rect = canvas.getBoundingClientRect();
    signatureCtx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
    signatureCtx.stroke();
}

function stopDraw() {
    isDrawing = false;
}

function clearWizardSignature() {
    const canvas = document.getElementById('wizard-signature-pad');
    if (canvas && signatureCtx) {
        signatureCtx.clearRect(0, 0, canvas.width, canvas.height);
    }
}

function isSignatureBlank() {
    const canvas = document.getElementById('wizard-signature-pad');
    if (!canvas) return true;
    const ctx = canvas.getContext('2d');
    const pixelBuffer = new Uint32Array(
        ctx.getImageData(0, 0, canvas.width, canvas.height).data.buffer
    );
    return !pixelBuffer.some(color => color !== 0);
}

/**
 * SMART SEARCH - Handles fuzzy/intelligent matching
 */
function smartSearch(query, items, searchFields) {
    if (!query || query.length === 0) return items.slice(0, 15);

    const queryLower = query.toLowerCase().trim();
    const queryWords = queryLower.split(/\s+/).filter(w => w.length > 0);

    // Check for synonym expansion
    let expandedTerms = [queryLower];
    for (const [key, synonyms] of Object.entries(EPI_SYNONYMS)) {
        if (queryLower.includes(key)) {
            expandedTerms = expandedTerms.concat(synonyms);
        }
        // Also check if query matches a synonym
        for (const syn of synonyms) {
            if (queryLower.includes(syn)) {
                expandedTerms.push(key);
                break;
            }
        }
    }

    // Score each item
    const scored = items.map(item => {
        let score = 0;

        for (const field of searchFields) {
            const value = String(item[field] || '').toLowerCase();
            if (!value) continue;

            // Exact match (highest score)
            if (value === queryLower) {
                score += 100;
                continue;
            }

            // Contains full query
            if (value.includes(queryLower)) {
                score += 50;
            }

            // Word-by-word matching (for "Vinicius Bulhoes" matching "Vinicius de Oliveira Bulhoes dos Santos")
            let wordMatches = 0;
            for (const word of queryWords) {
                if (value.includes(word)) {
                    wordMatches++;
                    score += 10;
                }
            }

            // Bonus if all query words match
            if (wordMatches === queryWords.length && queryWords.length > 1) {
                score += 30;
            }

            // Check synonym matches
            for (const term of expandedTerms) {
                if (value.includes(term) && term !== queryLower) {
                    score += 15;
                }
            }
        }

        return { item, score };
    });

    // Filter and sort by score
    return scored
        .filter(s => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 15)
        .map(s => s.item);
}

/**
 * Search employees with smart matching
 */
function searchEmployees(query) {
    const searchFields = ['Nome', 'NOME', 'nome', 'Apelido', 'apelido', 'Matrícula', 'matricula', 'ID', 'id'];
    return smartSearch(query, employeesData, searchFields);
}

/**
 * Search EPIs with smart matching
 */
function searchEPIs(query) {
    const searchFields = ['Descrição', 'DESCRICAO', 'descricao', 'Nome', 'CA', 'ca', 'Código', 'codigo', 'ID', 'id'];
    return smartSearch(query, episData, searchFields);
}

/**
 * Render employee search results
 */
function renderEmployeeResults(employees) {
    const container = document.getElementById('employee-search-results');
    if (!container) return;

    if (employees.length === 0) {
        container.innerHTML = '<div class="search-no-results">Nenhum colaborador encontrado</div>';
        container.classList.add('show');
        return;
    }

    container.innerHTML = employees.map(emp => {
        const name = emp.Nome || emp.NOME || emp.nome || 'Nome';
        const role = emp.Função || emp.funcao || emp.Cargo || emp.cargo || '';
        const id = emp.ID || emp.id;
        const photo = emp.Foto || emp.foto || emp.Photo || '';

        return `
            <div class="search-result-item" data-id="${id}">
                <div class="result-avatar">
                    ${photo ? `<img src="${photo}" alt="">` :
                '<svg viewBox="0 0 24 24" width="24" height="24"><path fill="#999" d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>'}
                </div>
                <div class="result-info">
                    <div class="result-name">${name}</div>
                    <div class="result-extra">${role}</div>
                </div>
            </div>
        `;
    }).join('');

    container.classList.add('show');
}

/**
 * Render EPI search results
 */
function renderEPIResults(epis) {
    const container = document.getElementById('epi-search-results');
    if (!container) return;

    if (epis.length === 0) {
        container.innerHTML = '<div class="search-no-results">Nenhum EPI encontrado</div>';
        container.classList.add('show');
        return;
    }

    container.innerHTML = epis.map(epi => {
        const name = epi.Descrição || epi.DESCRICAO || epi.descricao || epi.Nome || 'EPI';
        const ca = epi.CA || epi.ca || '';
        const id = epi.ID || epi.id;

        // Get stock for this EPI - use string comparison to handle mixed types
        const stockItem = stockData.find(s => {
            const stockEpiId = String(s.ID_EPI || s.id_epi || s['ID do EPI'] || '');
            return stockEpiId === String(id);
        });
        const qty = stockItem ? (stockItem.Quantidade || stockItem.quantidade || stockItem.Qtd || 0) : '?';

        return `
            <div class="search-result-item" data-id="${id}">
                <div class="result-avatar" style="background: #e8f5e9;">
                    🦺
                </div>
                <div class="result-info">
                    <div class="result-name">${name}</div>
                    <div class="result-extra">CA: ${ca || 'N/A'} • Estoque: ${qty}</div>
                </div>
            </div>
        `;
    }).join('');

    container.classList.add('show');
}

/**
 * Select an employee
 */
function selectEmployee(emp) {
    wizardState.selectedEmployee = {
        id: emp.ID || emp.id,
        name: emp.Nome || emp.NOME || emp.nome,
        role: emp.Função || emp.funcao || emp.Cargo || emp.cargo,
        cpf: emp.CPF || emp.cpf,
        matricula: emp.Matrícula || emp.matricula || emp.ID || emp.id,
        admission: emp.Admissão || emp.admissao || emp.Data_Admissão,
        photo: emp.Foto || emp.foto || emp.Photo,
        rawData: emp
    };

    // Update employee card
    document.getElementById('employee-name').textContent = wizardState.selectedEmployee.name;
    document.getElementById('employee-role').textContent = wizardState.selectedEmployee.role || '-';
    document.getElementById('employee-cpf').textContent = wizardState.selectedEmployee.cpf || '-';
    document.getElementById('employee-matricula').textContent = wizardState.selectedEmployee.matricula || '-';

    // Format admission date
    let admDate = wizardState.selectedEmployee.admission;
    if (admDate && admDate instanceof Date) {
        admDate = admDate.toLocaleDateString('pt-BR');
    } else if (admDate) {
        try {
            admDate = new Date(admDate).toLocaleDateString('pt-BR');
            if (admDate === 'Invalid Date') admDate = wizardState.selectedEmployee.admission;
        } catch {
            // Keep original
        }
    }
    document.getElementById('employee-admission').textContent = admDate || '-';

    // Photo
    const photoEl = document.getElementById('employee-photo');
    if (photoEl && wizardState.selectedEmployee.photo) {
        photoEl.innerHTML = `<img src="${wizardState.selectedEmployee.photo}" alt="">`;
    }

    // Show card, hide search results
    document.getElementById('employee-card').classList.remove('d-none');
    document.getElementById('employee-search-results').classList.remove('show');
    document.getElementById('employee-search').value = '';

    // Update hidden field
    document.getElementById('selected-employee-id').value = wizardState.selectedEmployee.id;

    // Show next button
    document.getElementById('btn-step1-next').classList.remove('d-none');
}

/**
 * Select an EPI
 */
function selectEPI(epi) {
    const id = epi.ID || epi.id;

    // Get stock info - use string comparison
    const stockItem = stockData.find(s => {
        const stockEpiId = String(s.ID_EPI || s.id_epi || s['ID do EPI'] || '');
        return stockEpiId === String(id);
    });
    const stockQty = stockItem ? (stockItem.Quantidade || stockItem.quantidade || stockItem.Qtd || 0) : '?';

    wizardState.selectedEPI = {
        id: id,
        name: epi.Descrição || epi.DESCRICAO || epi.descricao || epi.Nome,
        ca: epi.CA || epi.ca,
        stock: stockQty,
        rawData: epi
    };

    // Update EPI card
    document.getElementById('epi-name').textContent = wizardState.selectedEPI.name;
    document.getElementById('epi-ca').textContent = `CA: ${wizardState.selectedEPI.ca || 'N/A'}`;
    document.getElementById('epi-stock').textContent = `Estoque: ${wizardState.selectedEPI.stock}`;

    // Show card and quantity, hide search results
    document.getElementById('epi-card').classList.remove('d-none');
    document.getElementById('quantity-section').classList.remove('d-none');
    document.getElementById('epi-search-results').classList.remove('show');
    document.getElementById('epi-search').value = '';

    // Update hidden field
    document.getElementById('selected-epi-id').value = wizardState.selectedEPI.id;

    // Show next button
    document.getElementById('btn-step2-next').classList.remove('d-none');
}

/**
 * Finish the transaction
 */
async function finishTransaction(currentUser, currentConstruction, currentSheetId, syncCallback) {
    // Validate signature
    if (isSignatureBlank()) {
        UI.showToast('Por favor, assine para confirmar a transação.', 'warning');
        return false;
    }

    const canvas = document.getElementById('wizard-signature-pad');

    const transaction = {
        id: Date.now().toString(),
        timestamp: new Date().toISOString(),
        userId: currentUser ? (currentUser.id || currentUser.email) : 'unknown',
        employeeId: wizardState.selectedEmployee.id,
        epiId: wizardState.selectedEPI.id,
        type: wizardState.transactionType.toUpperCase(),
        quantity: wizardState.quantity,
        signature: canvas.toDataURL(),
        obra: currentConstruction,
        sheetId: currentSheetId
    };

    try {
        await addPendingTransaction(transaction);
        UI.showToast('Transação salva com sucesso!', 'success');

        // Reset and close wizard
        resetWizard();
        closeWizard();
        UI.showDashboard();

        // Sync if online
        if (navigator.onLine && syncCallback) {
            syncCallback();
        }

        return true;
    } catch (err) {
        console.error('[Wizard] Error saving transaction:', err);
        UI.showToast('Erro ao salvar transação.', 'error');
        return false;
    }
}

/**
 * Setup all wizard event listeners
 */
function setupWizardEventListeners() {
    // Back button
    document.getElementById('btn-wizard-back')?.addEventListener('click', () => {
        if (wizardState.currentStep > 1) {
            goToStep(wizardState.currentStep - 1);
        } else {
            closeWizard();
            UI.showTransactionSelector();
        }
    });

    // Employee search
    const empSearch = document.getElementById('employee-search');
    empSearch?.addEventListener('input', (e) => {
        const results = searchEmployees(e.target.value);
        renderEmployeeResults(results);
    });

    empSearch?.addEventListener('focus', () => {
        const results = searchEmployees(empSearch.value);
        renderEmployeeResults(results);
    });

    // Employee result selection
    document.getElementById('employee-search-results')?.addEventListener('click', (e) => {
        const item = e.target.closest('.search-result-item');
        if (item) {
            const id = item.dataset.id;
            const emp = employeesData.find(e => String(e.ID || e.id) === String(id));
            if (emp) selectEmployee(emp);
        }
    });

    // Change employee button
    document.getElementById('btn-change-employee')?.addEventListener('click', () => {
        wizardState.selectedEmployee = null;
        document.getElementById('employee-card').classList.add('d-none');
        document.getElementById('btn-step1-next').classList.add('d-none');
        document.getElementById('employee-search').focus();
    });

    // Step 1 Next
    document.getElementById('btn-step1-next')?.addEventListener('click', () => {
        if (wizardState.selectedEmployee) {
            goToStep(2);
        }
    });

    // EPI search
    const epiSearch = document.getElementById('epi-search');
    epiSearch?.addEventListener('input', (e) => {
        const results = searchEPIs(e.target.value);
        renderEPIResults(results);
    });

    epiSearch?.addEventListener('focus', () => {
        const results = searchEPIs(epiSearch.value);
        renderEPIResults(results);
    });

    // EPI result selection
    document.getElementById('epi-search-results')?.addEventListener('click', (e) => {
        const item = e.target.closest('.search-result-item');
        if (item) {
            const id = item.dataset.id;
            const epi = episData.find(e => String(e.ID || e.id) === String(id));
            if (epi) selectEPI(epi);
        }
    });

    // Change EPI button
    document.getElementById('btn-change-epi')?.addEventListener('click', () => {
        wizardState.selectedEPI = null;
        document.getElementById('epi-card').classList.add('d-none');
        document.getElementById('quantity-section').classList.add('d-none');
        document.getElementById('btn-step2-next').classList.add('d-none');
        document.getElementById('epi-search').focus();
    });

    // Quantity controls
    document.getElementById('btn-qty-minus')?.addEventListener('click', () => {
        const input = document.getElementById('epi-quantity');
        const val = parseInt(input.value) || 1;
        if (val > 1) {
            input.value = val - 1;
            wizardState.quantity = val - 1;
        }
    });

    document.getElementById('btn-qty-plus')?.addEventListener('click', () => {
        const input = document.getElementById('epi-quantity');
        const val = parseInt(input.value) || 1;
        input.value = val + 1;
        wizardState.quantity = val + 1;
    });

    document.getElementById('epi-quantity')?.addEventListener('change', (e) => {
        wizardState.quantity = parseInt(e.target.value) || 1;
    });

    // Step 2 Next
    document.getElementById('btn-step2-next')?.addEventListener('click', () => {
        if (wizardState.selectedEPI) {
            goToStep(3);
        }
    });

    // Clear signature
    document.getElementById('btn-clear-wizard-signature')?.addEventListener('click', clearWizardSignature);

    // Barcode scanner
    document.getElementById('btn-scan-barcode')?.addEventListener('click', openBarcodeScanner);
    document.getElementById('btn-close-scanner')?.addEventListener('click', closeBarcodeScanner);

    // Close search results when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.search-container')) {
            document.querySelectorAll('.search-results').forEach(el => el.classList.remove('show'));
        }
    });
}

// ===== BARCODE SCANNER =====
let barcodeStream = null;

async function openBarcodeScanner() {
    const modal = document.getElementById('barcode-modal');
    const video = document.getElementById('scanner-video');

    if (!modal || !video) return;

    modal.classList.remove('d-none');

    try {
        // Request camera access
        barcodeStream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: 'environment', // Use back camera on mobile
                width: { ideal: 1280 },
                height: { ideal: 720 }
            }
        });

        video.srcObject = barcodeStream;
        await video.play();

        // Start barcode detection
        if ('BarcodeDetector' in window) {
            // Use native BarcodeDetector if available
            const barcodeDetector = new BarcodeDetector({
                formats: ['code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a']
            });

            const detectLoop = async () => {
                if (!barcodeStream) return;

                try {
                    const barcodes = await barcodeDetector.detect(video);
                    if (barcodes.length > 0) {
                        handleBarcodeDetected(barcodes[0].rawValue);
                        return;
                    }
                } catch (e) {
                    console.warn('Barcode detection error:', e);
                }

                requestAnimationFrame(detectLoop);
            };

            detectLoop();
        } else {
            // Fallback: Allow manual input
            UI.showToast('Seu navegador não suporta leitura automática. Digite o código manualmente.', 'info');
            closeBarcodeScanner();
            const epiSearch = document.getElementById('epi-search');
            if (epiSearch) {
                epiSearch.focus();
                epiSearch.placeholder = 'Digite o código de barras...';
            }
        }

    } catch (err) {
        console.error('Camera error:', err);
        UI.showToast('Não foi possível acessar a câmera.', 'error');
        closeBarcodeScanner();
    }
}

function closeBarcodeScanner() {
    const modal = document.getElementById('barcode-modal');
    const video = document.getElementById('scanner-video');

    if (barcodeStream) {
        barcodeStream.getTracks().forEach(track => track.stop());
        barcodeStream = null;
    }

    if (video) {
        video.srcObject = null;
    }

    if (modal) {
        modal.classList.add('d-none');
    }
}

function handleBarcodeDetected(code) {
    console.log('[Scanner] Barcode detected:', code);
    closeBarcodeScanner();

    // Search for EPI with this barcode/code
    const epiSearch = document.getElementById('epi-search');
    if (epiSearch) {
        epiSearch.value = code;
        const results = searchEPIs(code);
        renderEPIResults(results);

        // If only one result, auto-select it
        if (results.length === 1) {
            selectEPI(results[0]);
            UI.showToast(`EPI encontrado: ${results[0].Descrição || results[0].Nome}`, 'success');
        } else if (results.length === 0) {
            UI.showToast('Nenhum EPI encontrado com este código.', 'warning');
        }
    }
}

// Export finish function with context
export function createFinishHandler(currentUser, currentConstruction, currentSheetId, syncCallback) {
    return () => finishTransaction(currentUser, currentConstruction, currentSheetId, syncCallback);
}

// Expose data reload for after sync
export { loadData as reloadWizardData };
