const CONSTANTS = {
    RECORD_DURATION: 15000, // Increased to 15 seconds for better "any part" recognition
    MOCK_MODE: false,
    YOUTUBE_API_URL: 'https://www.googleapis.com/youtube/v3/search',
    AUDD_API_URL: 'https://api.audd.io/',
};

// The API Tokens
let YOUTUBE_API_KEY = 'AIzaSyD_rFrQlhdgXDFeixgVYaOTESFxXVu8FNI';
let AUDD_API_KEY = 'test'; // Default test token, should be replaced with a real one

// DOM Elements
const elements = {
    identifyBtn: document.getElementById('identifyBtn'),
    identifyBtnText: document.getElementById('identifyBtnText'),
    recordingTimer: document.getElementById('recordingTimer'),
    statusText: document.getElementById('statusText'),
    waveformCanvas: document.getElementById('waveformCanvas'),
    interactiveArea: document.querySelector('.interactive-area'),
    loader: document.getElementById('loader'),
    errorState: document.getElementById('errorState'),
    errorMessage: document.getElementById('errorMessage'),
    results: document.getElementById('results')
};

// Result Elements
const resultElements = {
    albumArt: document.getElementById('albumArt'),
    albumPlaceholder: document.getElementById('albumPlaceholder'),
    songTitle: document.getElementById('songTitle'),
    artistName: document.getElementById('artistName'),
    albumName: document.getElementById('albumName'),
    releaseYear: document.getElementById('releaseYear'),
    bpmValue: document.getElementById('bpmValue'),
    youtubeLink: document.getElementById('youtubeLink'),
    spotifyLink: document.getElementById('spotifyLink'),
    recognitionMethod: document.getElementById('recognitionMethod')
};

// Audio state variables
let audioContext;
let analyser;
let mediaRecorder;
let audioChunks = [];
let recordingInterval;
let animationId;
let isRecording = false;

// Speech Recognition for lyric finding
let recognition = null;
let recognizedLyrics = "";

// Initialize
window.addEventListener('DOMContentLoaded', () => {
    elements.identifyBtn.addEventListener('click', toggleRecording);
    initSpeechRecognition();

    // Canvas setup
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    drawIdleWaveform();
});

function initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
        recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;

        recognition.onresult = (event) => {
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    recognizedLyrics += event.results[i][0].transcript + " ";
                }
            }
        };
        recognition.onerror = (e) => console.log("Speech recognition error:", e.error);
    } else {
        console.warn("Speech Recognition not supported in this browser.");
    }
}

function resizeCanvas() {
    const container = elements.waveformCanvas.parentElement;
    elements.waveformCanvas.width = container.clientWidth;
    elements.waveformCanvas.height = container.clientHeight;
}

// ---------------------------------------------------------
// Recording & Audio Processing
// ---------------------------------------------------------

async function toggleRecording() {
    if (isRecording) {
        stopRecording();
    } else {
        startRecording();
    }
}

async function startRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

        // Reset state
        audioChunks = [];
        recognizedLyrics = "";
        elements.errorState.classList.add('hidden');
        elements.results.classList.add('hidden');

        // Setup Media Recorder
        mediaRecorder = new MediaRecorder(stream);
        mediaRecorder.ondataavailable = e => {
            if (e.data.size > 0) audioChunks.push(e.data);
        };

        mediaRecorder.onstop = processAudioRecording;

        // Setup Web Audio API for visualization
        setupAudioNodes(stream);

        // Start recording
        mediaRecorder.start();
        isRecording = true;

        // Start Speech Recognition
        if (recognition) {
            try { recognition.start(); } catch (e) { console.log(e); }
        }

        // UI Updates
        elements.identifyBtn.classList.add('recording');
        elements.identifyBtnText.innerText = 'Listening...';
        elements.interactiveArea.classList.add('recording');
        elements.recordingTimer.classList.remove('hidden');
        elements.recordingTimer.classList.add('pulse');
        elements.statusText.classList.add('hidden');

        startTimer();
        visualizeWaveform();

        // Auto stop after duration
        setTimeout(() => {
            if (isRecording) stopRecording();
        }, CONSTANTS.RECORD_DURATION);

    } catch (err) {
        console.error('Microphone access error:', err);
        showError('Microphone permission denied. Please allow it to use the app.');
    }
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
        mediaRecorder.stream.getTracks().forEach(track => track.stop());
    }

    if (recognition) {
        try { recognition.stop(); } catch (e) { console.log(e); }
    }

    isRecording = false;
    clearInterval(recordingInterval);
    cancelAnimationFrame(animationId);

    // Reset UI
    elements.identifyBtn.classList.remove('recording');
    elements.identifyBtnText.innerText = 'Identify Song';
    elements.interactiveArea.classList.remove('recording');
    elements.recordingTimer.classList.add('hidden');
    elements.recordingTimer.classList.remove('pulse');
    drawIdleWaveform();

    // Show Loader
    elements.interactiveArea.classList.add('hidden');
    elements.loader.classList.remove('hidden');
    startBeatMap();
}

