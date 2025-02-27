
// Импортируем необходимые модули
import TelegramBot from 'node-telegram-bot-api';
import {
    runQuery,              
    runCommand,            
    closeDB,               
    getQuoteById,          
    deleteQuoteById,       
    updateQuoteById,       
    searchQuotesWithPagination, 
    saveQuoteToDatabase,   
    getMuteStatus,         // NEW: Импорт функции статуса звука
    setMuteStatus          // NEW: Импорт функции установки звука
} from './db.js';
import fetch from 'node-fetch';
import 'dotenv/config';          

// Получаем токен бота из переменных окружения
const token = process.env.BOT_TOKEN;
if (!token) {
    console.error('BOT_TOKEN не найден в .env файле');
    process.exit(1);
}

// Создаем экземпляр бота
const bot = new TelegramBot(token, { polling: true });
console.log('Бот запущен!');

// Контекст чата для временного хранения состояний пользователей
const chatContext = {};

// NEW: Универсальная функция отправки сообщений с учетом настроек звука
async function sendMessageWithMute(chatId, text, options = {}) {
    const mute = await getMuteStatus(chatId);
    return bot.sendMessage(chatId, text, { 
        ...options, 
        disable_notification: mute 
    });
}

// Создание главной клавиатуры
async function createMainKeyboard(chatId) {
    const mute = await getMuteStatus(chatId); // NEW: Получаем текущий статус
    return {
        reply_markup: {
            keyboard: [
                [{ text: 'Получить цитату' }, { text: 'Сохранить цитату' }],
                [{ text: 'Мои цитаты' }, { text: 'Показать категорию' }, { text: 'Поиск текста' }],
                [{ text: mute ? '🔔 Включить звук' : '🔕 Отключить звук' }] // NEW: Динамическая кнопка
            ],
            resize_keyboard: true
        }
    };
}

// Создание клавиатуры для действий с цитатами (инлайн)
function createQuoteKeyboard() {
    return {
        reply_markup: {
            inline_keyboard: [
                [{ text: 'Сохранить цитату', callback_data: 'save_quote' }],
                [{ text: 'Получить новую цитату', callback_data: 'get_new_quote' }]
            ]
        }
    };
}

// ... (Все остальные функции создания клавиатур остаются без изменений)

// Получение случайной цитаты из внешнего API
async function getQuote() {
    try {
        const response = await fetch('http://api.forismatic.com/api/1.0/?method=getQuote&format=json&lang=ru');
        const data = await response.json();
        return `"${data.quoteText}" - ${data.quoteAuthor || 'Неизвестный автор'}`;
    } catch (error) {
        console.error('Ошибка при получении цитаты:', error.message);
        return 'Не удалось получить цитату.';
    }
}

// Обработчик команды /start
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const mainKeyboard = await createMainKeyboard(chatId);
    await sendMessageWithMute( // NEW: Используем универсальную функцию
        chatId,
        `Привет!\n\nС этим ботом ты станешь умнее!\nНо это не точно))`,
        mainKeyboard
    );
});

// Основной обработчик сообщений
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const messageText = msg.text;

    // Обработка звука
    if (messageText === '🔔 Включить звук' || messageText === '🔕 Отключить звук') {
        const mute = messageText === '🔕 Отключить звук';
        await setMuteStatus(chatId, mute);
        const mainKeyboard = await createMainKeyboard(chatId);
        await sendMessageWithMute( // NEW: Универсальная функция
            chatId, 
            mute ? '🔇 Уведомления отключены.' : '🔊 Уведомления включены.',
            mainKeyboard
        );
        return;
    }

    // Получение цитаты
    if (messageText === 'Получить цитату') {
        try {
            const quote = await getQuote();
            await sendMessageWithMute( // NEW: Универсальная функция
                chatId,
                quote,
                { reply_markup: createQuoteKeyboard().reply_markup }
            );
        } catch (error) {
            await sendMessageWithMute(chatId, 'Произошла ошибка при получении цитаты.');
        }
        return;
    }

    // Сохранение цитаты
    if (messageText === 'Сохранить цитату') {
        chatContext[chatId] = { action: 'save_quote' };
        await sendMessageWithMute(chatId, 'Введите текст цитаты:');
        return;
    }

    // Просмотр своих цитат
    if (messageText === 'Мои цитаты') {
        try {
            const categoryKeyboard = await createCategoryKeyboard();
            await sendMessageWithMute( // NEW: Универсальная функция
                chatId,
                'Выберите категорию:',
                categoryKeyboard
            );
        } catch (error) {
            await sendMessageWithMute(chatId, 'Ошибка загрузки категорий.');
        }
        return;
    }

    // Показать категорию
    if (messageText === 'Показать категорию') {
        try {
            const categoryKeyboard = await createShowCategoryKeyboard();
            await sendMessageWithMute( // NEW: Универсальная функция
                chatId,
                'Выберите категорию:',
                categoryKeyboard
            );
        } catch (error) {
            await sendMessageWithMute(chatId, 'Ошибка загрузки категорий.');
        }
        return;
    }

    // Поиск текста
    if (messageText === 'Поиск текста') {
        await sendMessageWithMute(chatId, 'Введите текст для поиска:');
        chatContext[chatId] = { action: 'search_text' };
        return;
    }

    // Обработка текста
    if (msg.text && !msg.entities) {
        // ... (существующая логика обработки с использованием sendMessageWithMute)
    }
});

// Обработчик callback-запросов
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;

    // NEW: Универсальная обработка всех ответов
    const respond = async (text, options = {}) => {
        await sendMessageWithMute(chatId, text, options);
        bot.answerCallbackQuery(query.id);
    };

    // Сохранение цитаты
    if (data.startsWith('savequote_category_')) {
        // ... (существующая логика)
        await respond(`Цитата сохранена в категорию "${category}"!`);
        return;
    }

    // Удаление цитаты
    if (data.startsWith('delete_quote_')) {
        // ... (существующая логика)
        await respond('Цитата успешно удалена!');
        return;
    }

    // ... (все остальные callback-обработчики с использованием respond())
});

// ... (Все остальные функции: пагинация, редактирование, graceful shutdown)

process.on('SIGINT', async () => {
    console.log('Выключение бота...');
    await bot.stopPolling();
    await closeDB();
    process.exit(0);
});
