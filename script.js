// Конфигурация Firebase
const firebaseConfig = {
    apiKey: "AIzaSyBvWZ4M5g7zv4Qj7XQv7JvZQl7n8Z8qX0w",
    authDomain: "socket-51ad6.firebaseapp.com",
    databaseURL: "https://socket-51ad6-default-rtdb.firebaseio.com",
    projectId: "socket-51ad6",
    storageBucket: "socket-51ad6.appspot.com",
    messagingSenderId: "1098867434860",
    appId: "1:1098867434860:web:8a9ef96e0ac9c7d5fbsvc"
};

// Константы приложения
const DEVICE_IP = '192.168.100.81';
const CHECK_INTERVAL = 60000; // 1 минута вместо 5
const STATUS_CHECK_TIMEOUT = 5000; // 5 секунд
const DEVICE_ID_KEY = 'deviceId';
const THEME_KEY = (id) => `theme_${id}`;

// Инициализация Firebase
const app = firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const auth = firebase.auth();

// Глобальные переменные
let sessionsChart = null;
let sessionTimer = null;
let statusCheckInterval = null;
let isDeviceOnline = false;
let wasDeviceOffline = false;
let sessionStartTime = null;
let lastRelayStateBeforeDisconnect = false;
let lastRelayState = false;


