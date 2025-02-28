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
    getMuteStatus,
    setMuteStatus
} from './db.js';
import fetch from 'node-fetch';
import 'dotenv/config';

const token = process.env.BOT_TOKEN;
if (!token) {
    console.error('BOT_TOKEN не найден в .env файле');
    process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });
console.log('Бот запущен!');

const chatContext = {};

// Общая функция для отправки сообщений с учетом настроек звука
async function sendMessageWithMute(chatId, text, options = {}) {
    const mute = await getMuteStatus(chatId);
    return bot.sendMessage(chatId, text, {
        ...options,
        disable_notification: mute
    });
}

async function createMainKeyboard(chatId) {
    const mute = await getMuteStatus(chatId);
    return {
        reply_markup: {
            keyboard: [
                [{ text: 'Получить цитату' }, { text: 'Сохранить цитату' }],
                [{ text: 'Мои цитаты' }, { text: 'Показать категорию' }, { text: 'Поиск текста' }],
                [{ text: mute ? '🔔 Включить звук' : '🔕 Отключить звук' }]
            ],
            resize_keyboard: true
        }
    };
}

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

// Обновленные функции создания клавиатур с учетом звука
async function createCategoryKeyboard(chatId) {
    const rows = await runQuery(`SELECT name FROM categories`);
    const mute = await getMuteStatus(chatId);

    if (rows.length === 0) {
        return {
            reply_markup: {
                inline_keyboard: [[{ text: 'Категории отсутствуют', callback_data: 'no_categories' }]]
            }
        };
    }

    const keyboard = { reply_markup: { inline_keyboard: [] } };
    let rowButtons = [];

    rows.forEach((row, index) => {
        rowButtons.push({
            text: row.name,
            callback_data: `myquotes_category_${row.name}`
        });

        if ((index + 1) % 3 === 0 || index === rows.length - 1) {
            keyboard.reply_markup.inline_keyboard.push(rowButtons);
            rowButtons = [];
        }
    });

    return keyboard;
}

async function createShowCategoryKeyboard() {
    const rows = await runQuery(`SELECT name FROM categories`);
    if (rows.length === 0) {
        return {
            reply_markup: {
                inline_keyboard: [[{ text: 'Категории отсутствуют', callback_data: 'no_categories' }]]
            }
        };
    }
    const keyboard = { reply_markup: { inline_keyboard: [] } };
    let rowButtons = [];
    rows.forEach((row, index) => {
        rowButtons.push({ text: row.name, callback_data: `showcategory_category_${row.name}` });
        if ((index + 1) % 3 === 0 || index === rows.length - 1) {
            keyboard.reply_markup.inline_keyboard.push(rowButtons);
            rowButtons = [];
        }
    });
    return keyboard;
}

async function createSaveQuoteCategoryKeyboard() {
    const rows = await runQuery(`SELECT name FROM categories`);
    if (rows.length === 0) {
        return {
            reply_markup: {
                inline_keyboard: [[{ text: 'Категории отсутствуют', callback_data: 'no_categories' }]]
            }
        };
    }
    const keyboard = { reply_markup: { inline_keyboard: [] } };
    let rowButtons = [];
    rows.forEach((row, index) => {
        rowButtons.push({ text: row.name, callback_data: `savequote_category_${row.name}` });
        if ((index + 1) % 3 === 0 || index === rows.length - 1) {
            keyboard.reply_markup.inline_keyboard.push(rowButtons);
            rowButtons = [];
        }
    });
    return keyboard;
}

// Получение случайной цитаты из внешнего API
async function getQuote() {
    try {
        const response = await fetch('http://api.forismatic.com/api/1.0/?method=getQuote&format=json&lang=ru');
        const data = await response.json();
        return `"${data.quoteText}" - ${data.quoteAuthor || 'Неизвестный автор'}`;
    } catch (error) {
        console.error('Ошибка при получении цитаты из forismatic.com:', error.message);
        return 'Не удалось получить цитату.';
    }
}

// Обработчик команды /start с учетом звука
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const welcomeMessage = `Привет!\n\nС этим ботом ты станешь умнее!\nНо это не точно))`;

    await sendMessageWithMute(
        chatId,
        welcomeMessage,
        await createMainKeyboard(chatId)
    );
});

