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
    await bot.sendMessage(chatId, welcomeMessage, mainKeyboard);
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
        await bot.sendMessage(chatId, mute ? '🔇 Уведомления отключены.' : '🔊 Уведомления включены.', mainKeyboard);
        return;
    }

    // Получение цитаты
    if (messageText === 'Получить цитату') {
        try {
            const quote = await getQuote();
            const mute = await getMuteStatus(chatId);
            await bot.sendMessage(chatId, quote, { disable_notification: mute, reply_markup: createQuoteKeyboard().reply_markup });
        } catch (error) {
            console.error('Ошибка при получении цитаты:', error);
            await bot.sendMessage(chatId, 'Произошла ошибка при получении цитаты.', { disable_notification: true });
        }
        return;
    }

    // Сохранение цитаты
    if (messageText === 'Сохранить цитату') {
        chatContext[chatId] = { action: 'save_quote' };
        const mute = await getMuteStatus(chatId);
        await bot.sendMessage(chatId, 'Введите текст цитаты:', { disable_notification: mute });
        return;
    }

    // Просмотр своих цитат
    if (messageText === 'Мои цитаты') {
        try {
            const categoryKeyboard = await createCategoryKeyboard();
            const mute = await getMuteStatus(chatId);
            await bot.sendMessage(chatId, 'Выберите категорию:', { ...categoryKeyboard.reply_markup, disable_notification: mute });
        } catch (error) {
            console.error('Ошибка при создании клавиатуры категорий:', error);
            const mute = await getMuteStatus(chatId);
            await bot.sendMessage(chatId, 'Произошла ошибка при загрузке категорий.', { disable_notification: mute });
        }
        return;
    }

    // Показать категорию (все цитаты в категории)
    if (messageText === 'Показать категорию') {
        try {
            const categoryKeyboard = await createShowCategoryKeyboard();
            const mute = await getMuteStatus(chatId);
            await bot.sendMessage(chatId, 'Выберите категорию:', { ...categoryKeyboard.reply_markup, disable_notification: mute });
        } catch (error) {
            console.error('Ошибка при создании клавиатуры категорий:', error);
            const mute = await getMuteStatus(chatId);
            await bot.sendMessage(chatId, 'Произошла ошибка при загрузке категорий.', { disable_notification: mute });
        }
        return;
    }

    // Поиск текста
    if (messageText === 'Поиск текста') {
        const mute = await getMuteStatus(chatId);
        await bot.sendMessage(chatId, 'Введите текст для поиска:', { disable_notification: mute });
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
                const mute = await getMuteStatus(chatId);
                await bot.sendMessage(chatId, 'Выберите категорию для сохранения цитаты:', { ...categoryKeyboard.reply_markup, disable_notification: mute });
            } catch (error) {
                console.error('Ошибка при создании клавиатуры категорий:', error);
                const mute = await getMuteStatus(chatId);
                await bot.sendMessage(chatId, 'Произошла ошибка при загрузке категорий.', { disable_notification: mute });
                delete chatContext[chatId];
            }
            return;
        }

        // Поиск текста
        if (chatContext[chatId]?.action === 'search_text') {
            try {
                console.log(`Пользователь ${chatId} ищет текст: "${messageText}"`);
                const results = await searchQuotesWithPagination(messageText, 10, 0);
                const mute = await getMuteStatus(chatId);
                if (results.length > 0) {
                    const response = results
                        .map((result, index) => `${index + 1}. ${result}\n---\n`)
                        .join('\n');
                    await bot.sendMessage(chatId, `Результаты поиска:\n${response}`, { parse_mode: 'HTML', disable_notification: mute });
                } else {
                    await bot.sendMessage(chatId, `Цитат, содержащих "${messageText}", не найдено.`, { disable_notification: mute });
                }
            } catch (error) {
                console.error('Ошибка при поиске цитат:', error);
                const mute = await getMuteStatus(chatId);
                await bot.sendMessage(chatId, 'Произошла ошибка при поиске. Попробуйте позже.', { disable_notification: mute });
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

    const mute = await getMuteStatus(chatId);

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
                await bot.sendMessage(chatId, `У вас нет цитат в категории "${category}" (страница ${page}).`, { disable_notification: mute });
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
                await bot.sendMessage(chatId, `Цитаты в категории "${category}" (страница ${page}):`, { reply_markup: keyboard, disable_notification: mute });
            }
        } catch (error) {
            console.error('Ошибка при получении цитат:', error);
            await bot.sendMessage(chatId, 'Произошла ошибка при получении цитат.', { disable_notification: mute });
        }
        bot.answerCallbackQuery(query.id);
        return;
    }

    if (data.startsWith('showcategory_category_')) {
        const category = data.split('showcategory_category_')[1];
        try {
            const quotes = await getSavedQuotesFromDatabase(category);
            if (quotes.length === 0) {
                await bot.sendMessage(chatId, `Цитаты в категории "${category}" отсутствуют.`, { disable_notification: mute });
            } else {
                const response = quotes.map((quote, index) => `${index + 1}. ${quote.text}`).join('\n');
                await bot.sendMessage(chatId, `Цитаты в категории "${category}":\n${response}`, { disable_notification: mute });
            }
        } catch (error) {
            console.error('Ошибка при получении цитат:', error);
            await bot.sendMessage(chatId, 'Произошла ошибка при получении цитат.', { disable_notification: mute });
        }
        bot.answerCallbackQuery(query.id);
        return;
    }

    if (data === 'save_quote') {
        const quoteText = query.message.text;
        chatContext[chatId] = { action: 'save_quote', quoteText };
        try {
            const categoryKeyboard = await createSaveQuoteCategoryKeyboard();
            await bot.sendMessage(chatId, 'Выберите категорию для сохранения цитаты:', { ...categoryKeyboard.reply_markup, disable_notification: mute });

        } catch (error) {
            console.error('Ошибка при создании клавиатуры категорий:', error);
            await bot.sendMessage(chatId, 'Произошла ошибка при загрузке категорий.', { disable_notification: mute });
            delete chatContext[chatId];
        }
        bot.answerCallbackQuery(query.id);
        return;
    }

    if (data === 'get_new_quote') {
        try {
            const newQuote = await getQuote();
            await bot.editMessageText(newQuote, {
                chat_id: chatId,
                message_id: messageId,
                disable_notification: mute,
                reply_markup: createQuoteKeyboard().reply_markup
            });
        } catch (error) {
            console.error('Ошибка при получении новой цитаты:', error);
            await bot.sendMessage(chatId, 'Произошла ошибка при получении новой цитаты.', { disable_notification: mute });
        }
        bot.answerCallbackQuery(query.id);
        return;
    }

    if (data.startsWith('savequote_category_')) {
        const category = data.split('savequote_category_')[1];
        const quoteText = chatContext[chatId]?.quoteText;
        if (quoteText) {
            try {
                await saveQuoteToDatabase(chatId, quoteText, category);
                await bot.sendMessage(chatId, `Цитата успешно сохранена в категорию "${category}"!`, { disable_notification: mute });
            } catch (error) {
                console.error('Ошибка при сохранении цитаты:', error);
                await bot.sendMessage(chatId, 'Произошла ошибка при сохранении цитаты.', { disable_notification: mute });
            }

        } else {
            await bot.sendMessage(chatId, 'Цитата не найдена. Попробуйте снова.', { disable_notification: mute });
        }
        delete chatContext[chatId];
        bot.answerCallbackQuery(query.id);
        return;
    }

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
                await bot.sendMessage(chatId, `Цитата: ${quote.text}`, { reply_markup: keyboard, disable_notification: mute });
            } else {
                await bot.sendMessage(chatId, 'Цитата не найдена.', { disable_notification: mute });
            }
        } catch (error) {
            console.error('Ошибка при получении цитаты:', error);
            await bot.sendMessage(chatId, 'Произошла ошибка при получении цитаты.', { disable_notification: mute });
        }
        bot.answerCallbackQuery(query.id);
        return;
    }

    else if (data.startsWith('delete_quote_')) {
        const quoteId = data.split('delete_quote_')[1];
        try {
            await deleteQuoteById(quoteId);
            await bot.sendMessage(chatId, 'Цитата успешно удалена.', { disable_notification: mute });
        } catch (error) {
            console.error('Ошибка при удалении цитаты:', error);
            await bot.sendMessage(chatId, 'Произошла ошибка при удалении цитаты.', { disable_notification: mute });
        }
        bot.answerCallbackQuery(query.id);
        return;
    }

    else if (data.startsWith('edit_quote_')) {
        const quoteId = data.split('edit_quote_')[1];
        chatContext[chatId] = { action: 'edit_quote', quoteId };
        await bot.sendMessage(chatId, 'Введите новый текст для цитаты:', { disable_notification: mute });
        bot.answerCallbackQuery(query.id);
        return;
    }
});

// Обработка редактирования цитаты
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const mute = await getMuteStatus(chatId);
    if (chatContext[chatId]?.action === 'edit_quote') {
        const quoteId = chatContext[chatId].quoteId;
        const newText = msg.text;
        try {
            const quote = await getQuoteById(quoteId);
            if (!quote) {
                await bot.sendMessage(chatId, 'Цитата не найдена.', { disable_notification: mute });
                return;
            }
            await updateQuoteById(quoteId, newText, quote.category);
            await bot.sendMessage(chatId, 'Цитата успешно обновлена!', { disable_notification: mute });
        } catch (error) {
            console.error('Ошибка при обновлении цитаты:', error);
            await bot.sendMessage(chatId, 'Произошла ошибка при обновлении цитаты.', { disable_notification: mute });
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
