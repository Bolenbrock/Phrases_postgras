// Импортируем необходимые модули
import TelegramBot from 'node-telegram-bot-api';
import {
    runQuery, // Функция для выполнения SQL-запросов
    runCommand, // Функция для выполнения SQL-команд
    closeDB, // Закрытие соединения с базой данных
    getQuoteById, // Получение цитаты по ID
    deleteQuoteById, // Удаление цитаты по ID
    updateQuoteById, // Обновление цитаты по ID
    searchQuotesWithPagination, // Поиск цитат с пагинацией
    saveQuoteToDatabase // Сохранение цитаты в базу данных
} from './db.js';
import fetch from 'node-fetch'; // Модуль для работы с HTTP-запросами

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

// Главная клавиатура бота
const mainKeyboard = {
    reply_markup: {
        keyboard: [
            [{ text: 'Получить цитату' }, { text: 'Сохранить цитату' }], // Кнопки для получения и сохранения цитат
            [{ text: 'Мои цитаты' }, { text: 'Показать категорию' }, { text: 'Поиск текста' }] // Кнопки для просмотра своих цитат, категорий и поиска
        ],
        resize_keyboard: true // Автоматическая адаптация размера клавиатуры
    }
};

// Создание клавиатуры для действий с цитатами
function createQuoteKeyboard() {
    return {
        reply_markup: {
            inline_keyboard: [
                [{ text: 'Сохранить цитату', callback_data: 'save_quote' }], // Кнопка для сохранения цитаты
                [{ text: 'Получить новую цитату', callback_data: 'get_new_quote' }] // Кнопка для получения новой цитаты
            ]
        }
    };
}

// Создание клавиатуры категорий для выбора при просмотре цитат
async function createCategoryKeyboard() {
    const rows = await runQuery(`SELECT name FROM categories`); // Запрос к таблице categories
    if (rows.length === 0) {
        return {
            reply_markup: {
                inline_keyboard: [[{ text: 'Категории отсутствуют', callback_data: 'no_categories' }]] // Если категорий нет, показываем сообщение об этом
            }
        };
    }
    const keyboard = { reply_markup: { inline_keyboard: [] } }; // Создаем клавиатуру
    let rowButtons = [];
    rows.forEach((row, index) => {
        rowButtons.push({ text: row.name, callback_data: `myquotes_category_${row.name}` }); // Добавляем кнопки для каждой категории
        if ((index + 1) % 3 === 0 || index === rows.length - 1) {
            keyboard.reply_markup.inline_keyboard.push(rowButtons); // Группируем кнопки по три в строку
            rowButtons = [];
        }
    });
    return keyboard; // Возвращаем готовую клавиатуру
}

// Создание клавиатуры категорий для просмотра цитат
async function createShowCategoryKeyboard() {
    const rows = await runQuery(`SELECT name FROM categories`); // Запрос к таблице categories
    if (rows.length === 0) {
        return {
            reply_markup: {
                inline_keyboard: [[{ text: 'Категории отсутствуют', callback_data: 'no_categories' }]] // Если категорий нет, показываем сообщение об этом
            }
        };
    }
    const keyboard = { reply_markup: { inline_keyboard: [] } }; // Создаем клавиатуру
    let rowButtons = [];
    rows.forEach((row, index) => {
        rowButtons.push({ text: row.name, callback_data: `showcategory_category_${row.name}` }); // Добавляем кнопки для каждой категории
        if ((index + 1) % 3 === 0 || index === rows.length - 1) {
            keyboard.reply_markup.inline_keyboard.push(rowButtons); // Группируем кнопки по три в строку
            rowButtons = [];
        }
    });
    return keyboard; // Возвращаем готовую клавиатуру
}

// Создание клавиатуры категорий для сохранения цитат
async function createSaveQuoteCategoryKeyboard() {
    const rows = await runQuery(`SELECT name FROM categories`); // Запрос к таблице categories
    if (rows.length === 0) {
        return {
            reply_markup: {
                inline_keyboard: [[{ text: 'Категории отсутствуют', callback_data: 'no_categories' }]] // Если категорий нет, показываем сообщение об этом
            }
        };
    }
    const keyboard = { reply_markup: { inline_keyboard: [] } }; // Создаем клавиатуру
    let rowButtons = [];
    rows.forEach((row, index) => {
        rowButtons.push({ text: row.name, callback_data: `savequote_category_${row.name}` }); // Добавляем кнопки для каждой категории
        if ((index + 1) % 3 === 0 || index === rows.length - 1) {
            keyboard.reply_markup.inline_keyboard.push(rowButtons); // Группируем кнопки по три в строку
            rowButtons = [];
        }
    });
    return keyboard; // Возвращаем готовую клавиатуру
}