// Главный обработчик сообщений
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const messageText = msg.text;

    if (messageText === '🔔 Включить звук' || messageText === '🔕 Отключить звук') {
        const mute = messageText === '🔕 Отключить звук';
        await setMuteStatus(chatId, mute);
        const mainKeyboard = await createMainKeyboard(chatId);
        await sendMessageWithMute(
            chatId,
            mute ? '🔇 Уведомления отключены.' : '🔊 Уведомления включены.',
            mainKeyboard
        );
        return;
    }

    if (messageText === 'Получить цитату') {
        try {
            const quote = await getQuote();
            await sendMessageWithMute(
                chatId,
                quote,
                createQuoteKeyboard()
            );
        } catch (error) {
            await sendMessageWithMute(chatId, 'Произошла ошибка при получении цитаты.');
        }
        return;
    }

    if (messageText === 'Сохранить цитату') {
        chatContext[chatId] = { action: 'save_quote' };
        await sendMessageWithMute(chatId, 'Введите текст цитаты:');
        return;
    }

    if (messageText === 'Мои цитаты') {
        try {
            const categoryKeyboard = await createCategoryKeyboard(chatId);
            await sendMessageWithMute(
                chatId,
                'Выберите категорию:',
                categoryKeyboard
            );
        } catch (error) {
            await sendMessageWithMute(chatId, 'Произошла ошибка при загрузке категорий.');
        }
        return;
    }

    if (messageText === 'Показать категорию') {
        try {
            const categoryKeyboard = await createShowCategoryKeyboard();
            await sendMessageWithMute(
                chatId,
                'Выберите категорию:',
                categoryKeyboard
            );
        } catch (error) {
            await sendMessageWithMute(chatId, 'Произошла ошибка при загрузке категорий.');
        }
        return;
    }

    if (messageText === 'Поиск текста') {
        await sendMessageWithMute(chatId, 'Введите текст для поиска:');
        chatContext[chatId] = { action: 'search_text' };
        return;
    }

    if (msg.text && !msg.entities) {
        if (chatContext[chatId]?.action === 'save_quote') {
            chatContext[chatId].quoteText = msg.text;
            try {
                const categoryKeyboard = await createSaveQuoteCategoryKeyboard();
                await sendMessageWithMute(
                    chatId,
                    'Выберите категорию для сохранения цитаты:',
                    categoryKeyboard
                );
            } catch (error) {
                await sendMessageWithMute(chatId, 'Произошла ошибка при загрузке категорий.');
                delete chatContext[chatId];
            }
            return;
        }

        if (chatContext[chatId]?.action === 'search_text') {
            try {
                const results = await searchQuotesWithPagination(messageText, 10, 0);
                if (results.length > 0) {
                    const response = results
                        .map((result, index) => `${index + 1}. ${result}\n---\n`)
                        .join('\n');
                    await sendMessageWithMute(chatId, `Результаты поиска:\n${response}`);
                } else {
                    await sendMessageWithMute(chatId, `Цитат, содержащих "${messageText}", не найдено.`);
                }
            } catch (error) {
                await sendMessageWithMute(chatId, 'Произошла ошибка при поиске. Попробуйте позже.');
            }
            delete chatContext[chatId];
            return;
        }
    }
});