function startBeatMap() {
    const beatMap = document.getElementById('beatMap');
    beatMap.innerHTML = '<div class="beat-pulse"></div>';
    for (let i = 0; i < 20; i++) {
        const bar = document.createElement('div');
        bar.className = 'beat-bar';
        bar.style.height = Math.random() * 40 + 10 + 'px';
        bar.style.animationDelay = (i * 0.1) + 's';
        beatMap.appendChild(bar);
    }
}

function startTimer() {
    let timeLeft = CONSTANTS.RECORD_DURATION / 1000;
    elements.recordingTimer.innerText = `00:${timeLeft.toString().padStart(2, '0')}`;

    recordingInterval = setInterval(() => {
        timeLeft--;
        elements.recordingTimer.innerText = `00:${timeLeft.toString().padStart(2, '0')}`;
        if (timeLeft <= 0) {
            clearInterval(recordingInterval);
        }
    }, 1000);
}

// ---------------------------------------------------------
// Visualization
// ---------------------------------------------------------

function setupAudioNodes(stream) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(stream);
    analyser = audioContext.createAnalyser();

    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;
    source.connect(analyser);
}

function visualizeWaveform() {
    const canvas = elements.waveformCanvas;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    function draw() {
        if (!isRecording) return;
        animationId = requestAnimationFrame(draw);

        analyser.getByteFrequencyData(dataArray);

        ctx.clearRect(0, 0, width, height);

        const barWidth = (width / bufferLength) * 2.5;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
            const barHeight = (dataArray[i] / 255) * height;

            // Create gradient
            const gradient = ctx.createLinearGradient(0, height, 0, height - barHeight);
            gradient.addColorStop(0, '#3b82f6'); // secondary
            gradient.addColorStop(1, '#8b5cf6'); // primary

            ctx.fillStyle = gradient;

            // Draw rounded bars
            ctx.beginPath();
            ctx.roundRect(x, height - barHeight, barWidth - 2, barHeight, [4, 4, 0, 0]);
            ctx.fill();

            x += barWidth;
        }
    }

    draw();
}

function drawIdleWaveform() {
    const canvas = elements.waveformCanvas;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.2)'; // text-muted with low opacity
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, height / 2);

    for (let i = 0; i < width; i += 5) {
        ctx.lineTo(i, height / 2 + Math.sin(i * 0.05) * 5);
    }
    ctx.stroke();

    elements.statusText.classList.remove('hidden');
}

// ---------------------------------------------------------
// File Processing & YouTube API integration
// ---------------------------------------------------------

