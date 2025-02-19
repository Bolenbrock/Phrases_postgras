import TelegramBot from 'node-telegram-bot-api';
import {
    runQuery,
    runCommand,
    closeDB,
    getQuoteById,
    deleteQuoteById,
    updateQuoteById,
    searchQuotesWithPagination // Новая функция для поиска цитат
} from './db.js';
import fetch from 'node-fetch';

const token = process.env.BOT_TOKEN;
if (!token) {
    console.error('BOT_TOKEN не найден в .env файле');
    process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });
console.log('Бот запущен!');

const chatContext = {};

const mainKeyboard = {
    reply_markup: {
        keyboard: [
            [{ text: 'Получить цитату' }, { text: 'Сохранить цитату' }],
            [{ text: 'Мои цитаты' }, { text: 'Показать категорию' }, { text: 'Поиск текста' }]
        ],
        resize_keyboard: true
    }
};

// Функция для создания клавиатуры с действиями для цитат
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

// Получение случайной цитаты из API
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

// Обработчик команд бота
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const welcomeMessage = `
Привет!

С этим ботом ты станешь умнее! 
Но это не точно))
`;
    await bot.sendMessage(chatId, welcomeMessage, mainKeyboard);
});

// Основной обработчик сообщений
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const messageText = msg.text;

    if (messageText === 'Получить цитату') {
        try {
            const quote = await getQuote();
            await bot.sendMessage(chatId, quote, createQuoteKeyboard());
        } catch (error) {
            console.error('Ошибка при получении цитаты:', error);
            await bot.sendMessage(chatId, 'Произошла ошибка при получении цитаты.');
        }
    } else if (messageText === 'Сохранить цитату') {
        chatContext[chatId] = { action: 'save_quote' };
        await bot.sendMessage(chatId, 'Введите текст цитаты:');
    } else if (messageText === 'Мои цитаты') {
        try {
            const categoryKeyboard = await createCategoryKeyboard();
            await bot.sendMessage(chatId, 'Выберите категорию:', categoryKeyboard);
        } catch (error) {
            console.error('Ошибка при создании клавиатуры категорий:', error);
            await bot.sendMessage(chatId, 'Произошла ошибка при загрузке категорий.');
        }
    } else if (messageText === 'Показать категорию') {
        try {
            const categoryKeyboard = await createShowCategoryKeyboard();
            await bot.sendMessage(chatId, 'Выберите категорию:', categoryKeyboard);
        } catch (error) {
            console.error('Ошибка при создании клавиатуры категорий:', error);
            await bot.sendMessage(chatId, 'Произошла ошибка при загрузке категорий.');
        }
    } else if (messageText === 'Поиск текста') {
        await bot.sendMessage(chatId, 'Введите текст для поиска:');
        chatContext[chatId] = { action: 'search_text' };
    } else if (msg.text && !msg.entities) {
        if (chatContext[chatId]?.action === 'save_quote') {
            chatContext[chatId].quoteText = msg.text;
            try {
                const categoryKeyboard = await createSaveQuoteCategoryKeyboard();
                await bot.sendMessage(chatId, 'Выберите категорию для сохранения цитаты:', categoryKeyboard);
            } catch (error) {
                console.error('Ошибка при создании клавиатуры категорий:', error);
                await bot.sendMessage(chatId, 'Произошла ошибка при загрузке категорий.');
                delete chatContext[chatId];
            }
        } else if (chatContext[chatId]?.action === 'search_text') {
            try {
                console.log(`Пользователь ${chatId} ищет текст: "${messageText}"`); // Логирование поиска
                const results = await searchQuotesWithPagination(messageText, 10, 0); // Поиск в saved_quotes
                if (results.length > 0) {
                    const response = results
                        .map((result, index) => `${index + 1}. ${result}\n---\n`)
                        .join('\n');
                    await bot.sendMessage(chatId, `Результаты поиска:\n${response}`, { parse_mode: 'HTML' });
                } else {
                    await bot.sendMessage(chatId, `Цитат, содержащих "${messageText}", не найдено.`);
                }
            } catch (error) {
                console.error('Ошибка при поиске цитат:', error);
                await bot.sendMessage(chatId, 'Произошла ошибка при поиске. Попробуйте позже.');
            }
            delete chatContext[chatId];
        } else {
            await saveMessage(chatId, msg.text);
        }
    }
});