// Обработчик callback-запросов
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;

    // Всегда отвечаем без звука
    await bot.answerCallbackQuery(query.id, {
        show_alert: false,
        cache_time: 0
    });

    // Если пользователь выбирает категорию для просмотра своих цитат
    if (data.startsWith('myquotes_category_')) {
        let category = data.split('myquotes_category_')[1]; // Извлекаем название категории
        let page = 1; // Начальная страница
        if (category.includes('_page:')) {
            const parts = category.split('_page:');
            category = parts[0]; // Извлекаем название категории
            page = parseInt(parts[1], 10); // Извлекаем номер страницы
            if (isNaN(page) || page < 1) page = 1; // Проверяем корректность номера страницы
        }
        const limit = 5; // Кол-во цитат на странице
        const offset = (page - 1) * limit; // Смещение для пагинации

        try {
            const quotes = await getSavedQuotesFromDatabaseWithPagination(chatId, limit, offset, category); // Получаем цитаты по категории и странице
            if (quotes.length === 0) {
                await sendMessageWithMute(chatId, `У вас нет цитат в категории "${category}" (страница ${page}).`); // Если цитат нет, отправляем сообщение об этом
            } else {
                const keyboard = {
                    inline_keyboard: quotes.map(quote => [
                        {
                            text: quote.text.length > 50 ? quote.text.substring(0, 50) + "..." : quote.text, // Форматируем текст цитаты
                            callback_data: `show_quote_${quote.id}` // Устанавливаем callback_data для каждой цитаты
                        }
                    ])
                };

                // Подсчет общего количества цитат для пагинации
                const totalQuotes = await runQuery(
                    `SELECT COUNT(*) as count FROM saved_quotes WHERE chatId = $1 AND category = $2`,
                    [chatId, category]
                );
                const totalCount = totalQuotes[0]?.count || 0;
                const totalPages = Math.ceil(totalCount / limit);

                // Создаем кнопки пагинации
                const paginationButtons = [];
                if (page > 1) {
                    paginationButtons.push({ text: '⬅️ Назад', callback_data: `myquotes_category_${category}_page:${page - 1}` });
                }
                paginationButtons.push({ text: `Стр. ${page} из ${totalPages}`, callback_data: 'dummy' });
                if (page < totalPages) {
                    paginationButtons.push({ text: 'Вперед ➡️', callback_data: `myquotes_category_${category}_page:${page + 1}` });
                }

                if (paginationButtons.length > 0) {
                    keyboard.inline_keyboard.push(paginationButtons); // Добавляем кнопки пагинации в клавиатуру
                }

                // Отправляем список цитат
                await sendMessageWithMute(chatId, `Цитаты в категории "${category}" (страница ${page}):`, { reply_markup: keyboard });
            }
        } catch (error) {
            console.error('Ошибка при получении цитат:', error);
            await sendMessageWithMute(chatId, 'Произошла ошибка при получении цитат.'); // Если произошла ошибка, отправляем сообщение об ошибке
        }
        return;
    }

    // Если пользователь хочет показать цитаты определенной категории без пагинации
    if (data.startsWith('showcategory_category_')) {
        const category = data.split('showcategory_category_')[1]; // Извлекаем название категории
        try {
            const quotes = await getSavedQuotesFromDatabase(category); // Получаем цитаты по категории
            if (quotes.length === 0) {
                await sendMessageWithMute(chatId, `Цитаты в категории "${category}" отсутствуют.`); // Если цитат нет, отправляем сообщение об этом
            } else {
                const response = quotes.map((quote, index) => `${index + 1}. ${quote.text}`).join('\n'); // Форматируем список цитат
                await sendMessageWithMute(chatId, `Цитаты в категории "${category}":\n${response}`); // Отправляем список цитат
            }
        } catch (error) {
            console.error('Ошибка при получении цитат:', error);
            await sendMessageWithMute(chatId, 'Произошла ошибка при получении цитат.'); // Если произошла ошибка, отправляем сообщение об ошибке
        }
        return;
    }


    // Сохранить текущую цитату
    if (data === 'save_quote') {
        const quoteText = query.message.text;
        chatContext[chatId] = { action: 'save_quote', quoteText };
        try {
            const categoryKeyboard = await createSaveQuoteCategoryKeyboard();
            await sendMessageWithMute(
                chatId,
                'Выберите категорию для сохранения цитаты:',
                categoryKeyboard
            );
        } catch (error) {
            console.error('Ошибка при создании клавиатуры категорий:', error);
            await sendMessageWithMute(chatId, 'Произошла ошибка при загрузке категорий.');
            delete chatContext[chatId];
        }
        return;
    }

    // Получить новую цитату
    if (data === 'get_new_quote') {
        try {
            const newQuote = await getQuote();
            await bot.deleteMessage(chatId, messageId);
            await sendMessageWithMute(
                chatId,
                newQuote,
                createQuoteKeyboard()
            );
        } catch (error) {
            await sendMessageWithMute(chatId, 'Произошла ошибка при получении новой цитаты.');
        }
        return;
    }

    // Если пользователь выбирает категорию для сохранения цитаты
    if (data.startsWith('savequote_category_')) {
        const category = data.split('savequote_category_')[1];
        const quoteText = chatContext[chatId]?.quoteText;
        if (quoteText) {
            try {
                await saveQuoteToDatabase(chatId, quoteText, category);
                await sendMessageWithMute(chatId, `Цитата успешно сохранена в категорию "${category}"!`);
            } catch (error) {
                console.error('Ошибка при сохранении цитаты:', error);
                await sendMessageWithMute(chatId, 'Произошла ошибка при сохранении цитаты.');
            }

        } else {
            await sendMessageWithMute(chatId, 'Цитата не найдена. Попробуйте снова.');
        }
        delete chatContext[chatId];
        return;
    }
    // Если пользователь хочет показать конкретную цитату
    else if (data.startsWith('show_quote_')) {
        const quoteId = data.split('show_quote_')[1]; // Извлекаем ID цитаты
        try {
            const quote = await getQuoteById(quoteId); // Получаем цитату по ID
            if (quote) {
                const keyboard = {
                    inline_keyboard: [
                        [
                            { text: 'Редактировать', callback_data: `edit_quote_${quoteId}` }, // Кнопка для редактирования цитаты
                            { text: 'Удалить', callback_data: `delete_quote_${quoteId}` } // Кнопка для удаления цитаты
                        ]
                    ]
                };
                await sendMessageWithMute(chatId, `Цитата: ${quote.text}`, { reply_markup: keyboard }); // Отправляем цитату с кнопками действий
            } else {
                await sendMessageWithMute(chatId, 'Цитата не найдена.'); // Если цитата не найдена, отправляем сообщение об этом
            }
        } catch (error) {
            console.error('Ошибка при получении цитаты:', error);
            await sendMessageWithMute(chatId, 'Произошла ошибка при получении цитаты.'); // Если произошла ошибка, отправляем сообщение об ошибке
        }
        return;
    }

    // Если пользователь хочет удалить цитату
    else if (data.startsWith('delete_quote_')) {
        const quoteId = data.split('delete_quote_')[1]; // Извлекаем ID цитаты
        try {
            await deleteQuoteById(quoteId); // Удаляем цитату
            await sendMessageWithMute(chatId, 'Цитата успешно удалена.'); // Отправляем сообщение об успешном удалении
        } catch (error) {
            console.error('Ошибка при удалении цитаты:', error);
            await sendMessageWithMute(chatId, 'Произошла ошибка при удалении цитаты.'); // Если произошла ошибка, отправляем сообщение об ошибке
        }
        return;
    }

    // Если пользователь хочет отредактировать цитату
    else if (data.startsWith('edit_quote_')) {
        const quoteId = data.split('edit_quote_')[1]; // Извлекаем ID цитаты
        chatContext[chatId] = { action: 'edit_quote', quoteId }; // Устанавливаем состояние "редактирование цитаты"
        await sendMessageWithMute(chatId, 'Введите новый текст для цитаты:'); // Просим пользователя ввести новый текст
        return;
    }
});

