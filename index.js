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
} from './db.js'; // Убедитесь, что путь к db.js ПРАВИЛЬНЫЙ!
import fetch from 'node-fetch';
import 'dotenv/config'; // Убедитесь, что .env файл настроен правильно!

// Получаем токен бота из переменных окружения
const token = process.env.BOT_TOKEN;
if (!token) {
    console.error('BOT_TOKEN не найден в .env файле');
    process.exit(1); // Выход из программы, если токен отсутствует
}

// Создаем экземпляр бота
const bot = new TelegramBot(token, { polling: true });
console.log('Бот запущен!');

// Контекст чата (хранит состояние для каждого пользователя)
const chatContext = {};

// *** Обертки для функций отправки сообщений (с обработкой ошибок и логированием) ***
async function sendBotMessage(chatId, text, options = {}) {
    try {
        const mute = await getMuteStatus(chatId);
        const mergedOptions = { ...options, disable_notification: mute };
        console.log(`Sending message to ${chatId}, disable_notification: ${mergedOptions.disable_notification}, text: ${text.substring(0, 50)}...`); // Логирование
        return await bot.sendMessage(chatId, text, mergedOptions);
    } catch (error) {
        console.error(`Ошибка в sendBotMessage (chatId: ${chatId}):`, error);
        // Обработка ошибки (можно отправить сообщение об ошибке пользователю)
        try {
            await bot.sendMessage(chatId, "Произошла ошибка при отправке сообщения."); // Отправка без обертки, т.к. обертка может снова вызвать ошибку
        } catch (sendError) {
            console.error("Ошибка при отправке сообщения об ошибке:", sendError);
        }
    }
}

async function editBotMessageText(text, options = {}) {
    try {
        const chatId = options.chat_id;
        if (!chatId) {
            throw new Error("editBotMessageText: chat_id is required in options!"); // Теперь выбрасываем ошибку
        }
        const messageId = options.message_id;
        if (!messageId) {
            throw new Error("editBotMessageText: message_id is required in options!"); // Теперь выбрасываем ошибку
        }
        const mute = await getMuteStatus(chatId);
        const mergedOptions = { ...options, disable_notification: mute };
        console.log(`Editing message in ${chatId}, disable_notification: ${mergedOptions.disable_notification}, text: ${text.substring(0, 50)}...`);// Логирование
        return await bot.editMessageText(text, mergedOptions);
    } catch (error) {
        console.error(`Ошибка в editBotMessageText (chatId: ${options.chat_id}, messageId: ${options.message_id}):`, error);
        // Обработка ошибки (можно отправить сообщение об ошибке пользователю, если это уместно)
    }
}

// *** Функции создания клавиатур ***
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

async function createCategoryKeyboard() {
    try {
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
    } catch (error) {
        console.error("Ошибка в createCategoryKeyboard:", error); // Логирование
        // Можно вернуть клавиатуру с сообщением об ошибке, или пустую клавиатуру
        return {
            reply_markup: {
                inline_keyboard: [[{ text: 'Ошибка загрузки', callback_data: 'error' }]]
            }
        };
    }
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
    try{
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
    } catch (error) {
        console.error("Ошибка в createSaveQuoteCategoryKeyboard:", error); // Логирование
         return {
            reply_markup: {
                inline_keyboard: [[{ text: 'Ошибка загрузки', callback_data: 'error' }]]
            }
        };
    }
}

// *** Функция получения цитаты (с обработкой ошибок) ***
async function getQuote() {
    try {
        const response = await fetch('http://api.forismatic.com/api/1.0/?method=getQuote&format=json&lang=ru');
        if (!response.ok) {
            throw new Error(`Ошибка HTTP: ${response.status}`); // Проверка статуса ответа
        }
        const data = await response.json();
         // Дополнительная проверка на случай, если API вернет некорректные данные
        if (!data || !data.quoteText) {
            throw new Error("API вернул некорректные данные");
        }
        return `"${data.quoteText}" - ${data.quoteAuthor || 'Неизвестный автор'}`;
    } catch (error) {
        console.error('Ошибка при получении цитаты из forismatic.com:', error);
        return 'Не удалось получить цитату (ошибка API).';
    }
}

// *** Обработчики событий бота ***