// Генерация ID устройства
function getDeviceId() {
    let deviceId = localStorage.getItem(DEVICE_ID_KEY);
    if (!deviceId) {
        deviceId = `device_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        localStorage.setItem(DEVICE_ID_KEY, deviceId);
    }
    return deviceId;
}

// Проверка состояния устройства
async function checkDeviceOnline() {
    const wasOnline = isDeviceOnline;
    
    try {
        const response = await fetch(`http://${DEVICE_IP}/status`, {
            method: 'GET',
            mode: 'no-cors'
        });
        isDeviceOnline = true;
        
        return true;
    } catch {
        isDeviceOnline = false;
        if (wasOnline) {
            lastRelayStateBeforeDisconnect = (await db.ref('relayState').once('value')).val();
            await db.ref('relayState').set(false);
        }
        return false;
    } finally {
        updateStatusUI();
    }
}
async function fetchWithTimeout(url, timeout) {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        
        const response = await fetch(url, {
            method: 'GET',
            mode: 'no-cors',
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        return true;
    } catch {
        return false;
    }
}

function pingWithImage(ip, timeout) {
    return new Promise((resolve) => {
        const img = new Image();
        img.src = `http://${ip}/status?t=${Date.now()}`;
        
        const timer = setTimeout(() => {
            img.onload = img.onerror = null;
            resolve(false);
        }, timeout);

        img.onload = () => {
            clearTimeout(timer);
            resolve(true);
        };
        
        img.onerror = () => {
            clearTimeout(timer);
            resolve(false);
        };
    });
}

// Обновление интерфейса статуса
// Обновленная функция updateStatusUI
function updateStatusUI() {
    const statusElement = document.getElementById('statusText');
    const toggleBtn = document.getElementById('toggleRelay');

    if (!statusElement || !toggleBtn) return;

    // Базовые стили для статуса
    statusElement.style.cssText = `
        font-size: 28px;
        padding: 15px 40px;
        border-radius: 35px;
        margin: 25px 0;
        display: inline-block;
        box-shadow: 0 4px 15px rgba(0,0,0,0.2);
        transition: all 0.3s ease;
    `;

    if (isDeviceOnline) {
        statusElement.textContent = "ОНЛАЙН";
        statusElement.style.backgroundColor = "#2ecc71"; // Ярко-зеленый
        statusElement.style.color = "white";
        toggleBtn.disabled = false;
    } else {
        statusElement.textContent = "ОФЛАЙН";
        statusElement.style.backgroundColor = "#e74c3c"; // Ярко-красный
        statusElement.style.color = "white";
        toggleBtn.disabled = true;
    }
}

// Управление проверками статуса
function manageStatusChecks() {
    if (statusCheckInterval) clearInterval(statusCheckInterval);

    statusCheckInterval = setInterval(async () => {
        try {
            const isOnline = await checkDeviceOnline();
            isDeviceOnline = isOnline;
            updateStatusUI();

            if (!isOnline) {
                await db.ref('relayState').set(false);
                clearInterval(sessionTimer);
                updateSessionTimer(null);
            }
        } catch (error) {
            console.error('Ошибка проверки статуса:', error);
        }
    }, 15000);
}

// Обновление статуса устройства
async function updateDeviceStatus() {
    const wasOnline = isDeviceOnline;
    isDeviceOnline = await checkDeviceOnline();

    if (wasOnline !== isDeviceOnline) {
        if (!isDeviceOnline) {
            // Сохраняем состояние перед отключением
            lastRelayState = (await db.ref('relayState').once('value')).val();
            await forceDeactivate();
        } else {
            // Автовосстановление состояния
            if (autoReconnect && lastRelayState) {
                await db.ref('relayState').set(true);
            }
        }
        updateStatusUI();
    }
}

function handleRelayStateChange(isActive) {
    if (isActive) {
        sessionStartTime = Date.now();
        startNewSession();
    } else {
        endCurrentSession();
        sessionStartTime = null;
    }
}

// Принудительное отключение
async function forceDeactivate() {
    try {
        await db.ref('relayState').set(false);
        clearInterval(sessionTimer);
        updateSessionTimer(null);
    } catch (error) {
        console.error('Ошибка принудительного отключения:', error);
    }
}

// Инициализация приложения
function initialize() {
    // Проверка подключения Firebase
    db.ref('.info/connected').on('value', (snapshot) => {
        console.log(snapshot.val() ? 'Firebase подключен' : 'Firebase отключен');
    });

    // Первоначальная проверка устройства
    checkDeviceOnline().then(online => {
        console.log('Начальный статус устройства:', online ? 'Online' : 'Offline');
        isDeviceOnline = online;
        updateStatusUI();
    });

    db.ref('currentSession').once('value').then(snapshot => {
    if (snapshot.exists()) {
        sessionStartTime = snapshot.val();
        updateSessionTimer();
    }
    });

    // Обработчик авторизации
    auth.onAuthStateChanged(user => {
        const themeKey = user ? THEME_KEY(user.uid) : THEME_KEY(getDeviceId());
        const savedTheme = localStorage.getItem(themeKey) || 'light';
        applyTheme(savedTheme);
    });

    initChart();
    setupRealTimeListeners();
    setupEventHandlers();
    
    // Периодическая проверка статуса
    setInterval(updateSessionTimer, 1000);
    
    // Основные проверки каждые 10 секунд
    setInterval(() => {
        updateDeviceStatus().catch(console.error);
    }, 10000);

    // Основные проверки
    setInterval(() => {
        checkDeviceOnline().then(online => {
            isDeviceOnline = online;
            updateStatusUI();
        });
    }, CHECK_INTERVAL);
}

// Обработчики событий UI
// Обработчики событий UI
function setupEventHandlers() {
    // Обработчик кнопки переключения реле
    const toggleButton = document.getElementById('toggleRelay');
    if (toggleButton) {
        toggleButton.addEventListener('click', async () => {
            if (!isDeviceOnline) {
                alert('Устройство недоступно!');
                return;
            }
            
            try {
                const newState = !(await db.ref('relayState').once('value')).val();
                await db.ref('relayState').set(newState);
            } catch (error) {
                console.error('Ошибка переключения:', error);
                alert('Ошибка переключения!');
            }
        });
    }

    // Обработчик переключения темы
    const themeButton = document.getElementById('themeToggle');
    if (themeButton) {
        themeButton.addEventListener('click', toggleTheme);
    }

    const checkBtn = document.getElementById('checkConnectionBtn');
    if (checkBtn) {
        checkBtn.addEventListener('click', async () => {
            try {
                checkBtn.disabled = true;
                checkBtn.textContent = 'Проверка...';
                
                const wasOnline = isDeviceOnline;
                isDeviceOnline = await checkDeviceOnline();
                
                if(wasOnline !== isDeviceOnline) {
                    updateStatusUI();
                    showStatusNotification(isDeviceOnline);
                }
                
            } catch(error) {
                console.error('Ошибка проверки:', error);
                showStatusNotification(false);
            } finally {
                checkBtn.disabled = false;
                checkBtn.textContent = 'Проверить сейчас';
            }
        });
    }
}

// Показать уведомление о статусе
function showStatusNotification(isOnline) {
    const notification = document.createElement('div');
    notification.className = `status-notification ${isOnline ? 'online' : 'offline'}`;
    notification.textContent = isOnline 
        ? 'Соединение установлено!' 
        : 'Ошибка соединения!';

    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.remove();
    }, 3000);
}

