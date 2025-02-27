// Импортируем необходимые модули
import TelegramBot from 'node-telegram-bot-api';
import {
    runQuery,
    closeDB,
    getQuoteById,
    deleteQuoteById,
    updateQuoteById,
    searchQuotesWithPagination,
    saveQuoteToDatabase,
    getMuteStatus,
    setMuteStatus
} from './db.js'; // Убедитесь, что путь к db.js правильный
import fetch from 'node-fetch';
import 'dotenv/config';

// Получаем токен бота из переменных окружения
const token = process.env.BOT_TOKEN;
if (!token) {
    console.error('BOT_TOKEN не найден в .env файле');
    process.exit(1); // Выход из программы, если токен отсутствует
}

// Создаем экземпляр бота
const bot = new TelegramBot(token, { polling: true });
console.log('Бот запущен!');

// Контекст чата для временного хранения состояний пользователей
const chatContext = {};

// Обертка для bot.sendMessage
async function sendBotMessage(chatId, text, options = {}) {
    const mute = await getMuteStatus(chatId);
    const mergedOptions = { ...options, disable_notification: mute };
    return bot.sendMessage(chatId, text, mergedOptions);
}

// Обертка для bot.editMessageText
async function editBotMessageText(text, options = {}) {
    const chatId = options.chat_id;  // chatId ОБЯЗАТЕЛЬНО должен быть в options
    if (!chatId) {
        console.error("editBotMessageText: chat_id is required in options!"); // Важная проверка!
        return; // Или выбросить ошибку: throw new Error("...");
    }
    const messageId = options.message_id; // message_id тоже должен быть
    if (!messageId) {
         console.error("editBotMessageText: message_id is required in options!"); // Важная проверка!
        return; // Или выбросить ошибку: throw new Error("...");
    }
    const mute = await getMuteStatus(chatId);
    const mergedOptions = { ...options, disable_notification: mute };
    return bot.editMessageText(text, mergedOptions);
}

// Создание главной клавиатуры
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

// Создание клавиатуры категорий для выбора при просмотре своих цитат (инлайн)
async function createCategoryKeyboard() {
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
        rowButtons.push({ text: row.name, callback_data: `myquotes_category_${row.name}` });
        if ((index + 1) % 3 === 0 || index === rows.length - 1) {
            keyboard.reply_markup.inline_keyboard.push(rowButtons);
            rowButtons = [];
        }
    });
    return keyboard;
}

// Создание клавиатуры категорий для просмотра цитат (инлайн)
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

// Создание клавиатуры категорий для сохранения цитат (инлайн)
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

// Обработчик команды /start
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const welcomeMessage = `
Привет!

С этим ботом ты станешь умнее!
Но это не точно))
`;
    const mainKeyboard = await createMainKeyboard(chatId);
    await sendBotMessage(chatId, welcomeMessage, mainKeyboard);
});

// Основной обработчик сообщений
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const messageText = msg.text;

    // Обработка включения/выключения звука
    if (messageText === '🔔 Включить звук' || messageText === '🔕 Отключить звук') {
        const mute = messageText === '🔕 Отключить звук';
        await setMuteStatus(chatId, mute);
        const mainKeyboard = await createMainKeyboard(chatId);
        await sendBotMessage(chatId, mute ? '🔇 Уведомления отключены.' : '🔊 Уведомления включены.', mainKeyboard);
        return;
    }

    // Получение цитаты
    if (messageText === 'Получить цитату') {
        try {
            const quote = await getQuote();
            await sendBotMessage(chatId, quote, { reply_markup: createQuoteKeyboard().reply_markup });
        } catch (error) {
            console.error('Ошибка при получении цитаты:', error);
            await sendBotMessage(chatId, 'Произошла ошибка при получении цитаты.');
        }
        return;
    }

    // Сохранение цитаты
    if (messageText === 'Сохранить цитату') {
        chatContext[chatId] = { action: 'save_quote' };
        await sendBotMessage(chatId, 'Введите текст цитаты:');
        return;
    }

    // Просмотр своих цитат
    if (messageText === 'Мои цитаты') {
        try {
            const categoryKeyboard = await createCategoryKeyboard();
            await sendBotMessage(chatId, 'Выберите категорию:', categoryKeyboard);
        } catch (error) {
            console.error('Ошибка при создании клавиатуры категорий:', error);
            await sendBotMessage(chatId, 'Произошла ошибка при загрузке категорий.');
        }
        return;
    }

    // Показать категорию (все цитаты в категории)
    if (messageText === 'Показать категорию') {
        try {
            const categoryKeyboard = await createShowCategoryKeyboard();
            await sendBotMessage(chatId, 'Выберите категорию:', categoryKeyboard);
        } catch (error) {
            console.error('Ошибка при создании клавиатуры категорий:', error);
            await sendBotMessage(chatId, 'Произошла ошибка при загрузке категорий.');
        }
        return;
    }

    // Поиск текста
    if (messageText === 'Поиск текста') {
        await sendBotMessage(chatId, 'Введите текст для поиска:');
        chatContext[chatId] = { action: 'search_text' };
        return;
    }

    // Обработка текста, введенного пользователем
    if (msg.text && !msg.entities) {
        // Сохранение цитаты
        if (chatContext[chatId]?.action === 'save_quote') {
            chatContext[chatId].quoteText = msg.text;
            try {
                const categoryKeyboard = await createSaveQuoteCategoryKeyboard();
                await sendBotMessage(chatId, 'Выберите категорию для сохранения цитаты:', categoryKeyboard);
            } catch (error) {
                console.error('Ошибка при создании клавиатуры категорий:', error);
                await sendBotMessage(chatId, 'Произошла ошибка при загрузке категорий.');
                delete chatContext[chatId];
            }
            return;
        }

        // Поиск текста
        if (chatContext[chatId]?.action === 'search_text') {
            try {
                console.log(`Пользователь ${chatId} ищет текст: "${messageText}"`);
                const results = await searchQuotesWithPagination(messageText, 10, 0);
                if (results.length > 0) {
                    const response = results
                        .map((result, index) => `${index + 1}. ${result}\n---\n`)
                        .join('\n');
                    await sendBotMessage(chatId, `Результаты поиска:\n${response}`, { parse_mode: 'HTML' });
                } else {
                    await sendBotMessage(chatId, `Цитат, содержащих "${messageText}", не найдено.`);
                }
            } catch (error) {
                console.error('Ошибка при поиске цитат:', error);
                await sendBotMessage(chatId, 'Произошла ошибка при поиске. Попробуйте позже.');
            }
            delete chatContext[chatId];
            return;
        }
    }
});

