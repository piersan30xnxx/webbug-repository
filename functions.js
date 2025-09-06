// --- General Utility Functions ---
function showModal(modalElement) {
    modalElement.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function hideModal(modalElement) {
    modalElement.classList.remove('active');
    document.body.style.overflow = '';
}

function displayError(element, message) {
    element.textContent = message;
    element.classList.add('show');
}

function hideError(element) {
    element.textContent = '';
    element.classList.remove('show');
}

function displaySuccess(element, message) {
    element.textContent = message;
    element.style.display = 'block';
}

function hideSuccess(element) {
    element.textContent = '';
    element.style.display = 'none';
}

function showAppNotification(message, type = 'danger') {
    appNotification.textContent = message;
    appNotification.style.background = type === 'success' ? 'linear-gradient(135deg, var(--success), #9fe8c7)' : 'linear-gradient(135deg, var(--danger), #ff9a8d)';
    appNotification.classList.add('show');
    setTimeout(() => {
        appNotification.classList.remove('show');
    }, 5000);
}

async function getClientIP() {
    try {
        const response = await fetch('https://api.ipify.org?format=json');
        const data = await response.json();
        return data.ip;
    } catch (error) {
        console.warn('Could not get client IP:', error);
        return 'unknown_ip';
    }
}

function formatFirebaseDate(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleString('id-ID');
}

function validatePhoneNumber(phone) {
    const regex = /^628\d{7,}$/;
    return regex.test(phone);
}

function censorPhoneNumber(phone) {
    if (phone.length < 11) return phone;
    const prefix = phone.substring(0, 5);
    const suffix = phone.substring(phone.length - 2);
    const middleStars = '*'.repeat(phone.length - 5 - 2);
    return `${prefix}${middleStars}${suffix}`;
}

async function sendToTelegram(message) {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    const params = {
        chat_id: CHAT_ID,
        text: message,
        disable_notification: false
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(params)
        });

        const data = await response.json();
        return data.ok;
    } catch (error) {
        console.error('Error sending to Telegram:', error);
        return false;
    }
}

function formatTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}m ${seconds}s`;
}

function createConfetti() {
    const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff', '#8a2be2', '#a29bfe'];

    for (let i = 0; i < 50; i++) {
        const confetti = document.createElement('div');
        confetti.className = 'confetti';
        confetti.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        confetti.style.left = Math.random() * 100 + 'vw';
        confetti.style.width = Math.random() * 10 + 5 + 'px';
        confetti.style.height = Math.random() * 10 + 5 + 'px';
        if (Math.random() > 0.5) {
            confetti.style.borderRadius = '0';
        } else {
            confetti.style.borderRadius = '50%';
        }
        document.body.appendChild(confetti);

        const animationDuration = Math.random() * 3 + 2;
        const animationDelay = Math.random() * 0.5;

        confetti.style.animation = `fall ${animationDuration}s linear ${animationDelay}s forwards`;
        confetti.style.transform = `translateY(-${Math.random() * 20}px) rotate(${Math.random() * 360}deg)`;

        setTimeout(() => {
            confetti.remove();
        }, (animationDuration + animationDelay) * 1000);
    }
}

function getChatRoomId(uid1, uid2) {
    const uids = [uid1, uid2].sort();
    return `${uids[0]}_${uids[1]}`;
}

function resetPaymentUI() {
    amountInput.value = '';
    productNameInput.value = '';
    contactNumberInput.value = '';
    qrisImage.src = '';
    modalAmount.textContent = 'Rp 0';
    modalCountdown.textContent = '10:00';

    if (paymentData.checkInterval) clearInterval(paymentData.checkInterval);
    if (paymentData.countdownInterval) clearInterval(paymentData.countdownInterval);

    paymentData.paymentInProgress = false;
    localStorage.removeItem('paymentData');
}

function generateReceipt(paymentResult) {
    receiptCanvas.width = 280;
    receiptCanvas.height = 400;
    const ctx = receiptCanvas.getContext('2d');

    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, receiptCanvas.width, receiptCanvas.height);

    ctx.fillStyle = '#4361ee';
    ctx.fillRect(0, 0, receiptCanvas.width, 60);

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 16px Poppins';
    ctx.textAlign = 'center';
    ctx.fillText('PAYMENT RECEIPT', receiptCanvas.width / 2, 35);

    ctx.fillStyle = '#000';
    ctx.font = '12px Poppins';
    ctx.textAlign = 'left';
    ctx.fillText(`Transaction: ${paymentData.transactionId}`, 15, 90);
    ctx.fillText(`Product: ${paymentData.productName}`, 15, 110);
    ctx.fillText(`Base Amount: Rp ${(paymentData.amount - paymentData.adminFee).toLocaleString('id-ID')}`, 15, 130); // **PERUBAHAN**
    ctx.fillText(`Admin Fee: Rp ${paymentData.adminFee.toLocaleString('id-ID')}`, 15, 150); // **PERUBAHAN**
    ctx.fillText(`Total Paid: Rp ${paymentData.amount.toLocaleString('id-ID')}`, 15, 170); // **PERUBAHAN**
    ctx.fillText(`Date: ${new Date().toLocaleString('id-ID')}`, 15, 190);

    ctx.font = 'bold 14px Poppins';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#4caf50';
    ctx.fillText('PAYMENT SUCCESS', receiptCanvas.width / 2, 230); // Adjusted Y position due to new lines
}

// **BARU**: Fungsi untuk menghasilkan biaya admin acak
function generateRandomAdminFee() {
    return Math.floor(Math.random() * (ADMIN_FEE_MAX - ADMIN_FEE_MIN + 1)) + ADMIN_FEE_MIN;
}