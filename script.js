    // ======================== FUNGSI DARI USER (dengan penyesuaian) ========================
    function convertCRC16(str) {
        let crc = 0xFFFF;
        for (let c = 0; c < str.length; c++) {
            crc ^= str.charCodeAt(c) << 8;
            for (let i = 0; i < 8; i++) {
                crc = (crc & 0x8000) ? (crc << 1) ^ 0x1021 : crc << 1;
            }
        }
        return (crc & 0xFFFF).toString(16).toUpperCase().padStart(4, '0');
    }

    function MakeCodeQRIS(qris, nominal, useServiceFee, feeType, feeValue) {
        let tax = '';

        if (useServiceFee === 'y') {
            // feeType 'r' -> persen (55020256), selain itu nominal tetap (55020357)
            tax = feeType === 'r'
                ? "55020357" + String(feeValue.length).padStart(2, '0') + feeValue
                : "55020256" + String(feeValue.length).padStart(2, '0') + feeValue;
        }

        // hapus 4 karakter CRC terakhir, lalu ubah 010211 -> 010212 (static to dynamic)
        qris = qris.slice(0, -4).replace("010211", "010212");

        const [prefix, suffix] = qris.split("5802ID");
        if (prefix === undefined || suffix === undefined) {
            throw new Error("Format QRIS tidak valid: tidak ditemukan separator '5802ID'");
        }

        const nominalData = "54" + String(nominal.length).padStart(2, '0') + nominal;

        const payloadWithoutCRC = prefix + nominalData + (tax || '') + "5802ID" + suffix;
        const crcFinal = convertCRC16(payloadWithoutCRC);
        const resultQRIS = payloadWithoutCRC + crcFinal;
        return resultQRIS;
    }

    // ======================== HELPER & UI LOGIC ========================
    // Default base QRIS yang valid (berisi 010211, 5802ID, diakhiri 4 karakter dummy "AAAA")
    // Contoh base statis: merchant dummy, tanpa nominal & tanpa CRC tag (hanya placeholder)
    const DEFAULT_QRIS_BASE = "00020101021126570011ID.DANA.WWW011893600915302005266102090200526610303UMI51440014ID.CO.QRIS.WWW0215ID10265004923620303UMI5204654053033605802ID5905XTRON6012Kota Cilegon61054241563047E6F";

    // Inisialisasi DOM elements
    const baseQrisTextarea = document.getElementById('baseQrisInput');
    const nominalInput = document.getElementById('nominalInput');
    const feeYesRadio = document.getElementById('feeYes');
    const feeNoRadio = document.getElementById('feeNo');
    const feeOptionsPanel = document.getElementById('feeOptionsPanel');
    const feeTypeRadios = document.querySelectorAll('input[name="feeType"]');
    const feeValueInput = document.getElementById('feeValueInput');
    const generateBtn = document.getElementById('generateBtn');
    const qrCanvas = document.getElementById('qrCanvas');
    const rawQrisSpan = document.getElementById('rawQrisString');
    const copyRawBtn = document.getElementById('copyRawBtn');
    const scanBtn = document.getElementById('scanBtn');
    const uploadQrisBtn = document.getElementById('uploadQrisBtn');
    const uploadQrisInput = document.getElementById('uploadQrisInput');
    const qrStatusSpan = document.getElementById('qrStatus');
    const merchantNameInfo = document.getElementById('merchantNameInfo');
    const merchantCityInfo = document.getElementById('merchantCityInfo');
    const merchantProviderInfo = document.getElementById('merchantProviderInfo');

    // set default base QRIS
    baseQrisTextarea.value = DEFAULT_QRIS_BASE;

    // Tampilkan/sembunyikan panel fee berdasarkan radio Ya/Tidak
    function toggleFeePanel() {
        if (feeYesRadio.checked) {
            feeOptionsPanel.style.display = 'block';
        } else {
            feeOptionsPanel.style.display = 'none';
        }
    }
    feeYesRadio.addEventListener('change', toggleFeePanel);
    feeNoRadio.addEventListener('change', toggleFeePanel);
    toggleFeePanel();

    function parseTLV(str) {
        const parsed = {};
        let cursor = 0;
        while (cursor + 4 <= str.length) {
            const tag = str.slice(cursor, cursor + 2);
            const len = parseInt(str.slice(cursor + 2, cursor + 4), 10);
            if (Number.isNaN(len) || cursor + 4 + len > str.length) break;
            const value = str.slice(cursor + 4, cursor + 4 + len);
            parsed[tag] = value;
            cursor += 4 + len;
        }
        return parsed;
    }

    function updateMerchantInfo() {
        const rawBase = baseQrisTextarea.value.trim();
        if (!rawBase || rawBase.length < 4 || !rawBase.includes('010211') || !rawBase.includes('5802ID')) {
            merchantNameInfo.innerText = '-';
            merchantCityInfo.innerText = '-';
            merchantProviderInfo.innerText = '-';
            return;
        }
        const tlv = parseTLV(rawBase);
        merchantNameInfo.innerText = tlv['59'] || '-';
        merchantCityInfo.innerText = tlv['60'] || '-';
        let provider = '-';
        if (tlv['26']) {
            const nested = parseTLV(tlv['26']);
            provider = nested['00'] || '-';
        }
        merchantProviderInfo.innerText = provider;
    }

    baseQrisTextarea.addEventListener('input', updateMerchantInfo);
    updateMerchantInfo();

    async function scanQRISWithCamera() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            alert("Browser Anda tidak mendukung akses kamera.");
            return;
        }

        let stream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment' }
            });
        } catch (error) {
            alert("Gagal membuka kamera: " + (error.message || error));
            return;
        }

        const overlay = document.createElement('div');
        overlay.className = 'camera-overlay';
        overlay.innerHTML = `
            <div class="camera-card">
                <div class="camera-header">
                    <span>📷 Scan QRIS</span>
                    <button type="button" class="close-camera-btn">Tutup</button>
                </div>
                <video id="cameraPreview" autoplay playsinline muted></video>
                <div class="camera-instructions">Membuka kamera dan mencari kode QR secara otomatis...</div>
                <div class="camera-footer">
                    <button type="button" class="close-camera-btn secondary">Tutup Kamera</button>
                </div>
            </div>`;
        document.body.appendChild(overlay);

        const video = overlay.querySelector('#cameraPreview');
        const instructions = overlay.querySelector('.camera-instructions');
        const closeButtons = overlay.querySelectorAll('.close-camera-btn');
        video.srcObject = stream;

        const scanCanvas = document.createElement('canvas');
        const scanCtx = scanCanvas.getContext('2d');
        let stopped = false;
        let timeoutId = null;

        const stopCamera = (message) => {
            if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = null;
            }
            stopped = true;
            if (stream) {
                stream.getTracks().forEach(track => track.stop());
            }
            if (overlay.parentNode) {
                overlay.parentNode.removeChild(overlay);
            }
            if (message) {
                alert(message);
            }
        };

        closeButtons.forEach((button) => button.addEventListener('click', () => stopCamera()));

        const handleDetected = (rawValue) => {
            if (stopped) return;
            stopped = true;
            stopCamera();
            alert("QRIS terdeteksi:\n" + rawValue);
            if (rawValue && rawValue.includes('010211') && rawValue.includes('5802ID')) {
                baseQrisTextarea.value = rawValue;
                updateMerchantInfo();
                generateQRISPayment();
            } else {
                alert("Hasil scan tidak valid sebagai QRIS statis. Silakan periksa kembali atau gunakan input manual.");
            }
        };

        const scanWithBarcodeDetector = async () => {
            try {
                const detector = new BarcodeDetector({ formats: ['qr_code'] });
                const barcodes = await detector.detect(video);
                if (barcodes.length) {
                    handleDetected(barcodes[0].rawValue || barcodes[0].displayValue || '');
                    return true;
                }
            } catch (err) {
                console.warn('BarcodeDetector error:', err);
            }
            return false;
        };

        const scanWithJsQR = () => {
            if (typeof jsQR !== 'function') {
                return false;
            }
            if (video.videoWidth === 0 || video.videoHeight === 0) {
                return false;
            }
            scanCanvas.width = video.videoWidth;
            scanCanvas.height = video.videoHeight;
            scanCtx.drawImage(video, 0, 0, scanCanvas.width, scanCanvas.height);
            const imageData = scanCtx.getImageData(0, 0, scanCanvas.width, scanCanvas.height);
            const code = jsQR(imageData.data, imageData.width, imageData.height);
            if (code && code.data) {
                handleDetected(code.data);
                return true;
            }
            return false;
        };

        const scanLoop = async () => {
            if (stopped) return;
            if (video.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA) {
                let detected = false;
                if ('BarcodeDetector' in window) {
                    detected = await scanWithBarcodeDetector();
                }
                if (!detected && typeof jsQR === 'function') {
                    detected = scanWithJsQR();
                }
                if (detected) return;
            }
            requestAnimationFrame(scanLoop);
        };

        timeoutId = setTimeout(() => {
            if (!stopped) {
                stopCamera();
                alert('Tidak berhasil mendeteksi QRIS dalam 20 detik. Pastikan kode QR terlihat jelas dan coba lagi.');
            }
        }, 20000);

        video.addEventListener('loadedmetadata', () => {
            video.play().catch(() => {});
            scanLoop();
        });

        if (video.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA) {
            scanLoop();
        }
    }

    scanBtn.addEventListener('click', scanQRISWithCamera);
    uploadQrisBtn.addEventListener('click', () => uploadQrisInput.click());

    function decodeQrisFromImageFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    canvas.width = img.naturalWidth;
                    canvas.height = img.naturalHeight;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0);
                    try {
                        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                        if (typeof jsQR !== 'function') {
                            reject(new Error('Library jsQR tidak ditemukan.'));
                            return;
                        }
                        const code = jsQR(imageData.data, imageData.width, imageData.height);
                        if (code && code.data) {
                            resolve(code.data);
                        } else {
                            reject(new Error('Tidak ditemukan QR code valid pada gambar.'));
                        }
                    } catch (err) {
                        reject(new Error('Gagal membaca gambar QR: ' + err.message));
                    }
                };
                img.onerror = () => reject(new Error('Gagal memuat file gambar.'));
                img.src = reader.result;
            };
            reader.onerror = () => reject(new Error('Gagal membaca file gambar.'));
            reader.readAsDataURL(file);
        });
    }

    uploadQrisInput.addEventListener('change', async (event) => {
        const file = event.target.files && event.target.files[0];
        if (!file) return;

        try {
            qrStatusSpan.innerText = '🔍 Memproses gambar...';
            const rawValue = await decodeQrisFromImageFile(file);
            if (rawValue && rawValue.includes('010211') && rawValue.includes('5802ID')) {
                baseQrisTextarea.value = rawValue;
                updateMerchantInfo();
                generateQRISPayment();
                qrStatusSpan.innerText = '✅ QRIS berhasil diunggah dan terdeteksi.';
                qrStatusSpan.style.color = '#15803d';
            } else {
                throw new Error('QR code dari gambar bukan format QRIS statis yang valid.');
            }
        } catch (err) {
            alert(err.message || err);
            qrStatusSpan.innerText = '⚠️ ' + (err.message || 'Gagal memproses gambar QR.');
            qrStatusSpan.style.color = '#b91c1c';
        } finally {
            uploadQrisInput.value = '';
        }
    });

    // validasi dan generate QR
    function generateQRISPayment() {
        try {
            // ambil nilai
            let rawBase = baseQrisTextarea.value.trim();
            if (!rawBase) {
                throw new Error("Base QRIS tidak boleh kosong. Silakan isi string QRIS statis.");
            }
            // Pastikan panjang minimal 4 (untuk slice(-4))
            if (rawBase.length < 4) {
                throw new Error("Base QRIS harus memiliki panjang minimal 4 karakter (terdapat dummy CRC 4 digit di akhir)");
            }
            if (!rawBase.includes("5802ID")) {
                throw new Error("Base QRIS harus mengandung '5802ID' sebagai separator merchant & data tambahan.");
            }
            if (!rawBase.includes("010211")) {
                throw new Error("Base QRIS harus mengandung '010211' (Point of Initiation Method statis). Fungsi akan mengubah ke '010212' (dinamis).");
            }

            let nominalRaw = nominalInput.value.trim();
            if (!nominalRaw) {
                throw new Error("Nominal tidak boleh kosong");
            }
            // Hilangkan koma / titik (hanya angka)
            let nominalStr = nominalRaw.replace(/[^0-9]/g, '');
            if (nominalStr === "" || parseInt(nominalStr, 10) <= 0) {
                throw new Error("Nominal harus angka positif (minimal 1 IDR)");
            }
            // nominal dalam bentuk string tanpa leading zeros
            nominalStr = String(parseInt(nominalStr, 10));

            // cek apakah pakai fee
            let useServiceFee = feeYesRadio.checked ? 'y' : 'n';
            let feeType = 'r'; // default persen
            let feeValue = "";

            if (useServiceFee === 'y') {
                // ambil tipe fee dari radio group (r / f)
                const selectedFeeType = document.querySelector('input[name="feeType"]:checked');
                feeType = selectedFeeType ? selectedFeeType.value : 'r';
                let rawFee = feeValueInput.value.trim();
                if (rawFee === "") {
                    throw new Error("Nilai fee tidak boleh kosong jika mengaktifkan service fee");
                }
                // Bersihkan input: untuk persentase bisa mengandung titik desimal, untuk nominal tetap hanya angka
                if (feeType === 'r') {
                    // persen: boleh desimal (contoh "2.5") -> langsung string
                    if (isNaN(parseFloat(rawFee))) {
                        throw new Error("Fee persentase harus berupa angka (contoh: 2.5)");
                    }
                    // biarkan sebagai string asli untuk length & value, misal "2.5" -> panjang 3
                    feeValue = rawFee;
                } else {
                    // nominal tetap: hanya angka integer
                    let cleanFixed = rawFee.replace(/[^0-9]/g, '');
                    if (cleanFixed === "" || parseInt(cleanFixed,10) <= 0) {
                        throw new Error("Fee nominal tetap harus angka positif (IDR)");
                    }
                    feeValue = String(parseInt(cleanFixed,10));
                }
                // optional: jika feeValue terlalu panjang tidak masalah, tapi tetap ikut standar.
            }

            // Panggil fungsi utama untuk membuat QRIS lengkap
            const finalQRIS = MakeCodeQRIS(rawBase, nominalStr, useServiceFee, feeType, feeValue);
            
            // tampilkan raw string
            rawQrisSpan.innerText = finalQRIS;
            
            // generate QR code ke canvas menggunakan qrcode-generator
            // qrcode-generator global dari CDN: gunakan 'qrcode' (versi 1.4.4)
            if (typeof qrcode === 'undefined') {
                throw new Error("Library QR code tidak terdeteksi, coba muat ulang halaman.");
            }
            // pilih error correction M, versi auto (0)
            let qr = qrcode(0, 'M');
            qr.addData(finalQRIS);
            qr.make();
            
            // ukuran modul: scaling agar pas di canvas 250x250
            const cellSize = 4;   // ukuran tiap modul dalam px
            const margin = 4;
            const qrSize = qr.getModuleCount();
            const canvasSize = qrSize * cellSize + margin * 2;
            qrCanvas.width = canvasSize;
            qrCanvas.height = canvasSize;
            const ctx = qrCanvas.getContext('2d');
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvasSize, canvasSize);
            ctx.fillStyle = '#000000';
            for (let row = 0; row < qrSize; row++) {
                for (let col = 0; col < qrSize; col++) {
                    if (qr.isDark(row, col)) {
                        ctx.fillRect(margin + col * cellSize, margin + row * cellSize, cellSize, cellSize);
                    }
                }
            }
            qrStatusSpan.innerHTML = "✅ QR Code siap! Scan untuk pembayaran.";
            qrStatusSpan.style.color = "#15803d";
        } catch (err) {
            console.error(err);
            rawQrisSpan.innerText = "Error: " + err.message;
            qrStatusSpan.innerHTML = "⚠️ " + err.message;
            qrStatusSpan.style.color = "#b91c1c";
            // bersihkan canvas (tampilkan pesan error)
            const ctx = qrCanvas.getContext('2d');
            ctx.fillStyle = '#f8fafc';
            ctx.fillRect(0, 0, qrCanvas.width, qrCanvas.height);
            ctx.fillStyle = '#b91c1c';
            ctx.font = "12px monospace";
            ctx.fillText("Gagal generate", 10, 50);
        }
    }

    // Event generate
    generateBtn.addEventListener('click', generateQRISPayment);

    // copy raw QRIS string ke clipboard
    copyRawBtn.addEventListener('click', async () => {
        const rawText = rawQrisSpan.innerText;
        if (!rawText || rawText.startsWith("Error")) {
            alert("Tidak ada string QRIS valid untuk disalin. Generate terlebih dahulu.");
            return;
        }
        try {
            await navigator.clipboard.writeText(rawText);
            const originalText = copyRawBtn.innerText;
            copyRawBtn.innerText = "✅ Tersalin!";
            setTimeout(() => {
                copyRawBtn.innerText = originalText;
            }, 1500);
        } catch (e) {
            alert("Gagal menyalin: " + e);
        }
    });

    // Auto generate pada saat load pertama (contoh dengan nominal default 25000)
    window.addEventListener('DOMContentLoaded', () => {
        // set nilai default yang sudah ramah
        generateQRISPayment();
    });

    // validasi tambahan: ketika fee type berubah (untuk memberikan placeholder yang sesuai)
    function updateFeePlaceholder() {
        const selected = document.querySelector('input[name="feeType"]:checked');
        if (selected && selected.value === 'r') {
            feeValueInput.placeholder = "Contoh: 2.5 (persen)";
        } else {
            feeValueInput.placeholder = "Contoh: 3000 (nominal tetap IDR)";
        }
    }
    feeTypeRadios.forEach(radio => radio.addEventListener('change', updateFeePlaceholder));
    updateFeePlaceholder();

    // tambahkan tombol enter friendly (optional)
    nominalInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') generateQRISPayment();
    });
    feeValueInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') generateQRISPayment();
    });