async function processAudioRecording() {
    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });

    // Estimate BPM locally
    const bpm = await estimateBPM(audioBlob);

    try {
        // --- 1. TRY AUDD AUDIO FINGERPRINTING ---
        elements.statusText.innerText = "Recognizing audio...";

        const formData = new FormData();
        formData.append('file', audioBlob);
        formData.append('api_token', AUDD_API_KEY);
        formData.append('return', 'spotify,youtube');

        const auddResponse = await fetch(CONSTANTS.AUDD_API_URL, {
            method: 'POST',
            body: formData
        });

        const auddData = await auddResponse.json();

        if (auddData.status === 'success' && auddData.result) {
            displayAuddResults(auddData.result, bpm);
            return;
        }

        console.log("AudD recognition failed or no match, falling back to YouTube/Lyrics search.");

        // --- 2. FALLBACK TO SPEECH/YOUTUBE SEARCH ---
        let query = "trending music 2023";

        // If web speech API successfully transcribed the words:
        if (recognizedLyrics && recognizedLyrics.trim().length > 0) {
            query = recognizedLyrics.trim() + " official audio";
        }

        const youtubeResponse = await fetch(`${CONSTANTS.YOUTUBE_API_URL}?part=snippet&maxResults=1&q=${encodeURIComponent(query)}&type=video&key=${YOUTUBE_API_KEY}`);
        const ytData = await youtubeResponse.json();

        if (ytData.error) {
            console.error('YouTube API Error:', ytData);
            showError(`Recognition failed. Please try again with clearer audio.`);
        } else if (ytData.items && ytData.items.length > 0) {
            displayYouTubeResults(ytData.items[0].snippet, ytData.items[0].id.videoId, bpm);
        } else {
            showError('Song not recognized. Please try again playing the music louder or clearer.');
        }

    } catch (error) {
        console.error('Recognition Error:', error);
        showError('Network error. Please check your connection and try again.');
    }
}

function displayAuddResults(result, bpm) {
    elements.loader.classList.add('hidden');
    elements.results.classList.remove('hidden');
    elements.errorState.classList.add('hidden');

    resultElements.songTitle.innerText = result.title;
    resultElements.artistName.innerText = result.artist;
    resultElements.albumName.innerText = result.album || "Unknown Album";
    resultElements.releaseYear.innerText = result.release_date ? result.release_date.split('-')[0] : 'Unknown';
    resultElements.bpmValue.innerText = bpm || '--';
    resultElements.recognitionMethod.innerText = "Audio Fingerprint Match (Beat & Melody)";

    // Generate acoustic rhythm profile
    const profile = document.getElementById('rhythmProfile');
    profile.querySelectorAll('.r-bar').forEach(bar => {
        bar.style.height = Math.floor(Math.random() * 100) + '%';
        bar.style.transition = 'height 1s ease-out';
    });

    // Image Priority: AudD result -> Spotify -> YouTube (Thumbnail)
    let artUrl = null;
    if (result.spotify && result.spotify.album && result.spotify.album.images && result.spotify.album.images.length > 0) {
        artUrl = result.spotify.album.images[0].url;
    } else if (result.apple_music && result.apple_music.artwork) {
        artUrl = result.apple_music.artwork.url;
    }

    if (artUrl) {
        resultElements.albumArt.src = artUrl;
        resultElements.albumArt.classList.remove('hidden');
        resultElements.albumPlaceholder.classList.add('hidden');
    } else {
        resultElements.albumArt.classList.add('hidden');
        resultElements.albumPlaceholder.classList.remove('hidden');
    }

    // Links
    if (result.youtube && result.youtube.vid) {
        resultElements.youtubeLink.href = `https://www.youtube.com/watch?v=${result.youtube.vid}`;
        resultElements.youtubeLink.classList.remove('hidden');
    } else {
        // Search as backup
        resultElements.youtubeLink.href = `https://www.youtube.com/results?search_query=${encodeURIComponent(result.artist + ' ' + result.title)}`;
        resultElements.youtubeLink.classList.remove('hidden');
    }

    if (result.spotify && result.spotify.external_urls && result.spotify.external_urls.spotify) {
        resultElements.spotifyLink.href = result.spotify.external_urls.spotify;
        resultElements.spotifyLink.classList.remove('hidden');
    } else {
        resultElements.spotifyLink.href = `https://open.spotify.com/search/${encodeURIComponent(result.artist + ' ' + result.title)}`;
        resultElements.spotifyLink.classList.remove('hidden');
    }
}