// Слушатели Firebase
function setupRealTimeListeners() {
    db.ref('relayState').on('value', snapshot => {
        try {
            const isActive = snapshot.val();
            lastRelayStateBeforeDisconnect = isActive; // Всегда сохраняем последнее состояние
            updateRelayButton(isActive);
            handleRelayStateChange(isActive);
        } catch (error) {
            console.error('Ошибка обработки состояния реле:', error);
        }
    });

    db.ref('currentSession').on('value', snapshot => {
    try {
        const startTime = snapshot.val();
        sessionStartTime = startTime; // Сохраняем время начала сессии
        updateSessionTimer(); // Обновляем таймер сразу при изменении
    } catch (error) {
        console.error('Ошибка обработки текущей сессии:', error);
    }
    });

    db.ref('sessions').on('value', snapshot => {
    try {
        const sessions = snapshot.val() || [];
        updateSessionChart(sessions);
        updateTotalTimeDisplay(calculateTotalTime(sessions)); // Здесь передаем число
    } catch (error) {
        console.error('Ошибка обработки истории сессий:', error);
    }
    });
}

// Темная тема
function toggleTheme() {
    try {
        const user = auth.currentUser;
        const themeKey = user ? THEME_KEY(user.uid) : THEME_KEY(getDeviceId());
        const isDark = !document.body.classList.contains("dark-theme");
        const theme = isDark ? 'dark' : 'light';

        localStorage.setItem(themeKey, theme);
        if (user) db.ref(`users/${user.uid}/theme`).set(theme);
        
        applyTheme(theme);
    } catch (error) {
        console.error('Ошибка переключения темы:', error);
    }
}

function applyTheme(theme) {
    try {
        const isDark = theme === 'dark';
        document.body.classList.toggle('dark-theme', isDark);
        document.getElementById('themeToggle').textContent = isDark ? "🌙" : "🌞";

        if (sessionsChart) {
            const textColor = isDark ? '#fff' : '#000';
            const gridColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)';

            sessionsChart.options.scales.x.ticks.color = textColor;
            sessionsChart.options.scales.y.ticks.color = textColor;
            sessionsChart.options.plugins.legend.labels.color = textColor;
            
            sessionsChart.options.scales.x.grid.color = gridColor;
            sessionsChart.options.scales.y.grid.color = gridColor;

            sessionsChart.data.datasets[0].backgroundColor = isDark ? '#4CAF50' : '#388E3C';
            sessionsChart.data.datasets[0].borderColor = isDark ? '#81C784' : '#2E7D32';

            sessionsChart.update();
        }
    } catch (error) {
        console.error('Ошибка применения темы:', error);
    }
}

// График сессий
function initChart() {
    try {
        const ctx = document.getElementById('sessionsChart').getContext('2d');
        const isDark = document.body.classList.contains('dark-theme');
        const textColor = isDark ? '#fff' : '#000';
        const gridColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)';

        sessionsChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: [],
                datasets: [{
                    label: 'Длительность сессий (минуты)',
                    data: [],
                    backgroundColor: isDark ? '#4CAF50' : '#388E3C',
                    borderColor: isDark ? '#81C784' : '#2E7D32',
                    borderWidth: 2,
                    borderRadius: 4,
                    barPercentage: 0.8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            color: textColor,
                            font: { size: 14, family: "'Roboto', sans-serif" },
                            callback: value => `${value} мин`
                        },
                        grid: { color: gridColor, drawBorder: false },
                        title: {
                            display: true,
                            text: 'Длительность',
                            color: textColor,
                            font: { size: 16 }
                        }
                    },
                    x: {
                        ticks: { color: textColor, font: { size: 14, family: "'Roboto', sans-serif" } },
                        grid: { display: false },
                        title: {
                            display: true,
                            text: 'Сессии',
                            color: textColor,
                            font: { size: 16 }
                        }
                    }
                },
                plugins: {
                    legend: {
                        position: 'top',
                        labels: {
                            color: textColor,
                            font: { size: 16, family: "'Roboto', sans-serif" },
                            boxWidth: 20,
                            padding: 15
                        }
                    },
                    tooltip: {
                        backgroundColor: isDark ? '#333' : '#fff',
                        titleColor: isDark ? '#fff' : '#333',
                        bodyColor: isDark ? '#fff' : '#333',
                        borderColor: isDark ? '#666' : '#ddd',
                        borderWidth: 1
                    }
                }
            }
        });
    } catch (error) {
        console.error('Ошибка инициализации графика:', error);
    }
}

// Работа с сессиями
function calculateTotalTime(sessions) {
    return sessions.reduce((total, session) => total + (session.duration || 0), 0);
}

