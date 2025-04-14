let currentState = false; // Переменная для отслеживания состояния реле
let isDarkTheme = false; // Переменная для отслеживания состояния темы

function toggleRelay() {
    const newState = !currentState; // Переключаем состояние реле
    fetch('https://socket-51ad6-default-rtdb.firebaseio.com/relayState.json', { // Замените на ваш Firebase URL
        method: 'PUT', // Используем метод PUT для обновления состояния
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(newState) // Передаем новое состояние
    })
    .then(response => {
        if (response.ok) {
            currentState = newState; // Обновляем состояние
            updateRelayButton(); // Обновляем отображение кнопки
        } else {
            throw new Error('Ошибка запроса');
        }
    })
    .catch(error => {
        console.error('Ошибка:', error);
        document.getElementById("status").innerText = "Ошибка при переключении!";
    });
}

function updateRelayButton() {
    const button = document.getElementById("toggleRelay");
    button.innerText = currentState ? "Включить реле" : "Выключить реле"; // Изменено на противоположное состояние
    button.style.backgroundColor = currentState ? "#f44336" : "#4CAF50"; // Изменены цвета в зависимости от нового состояния
}

function toggleTheme() {
    isDarkTheme = !isDarkTheme; // Переключаем состояние темы
    document.body.classList.toggle("dark-theme", isDarkTheme); // Переключаем тему
    const button = document.getElementById("themeToggle");
    button.innerText = isDarkTheme ? "🌙" : "🌞"; // Изменяем значок на кнопке в зависимости от темы
    
    // Обновляем состояние темы в Firebase
    fetch('https://socket-51ad6-default-rtdb.firebaseio.com/darkMode.json', { // Замените на ваш Firebase URL
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(isDarkTheme) // Передаем новое состояние темы
    })
    .then(response => {
        if (!response.ok) {
            throw new Error('Ошибка обновления темы');
        }
    })
    .catch(error => {
        console.error('Ошибка:', error);
    });
}

// Инициализация
function initialize() {
    // Получаем текущее состояние реле
    fetch('https://socket-51ad6-default-rtdb.firebaseio.com/relayState.json') // Замените на ваш Firebase URL
        .then(response => response.json())
        .then(data => {
            currentState = data === true; // Устанавливаем текущее состояние
            updateRelayButton(); // Обновляем кнопку при загрузке
        });
    
    // Получаем текущее состояние темы
    fetch('https://socket-51ad6-default-rtdb.firebaseio.com/darkMode.json') // Замените на ваш Firebase URL
        .then(response => response.json())
        .then(data => {
            isDarkTheme = data === true; // Устанавливаем текущее состояние темы
            document.body.classList.toggle("dark-theme", isDarkTheme); // Применяем тему
            const button = document.getElementById("themeToggle");
            button.innerText = isDarkTheme ? "🌙" : "🌞"; // Устанавливаем значок темы
        });
}

// Запускаем инициализацию
initialize();