// Обработчик команды /start
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const welcomeMessage = `Привет!\n\nС этим ботом ты станешь умнее!\nНо это не точно))`;
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
            console.error('Ошибка при получении цитаты:', error); // Уже обрабатывается в getQuote, но можно добавить и здесь
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
            console.error('Ошибка при создании клавиатуры категорий:', error); //Уже ловим в createCategoryKeyboard
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
            console.error('Ошибка при создании клавиатуры showCategoryKeyboard:', error);
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

    // Обработка текста, введенного пользователем (если это не команда)
    if (msg.text && !msg.entities) {
        // Сохранение цитаты
        if (chatContext[chatId]?.action === 'save_quote') {
            chatContext[chatId].quoteText = msg.text;
            try {
                const categoryKeyboard = await createSaveQuoteCategoryKeyboard();
                await sendBotMessage(chatId, 'Выберите категорию для сохранения цитаты:', categoryKeyboard);
            } catch (error) {
                console.error('Ошибка при создании клавиатуры createSaveQuoteCategoryKeyboard:', error);
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
                paginationButtons.push({ text: `Стр. ${page} из ${totalPages}`, callback_data: 'dummy' }); // "dummy" - просто текст
                if (page < totalPages) {
                    paginationButtons.push({ text: 'Вперед ➡️', callback_data: `myquotes_category_${category}_page:${page + 1}` });
                }

                if (paginationButtons.length > 0) {
                    keyboard.inline_keyboard.push(paginationButtons);
                }

                await sendBotMessage(chatId, `Цитаты в категории "${category}" (страница ${page}):`, { reply_markup: keyboard });
            }
        } catch (error) {
            console.error('Ошибка при получении цитат (с пагинацией):', error);
            await sendBotMessage(chatId, 'Произошла ошибка при получении цитат.');
        }
        bot.answerCallbackQuery(query.id);
        return;
    }

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
            console.error('Ошибка при получении цитат (без пагинации):', error);
            await sendBotMessage(chatId, 'Произошла ошибка при получении цитат.');
        }
        bot.answerCallbackQuery(query.id);
        return;
    }

    if (data === 'save_quote') {
        const quoteText = query.message.text;
        chatContext[chatId] = { action: 'save_quote', quoteText };
        try {
            const categoryKeyboard = await createSaveQuoteCategoryKeyboard();
            await sendBotMessage(chatId, 'Выберите категорию для сохранения цитаты:', categoryKeyboard);
        } catch (error) {
            console.error('Ошибка при создании клавиатуры сохранения:', error);
            await sendBotMessage(chatId, 'Произошла ошибка при загрузке категорий.');
            delete chatContext[chatId];
        }
        bot.answerCallbackQuery(query.id);
        return;
    }

    // *** Получить новую цитату (ТЕПЕРЬ ПРАВИЛЬНО!) ***
    if (data === 'get_new_quote') {
        try {
            const newQuote = await getQuote(); // Получаем новую цитату
            // Используем ОБЕРТКУ editBotMessageText!
            await editBotMessageText(newQuote, {
                chat_id: chatId,  // Передаем chatId
                message_id: messageId, // Передаем messageId
                reply_markup: createQuoteKeyboard().reply_markup // Добавляем клавиатуру
            });
        } catch (error) {
            console.error('Ошибка при получении новой цитаты:', error);
            await sendBotMessage(chatId, 'Произошла ошибка при получении новой цитаты.');
        }
        bot.answerCallbackQuery(query.id); // Отвечаем на callback-запрос (ОБЯЗАТЕЛЬНО!)
        return;
    }

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
            console.error('Ошибка при получении цитаты по ID:', error);
            await sendBotMessage(chatId, 'Произошла ошибка при получении цитаты.');
        }
        bot.answerCallbackQuery(query.id);
        return;
    }

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

    else if (data.startsWith('edit_quote_')) {
        const quoteId = data.split('edit_quote_')[1];
        chatContext[chatId] = { action: 'edit_quote', quoteId };
        await sendBotMessage(chatId, 'Введите новый текст для цитаты:');
        bot.answerCallbackQuery(query.id);
        return;
    }
});

// Обработчик редактирования цитаты
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

// *** Вспомогательные функции (для работы с БД) ***
async function getSavedQuotesFromDatabaseWithPagination(chatId, limit, offset, category = null) {
    let query = `SELECT id, text FROM saved_quotes WHERE chatId = $1`;
    const params = [chatId];
    if (category) {
        query += ` AND category = $2`;
        params.push(category);
    }
    query += ` ORDER BY timestamp DESC LIMIT $3 OFFSET $4`; // Добавил сортировку по времени
    const rows = await runQuery(query, params);
    return rows;
}

async function getSavedQuotesFromDatabase(category) {
    const query = `SELECT text FROM saved_quotes WHERE category = $1`;
    const params = [category];
    const rows = await runQuery(query, params);
    return rows;
}

// *** Завершение работы бота ***
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

async function gracefulShutdown() {
    console.log('Выключение бота...');
    try {
        await bot.stopPolling();
        await closeDB();
        console.log('Соединение с базой данных закрыто.');
    } catch (error) {
        console.error('Ошибка при завершении работы:', error);
    } finally {
        process.exit(0); // Выходим в любом случае
    }
}