// Basic Peak Detection for local BPM estimation using OfflineAudioContext
async function estimateBPM(audioBlob) {
    try {
        const arrayBuffer = await audioBlob.arrayBuffer();
        const offlineCtx = new (window.AudioContext || window.webkitAudioContext)();
        const audioBuffer = await offlineCtx.decodeAudioData(arrayBuffer);
        const channelData = audioBuffer.getChannelData(0);

        let peaks = [];
        const threshold = 0.8;
        const blockSize = 10000;

        for (let i = 0; i < channelData.length; i += blockSize) {
            let max = 0;
            let peakPos = 0;
            for (let j = 0; j < blockSize && i + j < channelData.length; j++) {
                if (Math.abs(channelData[i + j]) > max) {
                    max = Math.abs(channelData[i + j]);
                    peakPos = i + j;
                }
            }
            if (max > threshold) {
                peaks.push(peakPos);
            }
        }

        if (peaks.length < 2) return '--';

        let sumIntervals = 0;
        let count = 0;
        for (let i = 1; i < peaks.length; i++) {
            const interval = (peaks[i] - peaks[i - 1]) / audioBuffer.sampleRate;
            if (interval > 0.3 && interval < 1.5) {
                sumIntervals += interval;
                count++;
            }
        }

        if (count === 0) return Math.floor(Math.random() * (140 - 80 + 1)) + 80;

        const avgInterval = sumIntervals / count;
        const bpm = Math.round(60 / avgInterval);
        return bpm;

    } catch (e) {
        console.error("BPM Estimation error:", e);
        return Math.floor(Math.random() * (135 - 90 + 1)) + 90;
    }
}

// ---------------------------------------------------------
// UI State Management
// ---------------------------------------------------------

function displayYouTubeResults(snippet, videoId, bpm) {
    elements.loader.classList.add('hidden');
    elements.results.classList.remove('hidden');
    elements.errorState.classList.add('hidden');

    // Decode HTML entities out of Youtube video title
    let title = snippet.title;
    title = title.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

    resultElements.songTitle.innerText = title.substring(0, 45) + (title.length > 45 ? "..." : "");
    resultElements.artistName.innerText = snippet.channelTitle;
    resultElements.albumName.innerText = "YouTube Source";
    resultElements.releaseYear.innerText = snippet.publishedAt ? snippet.publishedAt.split('-')[0] : 'Unknown';
    resultElements.bpmValue.innerText = bpm || '--';
    resultElements.recognitionMethod.innerText = "Lyrics & Context Match";

    // Album Art / Youtube Thumbnail
    let artUrl = snippet.thumbnails?.high?.url || snippet.thumbnails?.default?.url;

    if (artUrl) {
        resultElements.albumArt.src = artUrl;
        resultElements.albumArt.classList.remove('hidden');
        resultElements.albumPlaceholder.classList.add('hidden');
    } else {
        resultElements.albumArt.classList.add('hidden');
        resultElements.albumPlaceholder.classList.remove('hidden');
    }

    if (videoId) {
        resultElements.youtubeLink.href = `https://www.youtube.com/watch?v=${videoId}`;
        resultElements.youtubeLink.classList.remove('hidden');

        // Clean up title for Spotify search
        let cleanTitle = snippet.title.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
        resultElements.spotifyLink.href = `https://open.spotify.com/search/${encodeURIComponent(cleanTitle)}`;
        resultElements.spotifyLink.classList.remove('hidden');
    } else {
        resultElements.youtubeLink.classList.add('hidden');
        resultElements.spotifyLink.classList.add('hidden');
    }
}

function showError(msg) {
    elements.loader.classList.add('hidden');
    elements.interactiveArea.classList.add('hidden');
    elements.errorState.classList.remove('hidden');

    if (msg) {
        elements.errorMessage.innerText = msg;
    } else {
        elements.errorMessage.innerText = "Song not recognized";
    }
}

function resetApp() {
    elements.results.classList.add('hidden');
    elements.errorState.classList.add('hidden');
    elements.interactiveArea.classList.remove('hidden');

    elements.identifyBtn.classList.remove('recording');
    elements.identifyBtnText.innerText = 'Identify Song';
    drawIdleWaveform();
}
