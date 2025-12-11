/**
 * VoiceCommander - Iron Man Mode for Tomodachi POS
 * Handles Web Speech API interactions and Intent Recognition
 */
class VoiceCommander {
    constructor() {
        this.recognition = null;
        this.isListening = false;
        this.synth = window.speechSynthesis;
        this.overlay = document.getElementById('jarvisOverlay');

        this.initSpeech();
        this.bindEvents();
    }

    initSpeech() {
        if ('webkitSpeechRecognition' in window) {
            this.recognition = new webkitSpeechRecognition();
            this.recognition.continuous = false; // Stop after one command
            this.recognition.lang = 'es-MX';
            this.recognition.interimResults = true;

            this.recognition.onstart = () => {
                this.isListening = true;
                this.updateUI('listening');
            };

            this.recognition.onresult = (event) => {
                let interimTranscript = '';
                let finalTranscript = '';

                for (let i = event.resultIndex; i < event.results.length; ++i) {
                    if (event.results[i].isFinal) {
                        finalTranscript += event.results[i][0].transcript;
                    } else {
                        interimTranscript += event.results[i][0].transcript;
                    }
                }

                if (finalTranscript) {
                    this.processCommand(finalTranscript.toLowerCase());
                }

                // Show raw text
                const transcriptEl = document.getElementById('jarvisTranscript');
                if (transcriptEl) transcriptEl.textContent = finalTranscript || interimTranscript;
            };

            this.recognition.onerror = (event) => {
                console.error('Speech error', event.error);
                this.updateUI('error');
                this.speak('Error en el sistema de voz.');
            };

            this.recognition.onend = () => {
                this.isListening = false;
                if (this.overlay && !this.overlay.classList.contains('processing')) {
                    this.closeOverlay(); // Auto close if not processing
                }
            };
        } else {
            console.warn('Web Speech API not supported');
            alert('Tu navegador no soporta control por voz (Usa Chrome/Edge).');
        }
    }

    bindEvents() {
        const btn = document.getElementById('toggleVoiceBtn');
        if (btn) {
            btn.addEventListener('click', () => {
                this.startListening();
            });
        }

        // Close overlay on click
        if (this.overlay) {
            this.overlay.addEventListener('click', (e) => {
                if (e.target === this.overlay) this.closeOverlay();
            });
        }
    }

    async startListening() {
        if (this.recognition && !this.isListening) {
            this.overlay.classList.add('active');
            try {
                this.recognition.start();
                await this.initAudioVisualizer(); // Start visualizer
            } catch (e) {
                console.error(e);
            }
        }
    }

    stopListening() {
        if (this.recognition && this.isListening) {
            this.recognition.stop();
        }
        this.stopAudioVisualizer();
    }

    // --- Audio Visualizer Logic ---
    async initAudioVisualizer() {
        try {
            if (!this.audioContext) {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }
            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }

            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.mediaStream = stream;

            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 256;
            this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);

            const source = this.audioContext.createMediaStreamSource(stream);
            source.connect(this.analyser);