// Получение случайной цитаты из внешнего API
async function getQuote() {
    try {
        const response = await fetch('http://api.forismatic.com/api/1.0/?method=getQuote&format=json&lang=ru'); // Запрос к API
        const data = await response.json(); // Парсим ответ
        return `"${data.quoteText}" - ${data.quoteAuthor || 'Неизвестный автор'}`; // Возвращаем цитату в формате "текст" - автор
    } catch (error) {
        console.error('Ошибка при получении цитаты из forismatic.com:', error.message);
        return 'Не удалось получить цитату.'; // Если произошла ошибка, возвращаем сообщение об ошибке
    }
}

// Обработчик команды /start
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id; // Получаем ID чата
    const welcomeMessage = `
Привет!

С этим ботом ты станешь умнее! 
Но это не точно))
`;
    await bot.sendMessage(chatId, welcomeMessage, mainKeyboard); // Отправляем приветственное сообщение и главную клавиатуру
});

// Основной обработчик сообщений
bot.on('message', async (msg) => {
    const chatId = msg.chat.id; // Получаем ID чата
    const messageText = msg.text; // Получаем текст сообщения

    // Если пользователь хочет получить случайную цитату
    if (messageText === 'Получить цитату') {
        try {
            const quote = await getQuote(); // Получаем цитату
            await bot.sendMessage(chatId, quote, createQuoteKeyboard()); // Отправляем цитату и клавиатуру действий
        } catch (error) {
            console.error('Ошибка при получении цитаты:', error);
            await bot.sendMessage(chatId, 'Произошла ошибка при получении цитаты.'); // Если произошла ошибка, отправляем сообщение об ошибке
        }
    }

    // Если пользователь хочет сохранить цитату
    else if (messageText === 'Сохранить цитату') {
        chatContext[chatId] = { action: 'save_quote' }; // Устанавливаем состояние "сохранение цитаты"
        await bot.sendMessage(chatId, 'Введите текст цитаты:'); // Просим пользователя ввести текст цитаты
    }

    // Если пользователь хочет посмотреть свои сохраненные цитаты
    else if (messageText === 'Мои цитаты') {
        try {
            const categoryKeyboard = await createCategoryKeyboard(); // Создаем клавиатуру категорий
            await bot.sendMessage(chatId, 'Выберите категорию:', categoryKeyboard); // Просим пользователя выбрать категорию
        } catch (error) {
            console.error('Ошибка при создании клавиатуры категорий:', error);
            await bot.sendMessage(chatId, 'Произошла ошибка при загрузке категорий.'); // Если произошла ошибка, отправляем сообщение об ошибке
        }
    }

    // Если пользователь хочет показать все цитаты определенной категории
    else if (messageText === 'Показать категорию') {
        try {
            const categoryKeyboard = await createShowCategoryKeyboard(); // Создаем клавиатуру категорий
            await bot.sendMessage(chatId, 'Выберите категорию:', categoryKeyboard); // Просим пользователя выбрать категорию
        } catch (error) {
            console.error('Ошибка при создании клавиатуры категорий:', error);
            await bot.sendMessage(chatId, 'Произошла ошибка при загрузке категорий.'); // Если произошла ошибка, отправляем сообщение об ошибке
        }
    }

    // Если пользователь хочет найти цитаты по тексту
    else if (messageText === 'Поиск текста') {
        await bot.sendMessage(chatId, 'Введите текст для поиска:'); // Просим пользователя ввести текст для поиска
        chatContext[chatId] = { action: 'search_text' }; // Устанавливаем состояние "поиск текста"
    }

    // Если пользователь вводит текст для сохранения или поиска
    else if (msg.text && !msg.entities) {
        // Если пользователь вводит текст цитаты для сохранения
        if (chatContext[chatId]?.action === 'save_quote') {
            chatContext[chatId].quoteText = msg.text; // Сохраняем текст цитаты
            try {
                const categoryKeyboard = await createSaveQuoteCategoryKeyboard(); // Создаем клавиатуру категорий
                await bot.sendMessage(chatId, 'Выберите категорию для сохранения цитаты:', categoryKeyboard); // Просим пользователя выбрать категорию
            } catch (error) {
                console.error('Ошибка при создании клавиатуры категорий:', error);
                await bot.sendMessage(chatId, 'Произошла ошибка при загрузке категорий.'); // Если произошла ошибка, отправляем сообщение об ошибке
                delete chatContext[chatId]; // Сбрасываем состояние
            }
        }

        // Если пользователь ищет цитаты по тексту
        else if (chatContext[chatId]?.action === 'search_text') {
            try {
                console.log(`Пользователь ${chatId} ищет текст: "${messageText}"`); // Логирование поиска
                const results = await searchQuotesWithPagination(messageText, 10, 0); // Ищем цитаты
                if (results.length > 0) {
                    const response = results
                        .map((result, index) => `${index + 1}. ${result}\n---\n`) // Форматируем результаты
                        .join('\n');
                    await bot.sendMessage(chatId, `Результаты поиска:\n${response}`, { parse_mode: 'HTML' }); // Отправляем результаты поиска
                } else {
                    await bot.sendMessage(chatId, `Цитат, содержащих "${messageText}", не найдено.`); // Если ничего не найдено, отправляем сообщение об этом
                }
            } catch (error) {
                console.error('Ошибка при поиске цитат:', error);
                await bot.sendMessage(chatId, 'Произошла ошибка при поиске. Попробуйте позже.'); // Если произошла ошибка, отправляем сообщение об ошибке
            }
            delete chatContext[chatId]; // Сбрасываем состояние после завершения поиска
        }
    }
});

