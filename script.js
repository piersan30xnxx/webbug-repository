document.addEventListener('DOMContentLoaded', function() {
    // Initialize Firebase and assign references
    firebase.initializeApp(firebaseConfig);
    auth = firebase.auth();
    database = firebase.database();
    storage = firebase.storage();
    bugRef = database.ref('sisuryabug');
    usersRef = database.ref('users');
    developerEarningsRef = database.ref('developerEarnings');
    leaderboardRef = database.ref('leaderboard');
    appSettingsRef = database.ref('appSettings');
    userChatsRef = database.ref('userChats');
    maintenanceRef = database.ref('maintenance');

    // --- State Variables (diambil dari config.js) ---
    // Pastikan variabel-variabel ini dideklarasikan di config.js atau di luar scope DOMContentLoaded
    // agar bisa diakses di sini. Dalam contoh ini, mereka sudah dideklarasikan di config.js
    // dan secara otomatis tersedia di sini karena file config.js di-load sebelum script.js

    // --- Auth Functions ---
    async function loginUser() {
        const email = loginEmailInput.value.trim();
        const password = loginPasswordInput.value.trim();
        hideError(loginError);

        const maintenanceSnapshot = await maintenanceRef.once('value');
        const maintenanceData = maintenanceSnapshot.val();
        if (maintenanceData && maintenanceData.status === 'on' && email !== ADMIN_EMAIL) {
            alert('Sistem sedang dalam mode pemeliharaan. Anda tidak bisa login saat ini.');
            return;
        }

        try {
            await auth.signInWithEmailAndPassword(email, password);
        } catch (error) {
            displayError(loginError, `Login Gagal: ${error.message}`);
            console.error("Login Error:", error);
        }
    }

    async function registerUser() {
        const email = registerEmailInput.value.trim();
        const password = registerPasswordInput.value.trim();
        hideError(registerError);

        const maintenanceSnapshot = await maintenanceRef.once('value');
        const maintenanceData = maintenanceSnapshot.val();
        if (maintenanceData && maintenanceData.status === 'on') {
            alert('Sistem sedang dalam mode pemeliharaan. Pendaftaran tidak tersedia saat ini.');
            return;
        }

        if (password.length < 6) {
            displayError(registerError, 'Password minimal 6 karakter.');
            return;
        }

        if (!email.endsWith('@gmail.com')) {
            displayError(registerError, 'Pendaftaran hanya diperbolehkan dengan domain @gmail.com.');
            return;
        }

        const currentIP = await getClientIP();
        const lastRegistrationIP = localStorage.getItem('lastRegistrationIP');
        const lastRegistrationDate = localStorage.getItem('registrationAttemptDate');

        if (lastRegistrationDate === todayDateString && lastRegistrationIP === currentIP) {
            displayError(registerError, 'Anda hanya bisa mendaftar 1 akun per hari dari perangkat ini.');
            return;
        }

        try {
            const userCredential = await auth.createUserWithEmailAndPassword(email, password);
            const user = userCredential.user;

            await usersRef.child(user.uid).set({
                email: user.email,
                dailyBugLimit: DAILY_BUG_LIMIT_INITIAL,
                bugCountToday: 0,
                lastBugResetDate: todayDateString,
                totalTopupAmount: 0,
                registrationDate: firebase.database.ServerValue.TIMESTAMP,
                isBanned: false,
                profilePictureUrl: DEFAULT_PROFILE_PIC
            });

            localStorage.setItem('registrationAttemptDate', todayDateString);
            localStorage.setItem('lastRegistrationIP', currentIP);
            registrationAttemptToday = true;

            alert('Pendaftaran berhasil! Anda akan otomatis login.');

        } catch (error) {
            displayError(registerError, `Daftar Gagal: ${error.message}`);
            console.error("Register Error:", error);
        }
    }

    async function sendPasswordResetEmail() {
        const email = resetEmailInput.value.trim();
        hideError(resetError);
        hideSuccess(resetSuccess);

        if (!email) {
            displayError(resetError, 'Email tidak boleh kosong.');
            return;
        }

        try {
            await auth.sendPasswordResetEmail(email);
            displaySuccess(resetSuccess, 'Link reset password telah dikirim ke email Anda!');
        } catch (error) {
            displayError(resetError, `Gagal mengirim link reset: ${error.message}`);
            console.error("Reset Password Error:", error);
        }
    }

    async function logoutUser() {
        try {
            await auth.signOut();
        } catch (error) {
            console.error("Logout Error:", error);
            alert('Gagal logout. Silakan coba lagi.');
        }
    }

    // Firebase Authentication State Listener
    auth.onAuthStateChanged(async (user) => {
        const maintenanceSnapshot = await maintenanceRef.once('value');
        const maintenanceData = maintenanceSnapshot.val();

        if (maintenanceData && maintenanceData.status === 'on') {
            maintenanceTitle.textContent = maintenanceData.title || "Website dalam Pemeliharaan";
            maintenanceMessage.textContent = maintenanceData.message || "Mohon maaf atas ketidaknyamanannya. Kami sedang melakukan pemeliharaan untuk meningkatkan layanan kami. Silakan coba lagi nanti.";

            if (user && user.email !== ADMIN_EMAIL) {
                showAppNotification('Sistem sedang dalam mode pemeliharaan. Anda akan logout.', 'danger');
                await auth.signOut();
                showModal(maintenanceOverlay);
                return;
            } else if (!user) {
                loginRegisterContainer.style.display = 'none';
                mainAppContainer.style.display = 'none';
                showModal(maintenanceOverlay);
                return;
            }
        } else {
            hideModal(maintenanceOverlay);
        }

        if (user) {
            currentLoggedInUser = user;
            isAdmin = (user.email === ADMIN_EMAIL);

            // Fetch all users data once and cache it for efficiency (for chat contacts, admin panel)
            usersRef.once('value', (snapshot) => {
                snapshot.forEach(child => {
                    allUsersCache[child.key] = { uid: child.key, ...child.val() };
                });
            });

            const userSnapshot = await usersRef.child(user.uid).once('value');
            let userData = userSnapshot.val();

            if (!userData || userData.isBanned) {
                showAppNotification('Akun Anda telah dibanned atau tidak ditemukan. Logout otomatis.', 'danger');
                await auth.signOut();
                return;
            }

            loginRegisterContainer.style.display = 'none';
            mainAppContainer.style.display = 'flex';
            if (isAdmin) {
                showAdminPanelBtn.classList.remove('hidden');
            } else {
                showAdminPanelBtn.classList.add('hidden');
            }

            currentUserDailyLimit = userData.dailyBugLimit || DAILY_BUG_LIMIT_INITIAL;
            bugCountToday = userData.bugCountToday || 0;

            if (userData.lastBugResetDate !== todayDateString) {
                bugCountToday = 0;
                await usersRef.child(user.uid).update({ bugCountToday: 0, lastBugResetDate: todayDateString });
                console.log("Daily bug count reset for", user.email);
            }

            updateLimitInfo();
            checkCooldown();
            checkPersistedPayment();
            loadAppSettings();

            // Listen for real-time changes to the current user's data (especially ban status)
            usersRef.child(user.uid).on('value', (snapshot) => {
                const latestUserData = snapshot.val();
                if (latestUserData) {
                    if (latestUserData.isBanned && !userData.isBanned) {
                        showAppNotification('Akun Anda telah diban oleh Admin. Anda akan logout.', 'danger');
                        auth.signOut();
                    } else if (!latestUserData.isBanned && userData.isBanned) {
                        showAppNotification('Akun Anda telah di-unban oleh Admin.', 'success');
                    }
                    userData = latestUserData;
                    updateLimitInfo();
                }
            });

        } else {
            currentLoggedInUser = null;
            isAdmin = false;
            loginRegisterContainer.style.display = 'flex';
            mainAppContainer.style.display = 'none';
            showAdminPanelBtn.classList.add('hidden');
            localStorage.removeItem('lastBugTime');
            localStorage.removeItem('paymentData');
            [forgotPasswordModal, profileModal, dashboardStatsModal, topupModal,
             paymentFormModal, qrisPaymentModal, receiptModal, chatModal,
             adminPanelModal, successAdModal].forEach(hideModal);
            loadAppSettings();
            // Detach all Firebase listeners when logged out to prevent memory leaks
            usersRef.off();
            bugRef.off();
            userChatsRef.off();
            maintenanceRef.off();
            if (currentChatMessagesListener) {
                currentChatMessagesListener(); // Detach specific chat listener
                currentChatMessagesListener = null;
            }
        }
    });

    // --- Profile Functions ---
    function showProfileModal() {
        if (!currentLoggedInUser) {
            alert('Silakan login terlebih dahulu.');
            return;
        }
        profileEmailDisplay.textContent = currentLoggedInUser.email;
        profilePasswordDisplay.textContent = '********';
        togglePasswordBtn.textContent = 'Show';
        isPasswordVisible = false;
        newPasswordInput.value = '';
        hideError(profileError);
        hideSuccess(profileSuccess);

        usersRef.child(currentLoggedInUser.uid).once('value', (snapshot) => {
            const userData = snapshot.val();
            profilePictureDisplay.src = userData?.profilePictureUrl || DEFAULT_PROFILE_PIC;
        });

        showModal(profileModal);
    }

    function togglePasswordVisibility() {
        if (isPasswordVisible) {
            profilePasswordDisplay.textContent = '********';
            togglePasswordBtn.textContent = 'Hide'; // Changed from 'Show' to 'Hide'
        } else {
            profilePasswordDisplay.textContent = 'Password tidak ditampilkan untuk keamanan.';
            togglePasswordBtn.textContent = 'Show'; // Changed from 'Hide' to 'Show'
        }
        isPasswordVisible = !isPasswordVisible;
    }


    async function uploadProfilePicture(event) {
        const file = event.target.files[0];
        if (!file) return;

        if (!currentLoggedInUser) {
            alert('Silakan login untuk mengunggah foto profil.');
            return;
        }

        const storageRef = storage.ref(`profile_pictures/${currentLoggedInUser.uid}/${file.name}`);
        const uploadTask = storageRef.put(file);

        profileError.textContent = `Mengunggah foto...`;
        profileError.classList.add('show');
        submitBtn.disabled = true; // Disable submit button during upload

        uploadTask.on('state_changed',
            (snapshot) => {
                const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                profileError.textContent = `Mengunggah foto: ${Math.round(progress)}%`;
            },
            (error) => {
                console.error("Upload failed:", error);
                displayError(profileError, `Gagal mengunggah foto: ${error.message}`);
                submitBtn.disabled = false;
            },
            async () => {
                const downloadURL = await uploadTask.snapshot.ref.getDownloadURL();
                await usersRef.child(currentLoggedInUser.uid).update({ profilePictureUrl: downloadURL });
                profilePictureDisplay.src = downloadURL;
                hideError(profileError);
                displaySuccess(profileSuccess, 'Foto profil berhasil diubah!');
                submitBtn.disabled = false;
            }
        );
    }

    async function changeUserPassword() {
        const newPassword = newPasswordInput.value.trim();
        hideError(profileError);
        hideSuccess(profileSuccess);

        if (!newPassword || newPassword.length < 6) {
            displayError(profileError, 'Password baru minimal 6 karakter.');
            return;
        }

        try {
            await currentLoggedInUser.updatePassword(newPassword);
            displaySuccess(profileSuccess, 'Password berhasil diganti!');
            newPasswordInput.value = '';
        } catch (error) {
            displayError(profileError, `Gagal mengganti password: ${error.message}`);
            console.error("Change Password Error:", error);
            if (error.code === 'auth/requires-recent-login') {
                alert('Untuk mengganti password, Anda perlu login ulang karena alasan keamanan.');
                logoutUser();
            }
        }
    }

    // --- Dashboard Functions ---
    async function showDashboardStats() {
        usersRef.once('value', (snapshot) => {
            totalUsersCount.textContent = snapshot.numChildren();
        });

        if (currentLoggedInUser) {
            const userSnapshot = await usersRef.child(currentLoggedInUser.uid).once('value');
            const userData = userSnapshot.val();
            if (userData) {
                userBugLimit.textContent = `${userData.dailyBugLimit || DAILY_BUG_LIMIT_INITIAL} (${(userData.dailyBugLimit || DAILY_BUG_LIMIT_INITIAL) - bugCountToday} tersisa)`;
            } else {
                userBugLimit.textContent = `${DAILY_BUG_LIMIT_INITIAL} (${DAILY_BUG_LIMIT_INITIAL - bugCountToday} tersisa)`;
            }
        } else {
            userBugLimit.textContent = 'N/A (Login dibutuhkan)';
        }

        developerEarningsRef.once('value', (snapshot) => {
            const total = snapshot.val() || 0;
            developerEarningsDisplay.textContent = total.toLocaleString('id-ID');
        });

        leaderboardRef.orderByValue().limitToLast(10).on('value', (snapshot) => {
            leaderboardList.innerHTML = '';
            const topUsers = [];
            snapshot.forEach(childSnapshot => {
                topUsers.push({ email: childSnapshot.key, total: childSnapshot.val() });
            });
            topUsers.sort((a, b) => b.total - a.total);

            topUsers.forEach((user, index) => {
                const listItem = document.createElement('li');
                const [localPart, domainPart] = user.email.split('@');
                const censoredEmail = localPart.substring(0, 2) + '****' + localPart.substring(localPart.length - 1) + '@' + domainPart;

                listItem.textContent = `${index + 1}. ${censoredEmail} - Rp ${user.total.toLocaleString('id-ID')}`;
                leaderboardList.appendChild(listItem);
            });
            if (topUsers.length === 0) {
                const listItem = document.createElement('li');
                listItem.textContent = 'Belum ada data leaderboard.';
                leaderboardList.appendChild(listItem);
            }
        });

        showModal(dashboardStatsModal);
    }

    // --- Top Up Functions ---
    function showTopupModal() {
        if (!currentLoggedInUser) {
            alert('Silakan login terlebih dahulu untuk Top Up Limit.');
            return;
        }
        showModal(topupModal);
    }

    function updateCustomLimitPrice() {
        const amount = parseInt(customLimitAmountInput.value) || 0;
        customLimitPriceDisplay.textContent = (amount * CUSTOM_LIMIT_PRICE_PER_UNIT).toLocaleString('id-ID');
    }

    async function handlePackageTopup(event) {
        const limitToAdd = parseInt(event.target.dataset.limit);
        const price = parseInt(event.target.dataset.price);
        const productName = `Paket ${limitToAdd} Limit`;
        await startPaymentFlow(price, productName, limitToAdd);
    }

    async function handleCustomTopup() {
        const limitToAdd = parseInt(customLimitAmountInput.value) || 0;
        const price = limitToAdd * CUSTOM_LIMIT_PRICE_PER_UNIT;
        const productName = `Custom ${limitToAdd} Limit`;

        if (limitToAdd <= 0) {
            alert('Jumlah limit harus lebih dari 0.');
            return;
        }
        await startPaymentFlow(price, productName, limitToAdd);
    }

    // **PERUBAHAN BESAR di sini untuk menambahkan biaya admin**
    async function startPaymentFlow(baseAmount, productName, limitToAdd) {
        // **BARU**: Generate random admin fee for this transaction
        const adminFee = generateRandomAdminFee(); // Panggil fungsi dari functions.js
        const totalAmount = baseAmount + adminFee;

        paymentData.amount = totalAmount; // Total amount includes admin fee
        paymentData.productName = productName;
        paymentData.contactNumber = currentLoggedInUser.email;
        paymentData.limitToAdd = limitToAdd;
        paymentData.paymentInProgress = true;
        paymentData.adminFee = adminFee; // **BARU**: Simpan biaya admin

        amountInput.value = totalAmount;
        // **PERUBAHAN**: Update tampilan nama produk untuk menyertakan biaya admin
        productNameInput.value = `${productName} + Biaya Admin (Rp ${adminFee.toLocaleString('id-ID')})`;
        contactNumberInput.value = currentLoggedInUser.email;

        hideModal(topupModal);
        showModal(paymentFormModal);
    }

    // **PERUBAHAN BESAR di sini untuk menghitung pendapatan dan leaderboard**
    async function completePaymentSuccess(paidAmount) {
        if (!currentLoggedInUser) return;

        let storedPaymentData = JSON.parse(localStorage.getItem('paymentData'));
        if (!storedPaymentData) {
            console.error("No payment data found to complete transaction.");
            return;
        }

        // **PERUBAHAN**: Dapatkan juga adminFee dari paymentData
        const { amount, limitToAdd, adminFee } = storedPaymentData;

        if (paidAmount !== amount) {
            console.warn("Paid amount does not match expected amount. Review transaction.");
            return;
        }

        const userRef = usersRef.child(currentLoggedInUser.uid);
        await userRef.transaction(currentData => {
            if (currentData) {
                currentData.dailyBugLimit = (currentData.dailyBugLimit || 0) + limitToAdd;
                // **PERUBAHAN**: Hanya jumlah dasar (tanpa biaya admin) yang menambah total topup pengguna
                currentData.totalTopupAmount = (currentData.totalTopupAmount || 0) + (amount - adminFee);
            }
            return currentData;
        });

        // Developer Earnings mendapatkan total penuh (termasuk biaya admin)
        developerEarningsRef.transaction(currentEarnings => {
            return (currentEarnings || 0) + amount;
        });

        // **PERUBAHAN**: Leaderboard hanya menampilkan jumlah dasar (tanpa biaya admin)
        leaderboardRef.child(currentLoggedInUser.email).transaction(currentTopup => {
            return (currentTopup || 0) + (amount - adminFee);
        });

        alert(`Top up ${limitToAdd} limit harian berhasil!`);
        currentUserDailyLimit += limitToAdd;
        updateLimitInfo();

        resetPaymentUI();
    }

    function checkPersistedPayment() {
        const storedPaymentData = localStorage.getItem('paymentData');
        if (storedPaymentData) {
            paymentData = JSON.parse(storedPaymentData);
            if (paymentData.expiredTime) {
                   paymentData.expiredTime = new Date(paymentData.expiredTime);
            }

            if (paymentData.paymentInProgress && currentLoggedInUser && paymentData.qrisImageUrl) {
                showModal(qrisPaymentModal);
                qrisImage.src = paymentData.qrisImageUrl;
                modalAmount.textContent = `Rp ${paymentData.amount.toLocaleString('id-ID')}`;
                startCountdown();
                checkPaymentStatus();
                alert('Pembayaran Anda sebelumnya sedang diproses. Silakan selesaikan pembayaran.');
            } else {
                localStorage.removeItem('paymentData');
                paymentData.paymentInProgress = false;
            }
        }
    }

    // --- QRIS Payment Gateway Functions ---
    paymentForm.addEventListener('submit', (e) => {
        e.preventDefault();
        localStorage.setItem('paymentData', JSON.stringify(paymentData));
        hideModal(paymentFormModal);
        createPayment();
    });

    function createPayment() {
        const url = `${API_BASE_URL}/createpayment?apikey=${API_KEY}&amount=${paymentData.amount}&codeqr=${QR_CODE}`;

        fetch(url)
            .then(res => res.json())
            .then(data => {
                if (data.status) {
                    paymentData.transactionId = data.result.idtransaksi;
                    paymentData.expiredTime = new Date(data.result.expired);
                    paymentData.qrisImageUrl = data.result.imageqris.url;

                    localStorage.setItem('paymentData', JSON.stringify(paymentData));

                    qrisImage.src = paymentData.qrisImageUrl;
                    modalAmount.textContent = `Rp ${paymentData.amount.toLocaleString('id-ID')}`;

                    startCountdown();
                    checkPaymentStatus();
                    showModal(qrisPaymentModal);
                } else {
                    alert(`Gagal membuat pembayaran: ${data.message || 'Unknown error'}`);
                    resetPaymentUI();
                    hideModal(qrisPaymentModal);
                }
            })
            .catch(error => {
                console.error('Error creating payment:', error);
                alert('Terjadi kesalahan saat membuat pembayaran. Silakan coba lagi.');
                resetPaymentUI();
                hideModal(qrisPaymentModal);
            });
    }

    function checkPaymentStatus() {
        if (paymentData.checkInterval) {
            clearInterval(paymentData.checkInterval);
        }

        paymentData.checkInterval = setInterval(() => {
            if (!paymentData.transactionId) {
                console.warn("Transaction ID not available for status check. Stopping check.");
                clearInterval(paymentData.checkInterval);
                return;
            }

            const url = `${API_BASE_URL}/cekstatus?apikey=${API_KEY}&merchant=${MERCHANT_ID}&keyorkut=${KEY_ORKUT}`;

            fetch(url)
                .then(res => res.json())
                .then(data => {
                    if (data.status && data.result && parseInt(data.result.amount) === paymentData.amount) {
                        clearInterval(paymentData.checkInterval);
                        hideModal(qrisPaymentModal);
                        generateReceipt(data.result); // Menggunakan fungsi generateReceipt dari functions.js
                        showModal(receiptModal);
                        completePaymentSuccess(parseInt(data.result.amount));
                    } else if (data.status === false && data.message && data.message.includes("expired")) {
                        clearInterval(paymentData.checkInterval);
                        alert('Pembayaran telah kadaluarsa.');
                        resetPaymentUI();
                        hideModal(qrisPaymentModal);
                    }
                })
                .catch(error => {
                    console.error('Error checking payment status:', error);
                });
        }, 5000);
    }

    function startCountdown() {
        if (paymentData.countdownInterval) {
            clearInterval(paymentData.countdownInterval);
        }

        const update = () => {
            const now = new Date();
            const diff = paymentData.expiredTime - now;

            if (diff <= 0) {
                modalCountdown.textContent = 'Expired';
                clearInterval(paymentData.countdownInterval);
                return;
            }

            const mins = Math.floor(diff / 60000);
            const secs = Math.floor((diff % 60000) / 1000);
            modalCountdown.textContent = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
        };

        update();
        paymentData.countdownInterval = setInterval(update, 1000);
    }

    shareReceiptBtn.addEventListener('click', shareReceiptToTelegram);
    function shareReceiptToTelegram() {
        receiptCanvas.toBlob(blob => {
            const formData = new FormData();
            formData.append('photo', blob, 'receipt.png');
            formData.append('chat_id', TELEGRAM_CHAT_ID_QRIS);
            // **PERUBAHAN**: Menambahkan biaya admin ke pesan Telegram
            formData.append('caption', `Ada Transaksi Masuk Ni\nAmount: Rp ${paymentData.amount.toLocaleString('id-ID')}\nProduct: ${paymentData.productName}\nContact: ${paymentData.contactNumber}\nBiaya Admin: Rp ${paymentData.adminFee.toLocaleString('id-ID')}`);

            fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN_QRIS}/sendPhoto`, {
                method: 'POST',
                body: formData
            })
                .then(() => alert('Struk berhasil dikirim ke Telegram!'))
                .catch(() => alert('Gagal mengirim struk ke Telegram.'));
        });
    }

    cancelPaymentModalBtn.addEventListener('click', () => {
        clearInterval(paymentData.checkInterval);
        hideModal(qrisPaymentModal);
        resetPaymentUI();
        alert('Pembayaran dibatalkan.');
    });

    // --- Bug Report Functions ---
    function loadBugHistory() {
        bugRef.orderByChild('timestamp').limitToLast(50).on('value', (snapshot) => {
            bugHistory = [];
            snapshot.forEach((childSnapshot) => {
                const bugData = childSnapshot.val();
                bugHistory.unshift({
                    phone: bugData.phone,
                    time: formatFirebaseDate(bugData.timestamp),
                    type: bugData.bugType.replace('.', ''),
                    timestamp: bugData.timestamp
                });
            });
            updateBugTable();
        });
    }

    async function submitBug() {
        if (!currentLoggedInUser) {
            alert('Silakan login terlebih dahulu untuk melaporkan bug.');
            return;
        }

        const phone = phoneInput.value.trim();
        const bugType = bugTypeSelect.value;

        if (!validatePhoneNumber(phone)) {
            displayError(phoneError, 'Nomor harus dimulai dengan 628 dan minimal 7 digit setelahnya.');
            return;
        } else {
            hideError(phoneError);
        }

        if (lastBugTime && Date.now() - lastBugTime < COOLDOWN_TIME) {
            alert(`Anda harus menunggu ${formatTime(COOLDOWN_TIME - (Date.now() - lastBugTime))} sebelum bisa bug lagi.`);
            return;
        }

        const userSnapshot = await usersRef.child(currentLoggedInUser.uid).once('value');
        const userData = userSnapshot.val();

        if (userData.isBanned) {
            alert('Akun Anda telah dibanned. Anda tidak dapat mengirim bug.');
            return;
        }

        const currentBugCount = userData.bugCountToday || 0;
        const currentDailyLimit = userData.dailyBugLimit || DAILY_BUG_LIMIT_INITIAL;

        if (currentBugCount >= currentDailyLimit) {
            alert(`Anda sudah mencapai limit harian (${currentDailyLimit}x). Silakan top up atau coba lagi besok.`);
            return;
        }

        submitBtn.disabled = true;
        loader.style.display = 'block';

        const message = `${bugType} ${phone}`;
        const success = await sendToTelegram(message);

        if (success) {
            const timestamp = Date.now();
            const newBugRef = bugRef.push();
            await newBugRef.set({
                phone: phone,
                bugType: bugType,
                timestamp: timestamp,
                userId: currentLoggedInUser.uid,
                userEmail: currentLoggedInUser.email
            });

            lastBugTime = timestamp;
            localStorage.setItem('lastBugTime', lastBugTime.toString());

            const userRef = usersRef.child(currentLoggedInUser.uid);
            await userRef.transaction(currentData => {
                if (currentData) {
                    currentData.bugCountToday = (currentData.bugCountToday || 0) + 1;
                }
                return currentData;
            });

            bugCountToday++;
            updateLimitInfo();

            checkCooldown();
            showSuccessAdFloating();
            createConfetti();
            phoneInput.value = '';
        } else {
            alert('Gagal mengirim bug. Silakan coba lagi.');
        }

        loader.style.display = 'none';
        updateLimitInfo();
    }

    function showSuccessAdFloating() {
        successAdModal.classList.add('show');
        let timeLeft = AD_CLOSE_TIME;

        const timer = setInterval(() => {
            timeLeft--;
            closeTimerDisplay.textContent = timeLeft;

            if (timeLeft <= 0) {
                clearInterval(timer);
                closeAdFloating();
            }
        }, 1000);
    }

    function closeAdFloating() {
        successAdModal.classList.remove('show');
    }

    function joinChannel() {
        window.open(WA_CHANNEL_URL, '_blank');
    }

    function checkCooldown() {
        if (!lastBugTime) {
            timerDisplay.style.display = 'none';
            return;
        }

        const timePassed = Date.now() - lastBugTime;
        const cooldownLeft = COOLDOWN_TIME - timePassed;

        if (cooldownLeft > 0) {
            timerDisplay.textContent = `Tunggu ${formatTime(cooldownLeft)} sebelum bisa bug lagi`;
            timerDisplay.style.display = 'block';
            submitBtn.disabled = true;

            const timer = setInterval(() => {
                const newTimePassed = Date.now() - lastBugTime;
                const newCooldownLeft = COOLDOWN_TIME - newTimePassed;

                if (newCooldownLeft <= 0) {
                    clearInterval(timer);
                    timerDisplay.style.display = 'none';
                    updateLimitInfo();
                } else {
                    timerDisplay.textContent = `Tunggu ${formatTime(newCooldownLeft)} sebelum bisa bug lagi`;
                }
            }, 1000);
        } else {
            timerDisplay.style.display = 'none';
            updateLimitInfo();
        }
    }

    async function updateLimitInfo() {
        if (currentLoggedInUser) {
            const userSnapshot = await usersRef.child(currentLoggedInUser.uid).once('value');
            const userData = userSnapshot.val();

            if (userData) {
                currentUserDailyLimit = userData.dailyBugLimit || DAILY_BUG_LIMIT_INITIAL;
                bugCountToday = userData.bugCountToday || 0;

                limitInfo.textContent = `Limit harian Anda: ${bugCountToday}/${currentUserDailyLimit} (${currentUserDailyLimit - bugCountToday} tersisa)`;

                if (bugCountToday >= currentUserDailyLimit || userData.isBanned) {
                    submitBtn.disabled = true;
                    if (userData.isBanned) {
                        timerDisplay.textContent = 'Akun Anda telah diban. Tidak bisa mengirim bug.';
                    } else {
                        timerDisplay.textContent = 'Limit harian Anda sudah habis. Silakan top up atau coba lagi besok.';
                    }
                    timerDisplay.style.display = 'block';
                    timerDisplay.style.color = 'var(--danger)';
                } else if (!(lastBugTime && Date.now() - lastBugTime < COOLDOWN_TIME)) {
                    submitBtn.disabled = false;
                    timerDisplay.style.display = 'none';
                    timerDisplay.style.color = 'var(--warning)';
                }

            } else {
                limitInfo.textContent = 'Limit harian tidak ditemukan. Silakan refresh atau hubungi admin.';
                submitBtn.disabled = true;
            }
        } else {
            limitInfo.textContent = 'Login untuk melihat limit harian Anda.';
            submitBtn.disabled = true;
        }
    }

    function updateBugTable() {
        bugTableBody.innerHTML = '';

        if (bugHistory.length === 0) {
            const row = document.createElement('tr');
            row.innerHTML = '<td colspan="3" style="text-align: center;">Belum ada nomor yang dibug</td>';
            bugTableBody.appendChild(row);
            return;
        }

        bugHistory.forEach(item => {
            const row = document.createElement('tr');

            const phoneCell = document.createElement('td');
            phoneCell.textContent = censorPhoneNumber(item.phone);
            phoneCell.title = item.phone;

            const timeCell = document.createElement('td');
            timeCell.textContent = item.time;

            const typeCell = document.createElement('td');
            typeCell.textContent = item.type;
            typeCell.classList.add(`type-${item.type.toLowerCase().replace(' ', '')}`);

            row.appendChild(phoneCell);
            row.appendChild(timeCell);
            row.appendChild(typeCell);

            bugTableBody.appendChild(row);
        });
    }

    // --- Live Chat Functions (Private Chat) ---

    async function showChatModal() {
        if (!currentLoggedInUser) {
            alert('Silakan login untuk memulai chat.');
            return;
        }
        showModal(chatModal);

        const myProfile = allUsersCache[currentLoggedInUser.uid];
        myChatProfilePic.src = myProfile?.profilePictureUrl || DEFAULT_PROFILE_PIC;
        myChatName.textContent = isAdmin ? 'Admin' : myProfile.email.split('@')[0];
        myChatEmail.textContent = myProfile.email;

        if (isAdmin) {
            chatSidebar.classList.remove('hidden');
            chatMain.classList.remove('active');
            chatMessages.innerHTML = '<div style="text-align: center; padding: 20px; color: rgba(255,255,255,0.5);">Pilih kontak dari daftar di samping.</div>';
            chatContactSearch.value = '';
            loadChatContactsAdmin();
        } else {
            chatSidebar.classList.add('hidden');
            chatMain.classList.add('active');
            currentChatTargetUid = await getAdminUid();
            currentChatTargetEmail = ADMIN_EMAIL;
            const adminProfile = allUsersCache[currentChatTargetUid];
            currentChatTargetProfilePic = adminProfile?.profilePictureUrl || DEFAULT_PROFILE_PIC;
            currentChatTargetName.textContent = 'Admin';
            currentChatTargetStatus.textContent = 'Online';
            currentChatTargetPic.src = currentChatTargetProfilePic;
            loadChatMessages();
        }
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    async function startUserChatFlow() {
        if (!currentLoggedInUser) {
            alert('Silakan login untuk memulai chat.');
            return;
        }
        if (isAdmin) {
            alert('Admin tidak bisa memulai chat pengguna lain melalui tombol ini. Gunakan panel admin untuk chat pengguna.');
            return;
        }

        let targetEmail = prompt('Masukkan email pengguna yang ingin Anda chat (@gmail.com):');
        if (!targetEmail) return;
        targetEmail = targetEmail.trim();

        if (!targetEmail.endsWith('@gmail.com') || targetEmail.length < 10) {
            alert('Email tidak valid atau bukan @gmail.com.');
            return;
        }
        if (targetEmail === currentLoggedInUser.email) {
            alert('Anda tidak bisa chat dengan diri sendiri.');
            return;
        }
        if (targetEmail === ADMIN_EMAIL) {
            showChatModal();
            return;
        }

        let targetUid = null;
        for (const uid in allUsersCache) {
            if (allUsersCache[uid].email === targetEmail) {
                targetUid = uid;
                break;
            }
        }

        if (!targetUid) {
            alert('Pengguna dengan email tersebut tidak ditemukan atau belum mendaftar.');
            return;
        }

        showModal(chatModal);
        chatSidebar.classList.add('hidden');
        chatMain.classList.add('active');

        openSpecificChat(targetUid, targetEmail, allUsersCache[targetUid]?.profilePictureUrl || DEFAULT_PROFILE_PIC);
    }

    async function getAdminUid() {
        if (adminUid) return adminUid;
        const adminSnapshot = await usersRef.orderByChild('email').equalTo(ADMIN_EMAIL).once('value');
        if (adminSnapshot.exists()) {
            adminUid = Object.keys(adminSnapshot.val())[0];
            return adminUid;
        }
        console.error("Admin user not found in database!");
        return null;
    }


    async function loadChatContactsAdmin() {
        chatContactList.innerHTML = '<div style="text-align: center; padding: 20px; color: rgba(255,255,255,0.5);">Memuat kontak...</div>';

        if (typeof chatContactsAdminListener === 'function') {
            chatContactsAdminListener();
        }

        chatContactsAdminListener = usersRef.on('value', (snapshot) => {
            const contacts = [];
            snapshot.forEach(userChild => {
                const user = { uid: userChild.key, ...userChild.val() };
                if (user.uid === currentLoggedInUser.uid) return;

                const chatRoomId = getChatRoomId(currentLoggedInUser.uid, user.uid);
                userChatsRef.child(chatRoomId).child('messages').orderByChild('timestamp').limitToLast(1).once('value', (msgSnapshot) => {
                    if (msgSnapshot.exists()) {
                        const lastMsg = msgSnapshot.val()[Object.keys(msgSnapshot.val())[0]];
                        user.lastMessage = lastMsg.text || (lastMsg.imageUrl ? 'Gambar' : (lastMsg.audioUrl ? 'Pesan Suara' : ''));
                        user.lastMessageTimestamp = lastMsg.timestamp;
                    } else {
                        user.lastMessage = '';
                        user.lastMessageTimestamp = 0;
                    }
                    contacts.push(user);
                    renderChatContactList(contacts);
                });
            });
             if (snapshot.numChildren() === 1 && snapshot.child(currentLoggedInUser.uid).exists()) {
                chatContactList.innerHTML = '<div style="text-align: center; padding: 20px; color: rgba(255,255,255,0.5);">Tidak ada pengguna lain yang terdaftar.</div>';
            }
        });
    }

    function renderChatContactList(contacts) {
        chatContactList.innerHTML = '';
        const searchTerm = chatContactSearch.value.toLowerCase().trim();

        contacts.sort((a, b) => (b.lastMessageTimestamp || 0) - (a.lastMessageTimestamp || 0));

        contacts.forEach(contact => {
            if (searchTerm && !contact.email.toLowerCase().includes(searchTerm) && !contact.lastMessage.toLowerCase().includes(searchTerm)) return;

            const item = document.createElement('div');
            item.classList.add('chat-contact-item');
            if (currentChatTargetUid === contact.uid) {
                item.classList.add('active');
            }
            item.dataset.uid = contact.uid;
            item.dataset.email = contact.email;
            item.dataset.profilePic = contact.profilePictureUrl;
            item.innerHTML = `
                <img src="${contact.profilePictureUrl || DEFAULT_PROFILE_PIC}" alt="PP" class="chat-contact-pic">
                <div class="chat-contact-info">
                    <div class="chat-contact-name">${contact.email.split('@')[0]}</div>
                    <div class="chat-contact-email">${contact.lastMessage || 'Ketuk untuk chat'}</div>
                </div>
                `;
            item.addEventListener('click', () => openSpecificChat(contact.uid, contact.email, contact.profilePictureUrl || DEFAULT_PROFILE_PIC));
            chatContactList.appendChild(item);
        });
    }

    async function openSpecificChat(targetUid, targetEmail, targetProfilePic) {
        currentChatTargetUid = targetUid;
        currentChatTargetEmail = targetEmail;
        currentChatTargetProfilePic = targetProfilePic;

        currentChatTargetName.textContent = targetEmail.split('@')[0];
        currentChatTargetStatus.textContent = 'Online';
        currentChatTargetPic.src = targetProfilePic;

        chatMain.classList.add('active');
        if (window.innerWidth <= 768) {
            chatSidebar.classList.add('hidden');
        }

        document.querySelectorAll('.chat-contact-item').forEach(item => item.classList.remove('active'));
        const activeContactItem = document.querySelector(`.chat-contact-item[data-uid="${targetUid}"]`);
        if (activeContactItem) activeContactItem.classList.add('active');


        loadChatMessages();
    }

    chatBackButton.addEventListener('click', () => {
        chatMain.classList.remove('active');
        chatSidebar.classList.remove('hidden');
        currentChatTargetUid = null;
        currentChatTargetEmail = null;
        chatMessages.innerHTML = '<div style="text-align: center; padding: 20px; color: rgba(255,255,255,0.5);">Pilih kontak untuk memulai chat.</div>';
        if (currentChatMessagesListener) {
            currentChatMessagesListener();
            currentChatMessagesListener = null;
        }
    });

    async function loadChatMessages() {
        chatMessages.innerHTML = '<div style="text-align: center; padding: 20px; color: rgba(255,255,255,0.5);">Memuat pesan...</div>';
        if (!currentChatTargetUid) {
            chatMessages.innerHTML = '<div style="text-align: center; padding: 20px; color: rgba(255,255,255,0.5);">Pilih kontak untuk memulai chat.</div>';
            return;
        }
        if (!currentLoggedInUser || !currentLoggedInUser.uid) {
            console.error("User not logged in while trying to load chat messages.");
            return;
        }

        const chatRoomId = getChatRoomId(currentLoggedInUser.uid, currentChatTargetUid);
        const chatMessagesRef = userChatsRef.child(chatRoomId).child('messages');

        if (currentChatMessagesListener) {
            currentChatMessagesListener();
            currentChatMessagesListener = null;
        }

        currentChatMessagesListener = chatMessagesRef.orderByChild('timestamp').on('value', (snapshot) => {
            chatMessages.innerHTML = '';
            if (!snapshot.exists()) {
                chatMessages.innerHTML = '<div style="text-align: center; padding: 20px; color: rgba(255,255,255,0.5);">Belum ada pesan di sini. Mari mulai percakapan!</div>';
                return;
            }
            snapshot.forEach((childSnapshot) => {
                const msgData = childSnapshot.val();
                const messageId = childSnapshot.key;
                processChatMessage(msgData, messageId);
            });
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }, (error) => {
            console.error("Error loading chat messages:", error);
            chatMessages.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--danger);">Gagal memuat pesan.</div>';
        });
    }


    async function processChatMessage(msgData, messageId) {
        const messageElement = document.createElement('div');
        messageElement.classList.add('message');
        messageElement.dataset.messageId = messageId;
        messageElement.classList.add(msgData.senderId === currentLoggedInUser.uid ? 'sent' : 'received');

        let senderName;
        let profilePicUrl;

        const senderData = allUsersCache[msgData.senderId];
        if (senderData) {
            senderName = senderData.email.split('@')[0];
            profilePicUrl = senderData.profilePictureUrl || DEFAULT_PROFILE_PIC;
            if (senderData.email === ADMIN_EMAIL) {
                senderName = "Admin";
            } else if (msgData.senderId === currentLoggedInUser.uid) {
                senderName = "Anda";
            }
        } else {
            senderName = msgData.senderEmail.split('@')[0];
            profilePicUrl = DEFAULT_PROFILE_PIC;
        }

        let mediaContent = '';
        if (msgData.imageUrl) {
            mediaContent = `<div class="message-media"><img src="${msgData.imageUrl}" alt="Image" loading="lazy"></div>`;
        } else if (msgData.audioUrl) {
            mediaContent = `<div class="message-media"><audio controls src="${msgData.audioUrl}"></audio></div>`;
        }

        messageElement.innerHTML = `
            <div class="message-header">
                <img src="${profilePicUrl}" alt="PP" class="message-profile-pic">
                <span class="message-sender-name">${senderName}</span>
            </div>
            <div class="message-content">
                ${msgData.text ? `<div>${msgData.text}</div>` : ''}
                ${mediaContent}
            </div>
            <div class="message-info">${new Date(msgData.timestamp).toLocaleString('id-ID')}</div>
            <div class="message-dropdown"><i class="fas fa-ellipsis-v"></i>
                <div class="message-dropdown-content">
                    <button data-action="delete-for-me">Hapus Untuk Saya</button>
                    ${(msgData.senderId === currentLoggedInUser.uid || isAdmin) ? `<button data-action="delete-for-everyone">Hapus Untuk Semua</button>` : ''}
                </div>
            </div>
        `;

        chatMessages.appendChild(messageElement);

        const dropdownBtn = messageElement.querySelector('.message-dropdown');
        const dropdownContent = messageElement.querySelector('.message-dropdown-content');
        if (dropdownBtn) {
            dropdownBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                document.querySelectorAll('.message-dropdown-content.active').forEach(openDropdown => {
                    if (openDropdown !== dropdownContent) {
                        openDropdown.classList.remove('active');
                    }
                });
                dropdownContent.classList.toggle('active');
            });
            document.addEventListener('click', (e) => {
                if (!dropdownBtn.contains(e.target)) {
                    dropdownContent.classList.remove('active');
                }
            });
        }
        messageElement.querySelectorAll('.message-dropdown-content button').forEach(btn => {
            btn.addEventListener('click', () => handleDeleteMessage(messageId, btn.dataset.action));
        });
    }

    async function handleDeleteMessage(messageId, action) {
        if (!currentLoggedInUser || !currentChatTargetUid) return;

        const chatRoomId = getChatRoomId(currentLoggedInUser.uid, currentChatTargetUid);
        const messageRef = userChatsRef.child(chatRoomId).child('messages').child(messageId);
        const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);

        if (action === 'delete-for-me') {
            if (messageElement) messageElement.remove();
            showAppNotification('Pesan dihapus untuk Anda. (Perubahan ini bersifat lokal untuk saat ini)', 'success');
        } else if (action === 'delete-for-everyone') {
            if (confirm('Anda yakin ingin menghapus pesan ini untuk SEMUA ORANG? Ini tidak bisa dibatalkan!')) {
                try {
                    await messageRef.remove();
                    if (messageElement) messageElement.remove();
                    showAppNotification('Pesan berhasil dihapus untuk semua orang.', 'success');
                } catch (error) {
                    console.error('Error deleting message:', error);
                    showAppNotification('Gagal menghapus pesan.', 'danger');
                }
            }
        }
        document.querySelectorAll('.message-dropdown-content.active').forEach(openDropdown => {
            openDropdown.classList.remove('active');
        });
    }


    async function sendMessageToChat() {
        const messageText = chatInput.value.trim();
        const file = attachFileInput.files[0];

        if (messageText === '' && !file && audioChunks.length === 0) return;

        if (!currentLoggedInUser || !currentChatTargetUid) {
            alert('Anda harus login dan memilih kontak untuk mengirim pesan.');
            return;
        }

        const chatRoomId = getChatRoomId(currentLoggedInUser.uid, currentChatTargetUid);
        const messagesRef = userChatsRef.child(chatRoomId).child('messages');

        const messageData = {
            senderId: currentLoggedInUser.uid,
            senderEmail: currentLoggedInUser.email,
            timestamp: firebase.database.ServerValue.TIMESTAMP
        };

        if (messageText) {
            messageData.text = messageText;
        }

        if (file) {
            const filePath = `chat_media/${currentLoggedInUser.uid}/${Date.now()}_${file.name}`;
            const storageRef = storage.ref(filePath);
            const uploadTask = storageRef.put(file);

            showAppNotification('Mengunggah gambar...', 'warning');

            uploadTask.on('state_changed',
                (snapshot) => {
                    const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                    showAppNotification(`Mengunggah gambar: ${Math.round(progress)}%`, 'warning');
                },
                (error) => {
                    console.error("Image upload failed:", error);
                    showAppNotification('Gagal mengunggah gambar!', 'danger');
                },
                async () => {
                    messageData.imageUrl = await uploadTask.snapshot.ref.getDownloadURL();
                    await messagesRef.push(messageData);
                    chatInput.value = '';
                    attachFileInput.value = '';
                    showAppNotification('Gambar berhasil terkirim!', 'success');
                    chatMessages.scrollTop = chatMessages.scrollHeight;
                }
            );
        } else if (audioChunks.length > 0) {
            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
            const filePath = `chat_media/${currentLoggedInUser.uid}/${Date.now()}_audio.webm`;
            const storageRef = storage.ref(filePath);
            const uploadTask = storageRef.put(audioBlob);

            showAppNotification('Mengunggah audio...', 'warning');

            uploadTask.on('state_changed',
                (snapshot) => {
                    const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                    showAppNotification(`Mengunggah audio: ${Math.round(progress)}%`, 'warning');
                },
                (error) => {
                    console.error("Audio upload failed:", error);
                    showAppNotification('Gagal mengunggah audio!', 'danger');
                },
                async () => {
                    messageData.audioUrl = await uploadTask.snapshot.ref.getDownloadURL();
                    await messagesRef.push(messageData);
                    chatInput.value = '';
                    audioChunks = [];
                    showAppNotification('Pesan suara berhasil terkirim!', 'success');
                    chatMessages.scrollTop = chatMessages.scrollHeight;
                }
            );
        } else if (messageText) {
            await messagesRef.push(messageData);
            chatInput.value = '';
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
    }


    let mediaRecorderInstance;
    let audioStream;

    async function toggleAudioRecording() {
        if (!currentLoggedInUser) {
            alert('Silakan login untuk merekam suara.');
            return;
        }
        if (!currentChatTargetUid) {
            alert('Pilih kontak chat terlebih dahulu.');
            return;
        }

        if (!mediaRecorderInstance) {
            try {
                audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                mediaRecorderInstance = new MediaRecorder(audioStream);
                audioChunks = [];

                mediaRecorderInstance.ondataavailable = (event) => {
                    audioChunks.push(event.data);
                };

                mediaRecorderInstance.onstop = async () => {
                    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                    const filePath = `chat_media/${currentLoggedInUser.uid}/${Date.now()}_audio.webm`;
                    const storageRef = storage.ref(filePath);
                    const uploadTask = storageRef.put(audioBlob);

                    showAppNotification('Mengunggah audio...', 'warning');

                    uploadTask.on('state_changed',
                        (snapshot) => {
                            const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                            showAppNotification(`Mengunggah audio: ${Math.round(progress)}%`, 'warning');
                        },
                        (error) => {
                            console.error("Audio upload failed:", error);
                            showAppNotification('Gagal mengunggah audio!', 'danger');
                        },
                        async () => {
                            const audioUrl = await uploadTask.snapshot.ref.getDownloadURL();
                            const messageData = {
                                senderId: currentLoggedInUser.uid,
                                senderEmail: currentLoggedInUser.email,
                                timestamp: firebase.database.ServerValue.TIMESTAMP,
                                audioUrl: audioUrl
                            };
                            await userChatsRef.child(getChatRoomId(currentLoggedInUser.uid, currentChatTargetUid)).child('messages').push(messageData);
                            audioChunks = [];
                            showAppNotification('Pesan suara berhasil terkirim!', 'success');
                            chatMessages.scrollTop = chatMessages.scrollHeight;
                        }
                    );

                    recordingStatus.classList.remove('active');
                    recordAudioBtn.innerHTML = '<i class="fas fa-microphone"></i>';
                    audioStream.getTracks().forEach(track => track.stop());
                    mediaRecorderInstance = null;
                };

                mediaRecorderInstance.start();
                recordingStatus.classList.add('active');
                recordAudioBtn.innerHTML = '<i class="fas fa-stop-circle"></i>';
            } catch (error) {
                console.error("Error accessing microphone:", error);
                alert('Gagal mengakses mikrofon. Pastikan Anda memberikan izin.');
            }
        } else {
            mediaRecorderInstance.stop();
        }
    }


    // --- Admin Panel Functions ---
    function showAdminPanel() {
        if (!isAdmin) {
            alert('Anda tidak memiliki akses admin.');
            return;
        }
        showModal(adminPanelModal);
        loadUserListAdmin();
        loadAppSettingsForAdmin();
        loadMaintenanceSettingsForAdmin();
    }

    function loadUserListAdmin() {
        userListAdmin.innerHTML = '';
        usersRef.orderByChild('registrationDate').on('value', (snapshot) => {
            allUsersAdmin = [];
            snapshot.forEach(childSnapshot => {
                const userData = childSnapshot.val();
                const userUid = childSnapshot.key;
                if (userUid === currentLoggedInUser.uid) return;
                allUsersAdmin.unshift({ uid: userUid, ...userData });
            });
            applyUserFilter();
        });
    }

    function applyUserFilter() {
        const searchTerm = adminSearchInput.value.toLowerCase().trim();
        const filteredUsers = allUsersAdmin.filter(user => user.email.toLowerCase().includes(searchTerm));
        renderUserListAdmin(filteredUsers);
    }

    function renderUserListAdmin(usersToRender) {
        userListAdmin.innerHTML = '';
        if (usersToRender.length === 0) {
            const row = document.createElement('tr');
            row.innerHTML = `<td colspan="5" style="text-align: center;">${adminSearchInput.value.trim() ? 'Tidak ada pengguna cocok dengan pencarian.' : 'Tidak ada pengguna terdaftar (selain Anda).'}</td>`;
            userListAdmin.appendChild(row);
            return;
        }

        usersToRender.forEach(user => {
            const row = document.createElement('tr');
            const emailClass = user.isBanned ? 'banned-user' : '';
            row.innerHTML = `
                <td class="${emailClass}">${user.email}</td>
                <td style="text-align: center;">${user.dailyBugLimit || 0}</td>
                <td style="text-align: center;">${user.bugCountToday || 0}</td>
                <td>${user.isBanned ? 'Banned' : 'Aktif'}</td>
                <td>
                    <div class="admin-controls-inline">
                        <button class="add-limit" data-uid="${user.uid}" data-action="addLimit" title="Tambah 1 Limit">+1</button>
                        <button class="remove-limit" data-uid="${user.uid}" data-action="removeLimit" title="Kurang 1 Limit">-1</button>
                        <button class="${user.isBanned ? 'unban' : 'ban'}" data-uid="${user.uid}" data-action="${user.isBanned ? 'unban' : 'ban'}" title="${user.isBanned ? 'Unban Pengguna' : 'Ban Pengguna'}">${user.isBanned ? 'Unban' : 'Ban'}</button>
                        <button class="delete" data-uid="${user.uid}" data-action="delete" title="Hapus Akun">Hapus</button>
                    </div>
                </td>
            `;
            userListAdmin.appendChild(row);
        });

        userListAdmin.querySelectorAll('.admin-controls-inline button').forEach(button => {
            button.addEventListener('click', (e) => {
                const uid = e.target.dataset.uid;
                const action = e.target.dataset.action;
                const userEmail = usersToRender.find(u => u.uid === uid)?.email || 'Unknown User';

                if (action === 'delete') {
                    if (!confirm(`Anda yakin ingin menghapus akun ${userEmail}? Ini tidak bisa dibatalkan!`)) {
                        return;
                    }
                } else if (action === 'ban') {
                    if (!confirm(`Anda yakin ingin BAN akun ${userEmail}? Ini akan mencegah mereka login!`)) {
                        return;
                    }
                }
                adminControlUser(uid, action);
            });
        });
    }


    async function adminControlUser(uid, action) {
        const targetUserRef = usersRef.child(uid);
        hideError(adminUserControlError);
        hideSuccess(adminUserControlSuccess);

        try {
            const userSnapshot = await targetUserRef.once('value');
            const userData = userSnapshot.val();

            if (!userData) {
                displayError(adminUserControlError, 'Pengguna tidak ditemukan.');
                return;
            }

            switch (action) {
                case 'addLimit':
                    await targetUserRef.update({ dailyBugLimit: (userData.dailyBugLimit || 0) + 1 });
                    displaySuccess(adminUserControlSuccess, `Limit ${userData.email} berhasil ditambahkan.`);
                    break;
                case 'removeLimit':
                    if ((userData.dailyBugLimit || 0) > 0) {
                        await targetUserRef.update({ dailyBugLimit: (userData.dailyBugLimit || 0) - 1 });
                        displaySuccess(adminUserControlSuccess, `Limit ${userData.email} berhasil dikurangi.`);
                    } else {
                        displayError(adminUserControlError, 'Limit pengguna sudah 0.');
                    }
                    break;
                case 'ban':
                    await targetUserRef.update({ isBanned: true });
                    displaySuccess(adminUserControlSuccess, `${userData.email} berhasil diban.`);
                    break;
                case 'unban':
                    await targetUserRef.update({ isBanned: false });
                    displaySuccess(adminUserControlSuccess, `${userData.email} berhasil di-unban.`);
                    break;
                case 'delete':
                    await targetUserRef.remove();
                    displaySuccess(adminUserControlSuccess, `${userData.email} berhasil dihapus dari database.`);
                    break;
                default:
                    displayError(adminUserControlError, 'Aksi tidak dikenal.');
            }
            loadUserListAdmin();
        } catch (error) {
            displayError(adminUserControlError, `Gagal melakukan aksi: ${error.message}`);
            console.error("Admin Control Error:", error);
        }
    }

    async function loadAppSettings() {
        appSettingsRef.once('value', (snapshot) => {
            const settings = snapshot.val();
            if (settings) {
                if (settings.logoUrl) {
                    dynamicLogo.src = settings.logoUrl;
                }
                if (settings.webTitle) {
                    dynamicTitleElement.textContent = settings.webTitle;
                    dynamicTitleContent.textContent = settings.webTitle;
                }
            }
        });
    }

    async function loadAppSettingsForAdmin() {
        appSettingsRef.once('value', (snapshot) => {
            const settings = snapshot.val();
            if (settings) {
                adminLogoUrlInput.value = settings.logoUrl || '';
                adminWebTitleInput.value = settings.webTitle || '';
            }
        });
    }

    async function updateLogo() {
        const newLogoUrl = adminLogoUrlInput.value.trim();
        hideError(adminUserControlError);
        hideSuccess(adminUserControlSuccess);
        if (newLogoUrl) {
            await appSettingsRef.update({ logoUrl: newLogoUrl });
            displaySuccess(adminUserControlSuccess, 'Logo berhasil diubah!');
        } else {
            displayError(adminUserControlError, 'URL logo tidak boleh kosong.');
        }
    }

    async function updateTitle() {
        const newTitle = adminWebTitleInput.value.trim();
        hideError(adminUserControlError);
        hideSuccess(adminUserControlSuccess);
        if (newTitle) {
            await appSettingsRef.update({ webTitle: newTitle });
            displaySuccess(adminUserControlSuccess, 'Judul web berhasil diubah!');
        } else {
            displayError(adminUserControlError, 'Judul web tidak boleh kosong.');
        }
    }

    // --- Maintenance Mode Functions ---
    async function loadMaintenanceSettings() {
        if (maintenanceListener) {
            maintenanceListener();
            maintenanceListener = null;
        }

        maintenanceListener = maintenanceRef.on('value', (snapshot) => {
            const maintenanceData = snapshot.val();
            if (maintenanceData) {
                maintenanceToggle.value = maintenanceData.status || 'off';
                maintenanceTitleInput.value = maintenanceData.title || '';
                maintenanceMessageInput.value = maintenanceData.message || '';

                if (maintenanceData.status === 'on') {
                    maintenanceTitle.textContent = maintenanceData.title || "Website dalam Pemeliharaan";
                    maintenanceMessage.textContent = maintenanceData.message || "Mohon maaf atas ketidaknyamanannya. Kami sedang melakukan pemeliharaan untuk meningkatkan layanan kami. Silakan coba lagi nanti.";
                    if (currentLoggedInUser && currentLoggedInUser.email !== ADMIN_EMAIL) {
                        showAppNotification('Sistem sedang dalam mode pemeliharaan. Anda akan logout.', 'danger');
                        auth.signOut();
                        showModal(maintenanceOverlay);
                    } else if (!currentLoggedInUser) {
                        loginRegisterContainer.style.display = 'none';
                        mainAppContainer.style.display = 'none';
                        showModal(maintenanceOverlay);
                    }
                } else {
                    hideModal(maintenanceOverlay);
                    if (!currentLoggedInUser && auth.currentUser) {
                        auth.currentUser.reload().then(() => {
                        }).catch(e => console.warn("Failed to reload user:",e));
                    }
                }
            } else {
                hideModal(maintenanceOverlay);
            }
        }, (error) => {
            console.error("Error fetching maintenance settings:", error);
            hideModal(maintenanceOverlay);
        });
    }

    async function loadMaintenanceSettingsForAdmin() {
         maintenanceRef.once('value', (snapshot) => {
            const maintenanceData = snapshot.val();
            if (maintenanceData) {
                maintenanceToggle.value = maintenanceData.status || 'off';
                maintenanceTitleInput.value = maintenanceData.title || '';
                maintenanceMessageInput.value = maintenanceData.message || '';
            } else {
                maintenanceToggle.value = 'off';
                maintenanceTitleInput.value = '';
                maintenanceMessageInput.value = '';
            }
        });
    }

    async function updateMaintenance() {
        hideError(adminUserControlError);
        hideSuccess(adminUserControlSuccess);
        const status = maintenanceToggle.value;
        const title = maintenanceTitleInput.value.trim();
        const message = maintenanceMessageInput.value.trim();

        await maintenanceRef.set({
            status: status,
            title: title,
            message: message
        });
        displaySuccess(adminUserControlSuccess, 'Pengaturan maintenance berhasil diperbarui!');
    }


    // --- Event Listeners ---
    loginBtn.addEventListener('click', loginUser);
    registerBtn.addEventListener('click', registerUser);
    showRegisterLink.addEventListener('click', (e) => {
        e.preventDefault();
        registerForm.style.display = 'block';
        loginRegisterContainer.querySelector('.auth-card:first-of-type').style.display = 'none';
        hideError(loginError);
    });
    showLoginLink.addEventListener('click', (e) => {
        e.preventDefault();
        registerForm.style.display = 'none';
        loginRegisterContainer.querySelector('.auth-card:first-of-type').style.display = 'block';
        hideError(registerError);
    });

    forgotPasswordLink.addEventListener('click', (e) => { e.preventDefault(); showModal(forgotPasswordModal); });
    sendResetEmailBtn.addEventListener('click', sendPasswordResetEmail);

    showProfileBtn.addEventListener('click', showProfileModal);
    profilePictureInput.addEventListener('change', uploadProfilePicture);
    togglePasswordBtn.addEventListener('click', togglePasswordVisibility);
    changePasswordBtn.addEventListener('click', changeUserPassword);
    logoutBtn.addEventListener('click', logoutUser);

    showDashboardStatsBtn.addEventListener('click', showDashboardStats);

    showTopupBtn.addEventListener('click', showTopupModal);
    topupPackageBtns.forEach(btn => btn.addEventListener('click', handlePackageTopup));
    customLimitAmountInput.addEventListener('input', updateCustomLimitPrice);
    buyCustomLimitBtn.addEventListener('click', handleCustomTopup);

    successAdJoinBtn.addEventListener('click', joinChannel);
    closeAdModalBtn.addEventListener('click', closeAdFloating);

    showChatBtn.addEventListener('click', showChatModal);
    startUserChatBtn.addEventListener('click', startUserChatFlow);
    sendMessageBtn.addEventListener('click', sendMessageToChat);
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendMessageToChat();
        }
    });
    attachFileBtn.addEventListener('click', () => attachFileInput.click());
    attachFileInput.addEventListener('change', (e) => {
        if (e.target.files[0]) {
            sendMessageToChat();
        }
    });
    recordAudioBtn.addEventListener('click', toggleAudioRecording);

    chatBackButton.addEventListener('click', () => {
        chatMain.classList.remove('active');
        chatSidebar.classList.remove('hidden');
        currentChatTargetUid = null;
        currentChatTargetEmail = null;
        chatMessages.innerHTML = '<div style="text-align: center; padding: 20px; color: rgba(255,255,255,0.5);">Pilih kontak untuk memulai chat.</div>';
        if (currentChatMessagesListener) {
            currentChatMessagesListener();
            currentChatMessagesListener = null;
        }
    });

    showAdminPanelBtn.addEventListener('click', showAdminPanel);
    adminSearchInput.addEventListener('input', applyUserFilter);
    adminUpdateLogoBtn.addEventListener('click', updateLogo);
    adminUpdateTitleBtn.addEventListener('click', updateTitle);
    updateMaintenanceBtn.addEventListener('click', updateMaintenance);

    chatContactSearch.addEventListener('input', () => renderChatContactList(Object.values(allUsersCache)));

    closeModalBtns.forEach(btn => btn.addEventListener('click', (e) => {
        const modal = e.target.closest('.modal-overlay');
        if (modal) {
            hideModal(modal);
        }
        hideError(adminUserControlError);
        hideSuccess(adminUserControlSuccess);
        if (modal === chatModal && currentChatMessagesListener) {
            currentChatMessagesListener();
            currentChatMessagesListener = null;
            chatMessages.innerHTML = '';
            currentChatTargetUid = null;
            chatSidebar.classList.remove('hidden');
            chatMain.classList.remove('active');
        }
    }));

    submitBtn.addEventListener('click', submitBug);
    joinChannelBtn.addEventListener('click', joinChannel);


    // --- Initializations ---
    updateCustomLimitPrice();
    loadBugHistory();
    loadAppSettings();
    loadMaintenanceSettings();
    checkCooldown();
});