            this.visualize();
        } catch (e) {
            console.warn('Audio visualizer failed:', e);
        }
    }

    stopAudioVisualizer() {
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
            this.mediaStream = null;
        }
        if (this.visualizationFrame) {
            cancelAnimationFrame(this.visualizationFrame);
            this.visualizationFrame = null;
        }
        // Reset wave scale
        const waves = document.querySelectorAll('.voice-wave');
        waves.forEach(w => w.style.transform = 'scaleY(1)');
    }

    visualize() {
        if (!this.analyser) return;

        const animate = () => {
            if (!this.isListening) return;

            this.analyser.getByteFrequencyData(this.dataArray);

            // Calculate average volume (RMS-like)
            let sum = 0;
            for (let i = 0; i < this.dataArray.length; i++) {
                sum += this.dataArray[i];
            }
            const average = sum / this.dataArray.length;

            // Map average (0-255) to a scale factor (1.0 - 2.5) for waves
            // Threshold logic to avoid jitter noise
            const boost = average > 10 ? (1 + (average / 30)) : 1;

            // Apply scale to waves with different multipliers for organic feel
            const waves = document.querySelectorAll('.voice-wave');
            if (waves.length >= 3) {
                // Background wave
                waves[0].style.transform = `scaleY(${1 + (boost - 1) * 0.5}) translateY(${-(boost - 1) * 5}px)`;
                // Middle wave
                waves[1].style.transform = `scaleY(${Math.max(1, boost * 0.8)}) translateY(${-(boost - 1) * 10}px)`;
                // Front wave (most reactive)
                waves[2].style.transform = `scaleY(${boost}) translateY(${-(boost - 1) * 15}px)`;
            }

            this.visualizationFrame = requestAnimationFrame(animate);
        };
        this.visualizationFrame = requestAnimationFrame(animate);
    }

    closeOverlay() {
        this.overlay.classList.remove('active');
        this.stopListening();
    }

    updateUI(state) {
        const statusEl = document.getElementById('jarvisStatus');
        const overlay = this.overlay;

        if (state === 'listening') {
            statusEl.textContent = 'Escuchando... ';
            overlay.classList.add('listening');
        } else if (state === 'processing') {
            statusEl.textContent = 'Pensando... ✨';
            overlay.classList.remove('listening');
            overlay.classList.add('processing');
        } else if (state === 'success') {
            statusEl.textContent = '¡Listo! 🌸';
            overlay.classList.remove('processing');
        } else if (state === 'error') {
            statusEl.textContent = 'Ops, no entendí 🥺';
            overlay.classList.remove('processing');
        } else {
            statusEl.textContent = '¿En qué te ayudo?';
            overlay.classList.remove('listening', 'processing');
        }
    }

    async processCommand(text) {
        this.updateUI('processing');
        console.log('Command:', text);

        // --- Intent Recognition Logic ---

        // 1. ADD PRODUCT: "Agregar [cantidad] [producto]" or "Dame [cantidad] [producto]"
        // Regex: (agregar|dame|pon|vende) (un|una|dos|tres|\d+)?\s*(.*)
        const addMatch = text.match(/(agregar|agrégame|dame|pon|vende)\s+(un|una|dos|tres|\d+)?\s*(.*)/);

        if (addMatch) {
            let qtyStr = addMatch[2] || '1';
            const productQuery = addMatch[3].trim();

            // Map text numbers to int
            const numMap = { 'un': 1, 'una': 1, 'dos': 2, 'tres': 3, 'cuatro': 4, 'cinco': 5, 'seis': 6, 'siete': 7, 'ocho': 8, 'nueve': 9, 'diez': 10 };
            let qty = parseInt(qtyStr);
            if (isNaN(qty)) qty = numMap[qtyStr] || 1;

            if (productQuery) {
                const success = await window.posSystem.searchAndAdd(productQuery, qty);
                if (success) {
                    this.speak(`Agregado ${qty} ${productQuery}`);
                    this.updateUI('success');
                } else {
                    this.speak(`No encontré ${productQuery}`);
                    this.updateUI('error');
                }
            }
            setTimeout(() => this.closeOverlay(), 1500);
            return;
        }

        // 2. CHECKOUT: "Cobrar", "Finalizar venta", "Cerrar cuenta"
        if (text.includes('cobrar') || text.includes('finalizar') || text.includes('cerrar venta') || text.includes('cuenta')) {
            window.posSystem.initCheckout();
            this.speak('Iniciando cobro');
            this.updateUI('success');
            setTimeout(() => this.closeOverlay(), 1000);
            return;
        }

        // 3. CANCEL/CLEAR: "Cancelar venta", "Borrar todo", "Limpiar"
        if (text.includes('cancelar venta') || text.includes('borrar todo') || text.includes('limpiar')) {
            if (confirm('¿Confirmas limpiar toda la venta por voz?')) {
                window.posSystem.clearCart();
                this.speak('Venta cancelada');
            }
            this.closeOverlay();
            return;
        }

        // Default: No match
        this.speak('No entendí el comando');
        this.updateUI('error');
        setTimeout(() => this.closeOverlay(), 1500);
    }

    speak(text) {
        if (this.synth) {
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = 'es-MX';
            utterance.rate = 1.1; // Slightly faster/robotic
            this.synth.speak(utterance);
        }
    }
}

// Global Init
document.addEventListener('DOMContentLoaded', () => {
    window.voiceCommander = new VoiceCommander();
});