// Обработчик callback-запросов (действия с инлайн-клавиатурой)
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id; // Получаем ID чата
    const messageId = query.message.message_id; // Получаем ID сообщения
    const data = query.data; // Получаем данные callback

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
                await bot.sendMessage(chatId, `У вас нет цитат в категории "${category}" (страница ${page}).`); // Если цитат нет, отправляем сообщение об этом
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
                await bot.sendMessage(chatId, `Цитаты в категории "${category}" (страница ${page}):`, { reply_markup: keyboard });
            }
        } catch (error) {
            console.error('Ошибка при получении цитат:', error);
            await bot.sendMessage(chatId, 'Произошла ошибка при получении цитат.'); // Если произошла ошибка, отправляем сообщение об ошибке
        }
        bot.answerCallbackQuery(query.id); // Отвечаем на callback запрос
    }

    // Если пользователь хочет показать цитаты определенной категории без пагинации
    else if (data.startsWith('showcategory_category_')) {
        const category = data.split('showcategory_category_')[1]; // Извлекаем название категории
        try {
            const quotes = await getSavedQuotesFromDatabase(category); // Получаем цитаты по категории
            if (quotes.length === 0) {
                await bot.sendMessage(chatId, `Цитаты в категории "${category}" отсутствуют.`); // Если цитат нет, отправляем сообщение об этом
            } else {
                const response = quotes.map((quote, index) => `${index + 1}. ${quote.text}`).join('\n'); // Форматируем список цитат
                await bot.sendMessage(chatId, `Цитаты в категории "${category}":\n${response}`); // Отправляем список цитат
            }
        } catch (error) {
            console.error('Ошибка при получении цитат:', error);
            await bot.sendMessage(chatId, 'Произошла ошибка при получении цитат.'); // Если произошла ошибка, отправляем сообщение об ошибке
        }
        bot.answerCallbackQuery(query.id); // Отвечаем на callback запрос
    }

    // Если пользователь хочет сохранить текущую цитату
    else if (data === 'save_quote') {
        const quoteText = query.message.text; // Получаем текст цитаты
        chatContext[chatId] = { action: 'save_quote', quoteText }; // Устанавливаем состояние "сохранение цитаты"
        try {
            const categoryKeyboard = await createSaveQuoteCategoryKeyboard(); // Создаем клавиатуру категорий
            await bot.sendMessage(chatId, 'Выберите категорию для сохранения цитаты:', categoryKeyboard); // Просим пользователя выбрать категорию
        } catch (error) {
            console.error('Ошибка при создании клавиатуры категорий:', error);
            await bot.sendMessage(chatId, 'Произошла ошибка при загрузке категорий.'); // Если произошла ошибка, отправляем сообщение об ошибке
            delete chatContext[chatId]; // Сбрасываем состояние
        }
    }

    // Если пользователь хочет получить новую цитату
    else if (data === 'get_new_quote') {
        try {
            const newQuote = await getQuote(); // Получаем новую цитату
            await bot.editMessageText(newQuote, { // Редактируем предыдущее сообщение
                chat_id: chatId,
                message_id: messageId,
                reply_markup: createQuoteKeyboard().reply_markup // Добавляем клавиатуру действий
            });
        } catch (error) {
            console.error('Ошибка при получении новой цитаты:', error);
            await bot.sendMessage(chatId, 'Произошла ошибка при получении новой цитаты.'); // Если произошла ошибка, отправляем сообщение об ошибке
        }
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
                await bot.sendMessage(chatId, `Цитата: ${quote.text}`, { reply_markup: keyboard }); // Отправляем цитату с кнопками действий
            } else {
                await bot.sendMessage(chatId, 'Цитата не найдена.'); // Если цитата не найдена, отправляем сообщение об этом
            }
        } catch (error) {
            console.error('Ошибка при получении цитаты:', error);
            await bot.sendMessage(chatId, 'Произошла ошибка при получении цитаты.'); // Если произошла ошибка, отправляем сообщение об ошибке
        }
        bot.answerCallbackQuery(query.id); // Отвечаем на callback запрос
    }

    // Если пользователь хочет удалить цитату
    else if (data.startsWith('delete_quote_')) {
        const quoteId = data.split('delete_quote_')[1]; // Извлекаем ID цитаты
        try {
            await deleteQuoteById(quoteId); // Удаляем цитату
            await bot.sendMessage(chatId, 'Цитата успешно удалена.'); // Отправляем сообщение об успешном удалении
        } catch (error) {
            console.error('Ошибка при удалении цитаты:', error);
            await bot.sendMessage(chatId, 'Произошла ошибка при удалении цитаты.'); // Если произошла ошибка, отправляем сообщение об ошибке
        }
        bot.answerCallbackQuery(query.id); // Отвечаем на callback запрос
    }

    // Если пользователь хочет отредактировать цитату
    else if (data.startsWith('edit_quote_')) {
        const quoteId = data.split('edit_quote_')[1]; // Извлекаем ID цитаты
        chatContext[chatId] = { action: 'edit_quote', quoteId }; // Устанавливаем состояние "редактирование цитаты"
        await bot.sendMessage(chatId, 'Введите новый текст для цитаты:'); // Просим пользователя ввести новый текст
        bot.answerCallbackQuery(query.id); // Отвечаем на callback запрос
    }

    // Если пользователь выбирает категорию для сохранения цитаты
    else if (data.startsWith('savequote_category_')) {
        const category = data.split('savequote_category_')[1]; // Извлекаем название категории
        const quoteText = chatContext[chatId]?.quoteText; // Получаем текст цитаты из контекста
        if (quoteText) {
            await saveQuoteToDatabase(chatId, quoteText, category); // Сохраняем цитату в базу данных
            await bot.sendMessage(chatId, `Цитата успешно сохранена в категорию "${category}"!`); // Отправляем сообщение об успешном сохранении
        } else {
            await bot.sendMessage(chatId, 'Цитата не найдена. Попробуйте снова.'); // Если цитата не найдена, отправляем сообщение об ошибке
        }
        delete chatContext[chatId]; // Сбрасываем состояние
        bot.answerCallbackQuery(query.id); // Отвечаем на callback запрос
    }
});