// Обработчик callback-запросов (действия с инлайн-клавиатурой)
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;

    // Если пользователь выбирает категорию для просмотра своих цитат
    if (data.startsWith('myquotes_category_')) {
        let category = data.split('myquotes_category_')[1];
        let page = 1;
        if (category.includes('_page:')) {
            const parts = category.split('_page:');
            category = parts[0];
            page = parseInt(parts[1], 10);
            if (isNaN(page) || page < 1) page = 1;
        }
        const limit = 5;
        const offset = (page - 1) * limit;

        try {
            const quotes = await getSavedQuotesFromDatabaseWithPagination(chatId, limit, offset, category);
            if (quotes.length === 0) {
                await sendBotMessage(chatId, `У вас нет цитат в категории "${category}" (страница ${page}).`);
            } else {
                const keyboard = {
                    inline_keyboard: quotes.map(quote => [
                        {
                            text: quote.text.length > 50 ? quote.text.substring(0, 50) + "..." : quote.text,
                            callback_data: `show_quote_${quote.id}`
                        }
                    ])
                };

                const totalQuotes = await runQuery(
                    `SELECT COUNT(*) as count FROM saved_quotes WHERE chatId = $1 AND category = $2`,
                    [chatId, category]
                );
                const totalCount = totalQuotes[0]?.count || 0;
                const totalPages = Math.ceil(totalCount / limit);

                const paginationButtons = [];
                if (page > 1) {
                    paginationButtons.push({ text: '⬅️ Назад', callback_data: `myquotes_category_${category}_page:${page - 1}` });
                }
                paginationButtons.push({ text: `Стр. ${page} из ${totalPages}`, callback_data: 'dummy' });
                if (page < totalPages) {
                    paginationButtons.push({ text: 'Вперед ➡️', callback_data: `myquotes_category_${category}_page:${page + 1}` });
                }

                if (paginationButtons.length > 0) {
                    keyboard.inline_keyboard.push(paginationButtons);
                }

                await sendBotMessage(chatId, `Цитаты в категории "${category}" (страница ${page}):`, { reply_markup: keyboard });
            }
        } catch (error) {
            console.error('Ошибка при получении цитат:', error);
            await sendBotMessage(chatId, 'Произошла ошибка при получении цитат.');
        }
        bot.answerCallbackQuery(query.id);
        return;
    }

    // Если пользователь хочет показать цитаты определенной категории без пагинации
    if (data.startsWith('showcategory_category_')) {
        const category = data.split('showcategory_category_')[1];
        try {
            const quotes = await getSavedQuotesFromDatabase(category);
            if (quotes.length === 0) {
                await sendBotMessage(chatId, `Цитаты в категории "${category}" отсутствуют.`);
            } else {
                const response = quotes.map((quote, index) => `${index + 1}. ${quote.text}`).join('\n');
                await sendBotMessage(chatId, `Цитаты в категории "${category}":\n${response}`);
            }
        } catch (error) {
            console.error('Ошибка при получении цитат:', error);
            await sendBotMessage(chatId, 'Произошла ошибка при получении цитат.');
        }
        bot.answerCallbackQuery(query.id);
        return;
    }

    // Сохранить текущую цитату
    if (data === 'save_quote') {
        const quoteText = query.message.text;
        chatContext[chatId] = { action: 'save_quote', quoteText };
        try {
            const categoryKeyboard = await createSaveQuoteCategoryKeyboard();
            await sendBotMessage(chatId, 'Выберите категорию для сохранения цитаты:', categoryKeyboard);
        } catch (error) {
            console.error('Ошибка при создании клавиатуры категорий:', error);
            await sendBotMessage(chatId, 'Произошла ошибка при загрузке категорий.');
            delete chatContext[chatId];
        }
        bot.answerCallbackQuery(query.id);
        return;
    }

    // Получить новую цитату
    if (data === 'get_new_quote') {
        try {
            const newQuote = await getQuote();
            await editBotMessageText(newQuote, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: createQuoteKeyboard().reply_markup
            });
        } catch (error) {
            console.error('Ошибка при получении новой цитаты:', error);
            await sendBotMessage(chatId, 'Произошла ошибка при получении новой цитаты.');
        }
        bot.answerCallbackQuery(query.id);
        return;
    }

    // Если пользователь выбирает категорию для сохранения цитаты
    if (data.startsWith('savequote_category_')) {
        const category = data.split('savequote_category_')[1];
        const quoteText = chatContext[chatId]?.quoteText;
        if (quoteText) {
            try {
                await saveQuoteToDatabase(chatId, quoteText, category);
                await sendBotMessage(chatId, `Цитата успешно сохранена в категорию "${category}"!`);
            } catch (error) {
                console.error('Ошибка при сохранении цитаты:', error);
                await sendBotMessage(chatId, 'Произошла ошибка при сохранении цитаты.');
            }

        } else {
            await sendBotMessage(chatId, 'Цитата не найдена. Попробуйте снова.');
        }
        delete chatContext[chatId];
        bot.answerCallbackQuery(query.id);
        return;
    }

    // Если пользователь хочет показать конкретную цитату
    else if (data.startsWith('show_quote_')) {
        const quoteId = data.split('show_quote_')[1];
        try {
            const quote = await getQuoteById(quoteId);
            if (quote) {
                const keyboard = {
                    inline_keyboard: [
                        [
                            { text: 'Редактировать', callback_data: `edit_quote_${quoteId}` },
                            { text: 'Удалить', callback_data: `delete_quote_${quoteId}` }
                        ]
                    ]
                };
                await sendBotMessage(chatId, `Цитата: ${quote.text}`, { reply_markup: keyboard });
            } else {
                await sendBotMessage(chatId, 'Цитата не найдена.');
            }
        } catch (error) {
            console.error('Ошибка при получении цитаты:', error);
            await sendBotMessage(chatId, 'Произошла ошибка при получении цитаты.');
        }
        bot.answerCallbackQuery(query.id);
        return;
    }

    // Если пользователь хочет удалить цитату
    else if (data.startsWith('delete_quote_')) {
        const quoteId = data.split('delete_quote_')[1];
        try {
            await deleteQuoteById(quoteId);
            await sendBotMessage(chatId, 'Цитата успешно удалена.');
        } catch (error) {
            console.error('Ошибка при удалении цитаты:', error);
            await sendBotMessage(chatId, 'Произошла ошибка при удалении цитаты.');
        }
        bot.answerCallbackQuery(query.id);
        return;
    }

    // Если пользователь хочет отредактировать цитату
    else if (data.startsWith('edit_quote_')) {
        const quoteId = data.split('edit_quote_')[1];
        chatContext[chatId] = { action: 'edit_quote', quoteId };
        await sendBotMessage(chatId, 'Введите новый текст для цитаты:');
        bot.answerCallbackQuery(query.id);
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
                await sendBotMessage(chatId, 'Цитата не найдена.');
                return;
            }
            await updateQuoteById(quoteId, newText, quote.category);
            await sendBotMessage(chatId, 'Цитата успешно обновлена!');
        } catch (error) {
            console.error('Ошибка при обновлении цитаты:', error);
            await sendBotMessage(chatId, 'Произошла ошибка при обновлении цитаты.');
        } finally {
            delete chatContext[chatId];
        }
        return;
    }
});

// Функция для получения цитат с пагинацией
async function getSavedQuotesFromDatabaseWithPagination(chatId, limit, offset, category = null) {
    let query = `SELECT id, text FROM saved_quotes WHERE chatId = $1`;
    const params = [chatId];
    if (category) {
        query += ` AND category = $2`;
        params.push(category);
    }
    query += ` LIMIT $3 OFFSET $4`;
    params.push(limit, offset);
    const rows = await runQuery(query, params);
    return rows;
}

// Функция для получения всех цитат по категории
async function getSavedQuotesFromDatabase(category) {
    const query = `SELECT text FROM saved_quotes WHERE category = $1`;
    const params = [category];
    const rows = await runQuery(query, params);
    return rows;
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