// Обработчик callback-запросов
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;

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
                await bot.sendMessage(chatId, `У вас нет цитат в категории "${category}" (страница ${page}).`);
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

                await bot.sendMessage(chatId, `Цитаты в категории "${category}" (страница ${page}):`, { reply_markup: keyboard });
            }
        } catch (error) {
            console.error('Ошибка при получении цитат:', error);
            await bot.sendMessage(chatId, 'Произошла ошибка при получении цитат.');
        }
        bot.answerCallbackQuery(query.id);
    } else if (data.startsWith('showcategory_category_')) {
        const category = data.split('showcategory_category_')[1];
        try {
            const quotes = await getSavedQuotesFromDatabase(category);
            if (quotes.length === 0) {
                await bot.sendMessage(chatId, `Цитаты в категории "${category}" отсутствуют.`);
            } else {
                const response = quotes.map((quote, index) => `${index + 1}. ${quote.text}`).join('\n');
                await bot.sendMessage(chatId, `Цитаты в категории "${category}":\n${response}`);
            }
        } catch (error) {
            console.error('Ошибка при получении цитат:', error);
            await bot.sendMessage(chatId, 'Произошла ошибка при получении цитат.');
        }
        bot.answerCallbackQuery(query.id);
    } else if (data === 'save_quote') {
        const quoteText = query.message.text;
        chatContext[chatId] = { action: 'save_quote', quoteText };
        try {
            const categoryKeyboard = await createSaveQuoteCategoryKeyboard();
            await bot.sendMessage(chatId, 'Выберите категорию для сохранения цитаты:', categoryKeyboard);
        } catch (error) {
            console.error('Ошибка при создании клавиатуры категорий:', error);
            await bot.sendMessage(chatId, 'Произошла ошибка при загрузке категорий.');
            delete chatContext[chatId];
        }
    } else if (data === 'get_new_quote') {
        try {
            const newQuote = await getQuote();
            await bot.editMessageText(newQuote, {
                chat_id: chatId,
                message_id: messageId,
                reply_markup: createQuoteKeyboard().reply_markup
            });
        } catch (error) {
            console.error('Ошибка при получении новой цитаты:', error);
            await bot.sendMessage(chatId, 'Произошла ошибка при получении новой цитаты.');
        }
    } else if (data.startsWith('show_quote_')) {
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
                await bot.sendMessage(chatId, `Цитата: ${quote.text}`, { reply_markup: keyboard });
            } else {
                await bot.sendMessage(chatId, 'Цитата не найдена.');
            }
        } catch (error) {
            console.error('Ошибка при получении цитаты:', error);
            await bot.sendMessage(chatId, 'Произошла ошибка при получении цитаты.');
        }
        bot.answerCallbackQuery(query.id);
    } else if (data.startsWith('delete_quote_')) {
        const quoteId = data.split('delete_quote_')[1];
        try {
            await deleteQuoteById(quoteId);
            await bot.sendMessage(chatId, 'Цитата успешно удалена.');
        } catch (error) {
            console.error('Ошибка при удалении цитаты:', error);
            await bot.sendMessage(chatId, 'Произошла ошибка при удалении цитаты.');
        }
        bot.answerCallbackQuery(query.id);
    } else if (data.startsWith('edit_quote_')) {
        const quoteId = data.split('edit_quote_')[1];
        chatContext[chatId] = { action: 'edit_quote', quoteId };
        await bot.sendMessage(chatId, 'Введите новый текст для цитаты:');
        bot.answerCallbackQuery(query.id);
    } else if (data.startsWith('savequote_category_')) {
        const category = data.split('savequote_category_')[1];
        const quoteText = chatContext[chatId]?.quoteText;
        if (quoteText) {
            await saveQuoteToDatabase(chatId, quoteText, category);
            await bot.sendMessage(chatId, `Цитата успешно сохранена в категорию "${category}"!`);
        } else {
            await bot.sendMessage(chatId, 'Цитата не найдена. Попробуйте снова.');
        }
        delete chatContext[chatId];
        bot.answerCallbackQuery(query.id);
    }
});

// Создание клавиатуры категорий для выбора при просмотре цитат
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

// Создание клавиатуры категорий для просмотра цитат
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

// Создание клавиатуры категорий для сохранения цитат
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

// Сохранение цитаты в базу данных
async function saveQuoteToDatabase(chatId, text, category) {
    try {
        await runCommand(
            `INSERT INTO saved_quotes (text, category, chatId) VALUES ($1, $2, $3)`,
            [text, category, chatId]
        );
        console.log(`Цитата успешно сохранена в категорию "${category}". Текст: "${text}"`);
    } catch (error) {
        console.error('Ошибка при сохранении цитаты:', error);
        throw error;
    }
}

// Поиск цитат с пагинацией
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

// Получение всех цитат по категории
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