function handleRelayStateChange(isActive) {
    try {
        isActive ? startNewSession() : endCurrentSession();
    } catch (error) {
        console.error('Ошибка изменения состояния реле:', error);
    }
}

function startNewSession() {
    try {
        db.ref('currentSession').set(Date.now());
    } catch (error) {
        console.error('Ошибка старта сессии:', error);
    }
}

function endCurrentSession() {
    db.ref('currentSession').once('value')
        .then(snapshot => {
            const startTime = snapshot.val();
            if (startTime) {
                const duration = Math.floor((Date.now() - startTime) / 1000);
                saveSession(duration);
                db.ref('currentSession').remove();
            }
        })
        .catch(console.error);
}

function saveSession(duration) {
    db.ref('sessions').transaction(sessions => 
        (sessions || []).concat({ duration, timestamp: Date.now() })
    ).catch(console.error);
}

// Обновление интерфейса
function updateRelayButton(isActive) {
    const button = document.getElementById('toggleRelay');
    if (button) {
        button.textContent = isActive ? 'Деактивировать' : 'Активировать';
        button.className = `relay-button ${isActive ? 'on' : 'off'}`;
    }
}

function updateSessionTimer() {
    if (sessionStartTime && isDeviceOnline) {
        const currentTime = Date.now();
        const elapsedSeconds = Math.floor((currentTime - sessionStartTime) / 1000);
        
        const days = Math.floor(elapsedSeconds / 86400);
        const hours = Math.floor((elapsedSeconds % 86400) / 3600)
            .toString().padStart(2, '0');
        const minutes = Math.floor((elapsedSeconds % 3600) / 60)
            .toString().padStart(2, '0');
        const seconds = (elapsedSeconds % 60)
            .toString().padStart(2, '0');

        updateCurrentSessionTimer(
            `${days > 0 ? `${days}d ` : ''}${hours}:${minutes}:${seconds}`
        );
    } else {
        updateCurrentSessionTimer('00:00:00');
    }
}

function updateTotalTimeDisplay(totalSeconds) {
    updateDisplay('totalTime', 'Общее время:', totalSeconds);
}

// function updateDisplay(elementId, prefix, seconds) {
//     const element = document.getElementById(elementId);
//     if (element) {
//         const days = Math.floor(seconds / 86400);
//         const hours = Math.floor((seconds % 86400) / 3600);
//         const minutes = Math.floor((seconds % 3600) / 60);
//         const sec = seconds % 60;
        
//         element.innerHTML = `
//             <span class="time-label">${prefix}</span>
//             <span class="time-value">
//                 ${days}<small>д</small> 
//                 ${hours}<small>ч</small> 
//                 ${minutes}<small>м</small> 
//                 ${sec}<small>с</small>
//             </span>
//         `;
//     }
// }

function updateCurrentSessionTimer(formattedTime) {
    const element = document.getElementById('currentSession');
    if (element) {
        element.innerHTML = `
            <span class="time-label">Текущая сессия:</span>
            <span class="time-value">${formattedTime}</span>
        `;
    }
}
function updateTotalTimeDisplay(totalSeconds) {
    const element = document.getElementById('totalTime');
    if (element) {
        const days = Math.floor(totalSeconds / 86400);
        const hours = Math.floor((totalSeconds % 86400) / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        
        element.innerHTML = `
            <span class="time-label">Общее время:</span>
            <span class="time-value">
                ${days}<small>д</small> 
                ${hours}<small>ч</small> 
                ${minutes}<small>м</small> 
                ${seconds}<small>с</small>
            </span>
        `;
    }
}

function updateSessionChart(sessions) {
    try {
        if (!sessionsChart) {
            console.error('График не инициализирован');
            return;
        }
        
        // Обновляем данные графика
        sessionsChart.data.labels = sessions.map((_, index) => `Сессия ${index + 1}`);
        sessionsChart.data.datasets[0].data = sessions.map(s => 
            Math.round((s.duration / 60) * 10) / 10 // Конвертируем секунды в минуты
        );
        
        // Обновляем график
        sessionsChart.update();
    } catch (error) {
        console.error('Ошибка обновления графика:', error);
    }
}

// Запуск приложения
document.addEventListener('DOMContentLoaded', () => {
    try {
        initialize();
    } catch (error) {
        console.error('Критическая ошибка инициализации:', error);
        alert('Произошла критическая ошибка при запуске приложения!');
    }
});