// Обработка редактирования цитаты
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    if (chatContext[chatId]?.action === 'edit_quote') {
        const quoteId = chatContext[chatId].quoteId;
        const newText = msg.text;
        try {
            const quote = await getQuoteById(quoteId);
            if (!quote) {
                await sendMessageWithMute(chatId, 'Цитата не найдена.');
                return;
            }
            await updateQuoteById(quoteId, newText, quote.category);
            await sendMessageWithMute(chatId, 'Цитата успешно обновлена!');
        } catch (error) {
            console.error('Ошибка при обновлении цитаты:', error);
            await sendMessageWithMute(chatId, 'Произошла ошибка при обновлении цитаты.');
        } finally {
            delete chatContext[chatId];
        }
        return;
    }
});

// Функция для получения цитат с пагинацией
async function getSavedQuotesFromDatabaseWithPagination(chatId, limit, offset, category = null) {
    let query = `SELECT id, text FROM saved_quotes WHERE chatId = $1`; // Базовый запрос
    const params = [chatId];
    if (category) {
        query += ` AND category = $2`; // Добавляем условие по категории
        params.push(category);
    }
    query += ` LIMIT $3 OFFSET $4`; // Добавляем пагинацию
    params.push(limit, offset);
    const rows = await runQuery(query, params); // Выполняем запрос
    return rows; // Возвращаем результат
}

// Функция для получения всех цитат по категории
async function getSavedQuotesFromDatabase(category) {
    const query = `SELECT text FROM saved_quotes WHERE category = $1`; // Запрос к таблице saved_quotes
    const params = [category];
    const rows = await runQuery(query, params); // Выполняем запрос
    return rows; // Возвращаем результат
}

// Грациозное завершение работы бота
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

async function gracefulShutdown() {
    console.log('Выключение бота...');
    await bot.stopPolling();
    await closeDB();
    console.log('Соединение с базой данных закрыто.');
    process.exit(0);
}