// Обработка редактирования цитаты
bot.on('message', async (msg) => {
    const chatId = msg.chat.id; // Получаем ID чата
    if (chatContext[chatId]?.action === 'edit_quote') {
        const quoteId = chatContext[chatId].quoteId; // Получаем ID цитаты из контекста
        const newText = msg.text; // Получаем новый текст цитаты
        try {
            const quote = await getQuoteById(quoteId); // Получаем текущую цитату
            if (!quote) {
                await bot.sendMessage(chatId, 'Цитата не найдена.'); // Если цитата не найдена, отправляем сообщение об ошибке
                return;
            }
            await updateQuoteById(quoteId, newText, quote.category); // Обновляем текст цитаты
            await bot.sendMessage(chatId, 'Цитата успешно обновлена!'); // Отправляем сообщение об успешном обновлении
        } catch (error) {
            console.error('Ошибка при обновлении цитаты:', error);
            await bot.sendMessage(chatId, 'Произошла ошибка при обновлении цитаты.'); // Если произошла ошибка, отправляем сообщение об ошибке
        } finally {
            delete chatContext[chatId]; // Сбрасываем состояние
        }
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
process.on('SIGINT', gracefulShutdown); // Обработка SIGINT (например, Ctrl+C)
process.on('SIGTERM', gracefulShutdown); // Обработка SIGTERM

async function gracefulShutdown() {
    console.log('Выключение бота...');
    await bot.stopPolling(); // Останавливаем получение обновлений
    await closeDB(); // Закрываем соединение с базой данных
    console.log('Соединение с базой данных закрыто.');
    process.exit(0); // Завершаем процесс
}
