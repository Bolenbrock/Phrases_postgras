import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;
const dbName = 'telegram_bot'; // Имя базы данных

// Проверка и создание базы данных, если она не существует
async function checkAndCreateDB() {
    const client = new pg.Client({
        connectionString: process.env.DATABASE_URL.replace(`/${dbName}`, ''), // Убираем имя БД из URL
    });
    try {
        await client.connect(); // Подключение к PostgreSQL
        const dbExists = await client.query(`SELECT 1 FROM pg_database WHERE datname=$1`, [dbName]);
        if (dbExists.rowCount === 0) {
            console.log(`Database "${dbName}" does not exist. Creating...`);
            await client.query(`CREATE DATABASE ${dbName}`); // Создаем базу данных
            console.log(`Database "${dbName}" created successfully.`);
        } else {
            console.log(`Database "${dbName}" already exists.`);
        }
    } catch (err) {
        console.error('Error checking/creating database:', err);
        throw err; // Передаем ошибку дальше, если что-то пошло не так
    } finally {
        await client.end(); // Закрываем соединение
    }
}

// Создаем пул подключений к базе данных
const pool = new Pool({
    connectionString: process.env.DATABASE_URL, // Используем полный URL с указанием имени БД
});

// Создание необходимых таблиц в базе данных
async function createTables() {
    const client = await pool.connect();
    try {
        // Таблица для сохранения цитат
        await client.query(`
            CREATE TABLE IF NOT EXISTS saved_quotes (
                id SERIAL PRIMARY KEY,
                text TEXT NOT NULL,
                category TEXT,
                chatId BIGINT NOT NULL,
                timestamp TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
            )
        `);

        // Таблица для полнотекстового поиска
        await client.query(`
            CREATE TABLE IF NOT EXISTS all_texts_fts (
                text TEXT,
                chatId BIGINT,
                type TEXT,
                timestamp TIMESTAMP WITHOUT TIME ZONE,
                tsv tsvector GENERATED ALWAYS AS (to_tsvector('russian', text)) STORED
            )
        `);

        // Индекс для ускорения полнотекстового поиска
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_fts_text_search ON all_texts_fts USING GIN (tsv);
        `);
    } catch (err) {
        console.error('Error creating tables:', err);
    } finally {
        client.release(); // Освобождаем соединение
    }
}

// Выполнение SQL-запросов с параметрами
export async function runQuery(query, params = []) {
    const client = await pool.connect();
    try {
        console.log(`Executing query: ${query} with params:`, params); // Логирование запроса
        const result = await client.query(query, params);
        return result.rows; // Возвращаем результат запроса
    } catch (error) {
        console.error('Error executing query:', error);
        throw error; // Передаем ошибку дальше
    } finally {
        client.release(); // Освобождаем соединение
    }
}

// Выполнение SQL-команд без возврата результата
export async function runCommand(command, params = []) {
    const client = await pool.connect();
    try {
        console.log(`Executing command: ${command} with params:`, params); // Логирование команды
        await client.query(command, params);
    } catch (error) {
        console.error('Error executing command:', error);
        throw error; // Передаем ошибку дальше
    } finally {
        client.release(); // Освобождаем соединение
    }
}

// Добавление текста в таблицу для полнотекстового поиска
export async function addTextToFTS(text, chatId, type, timestamp = 'NOW()') {
    if (!text || text.trim().length < 2) {
        console.warn('Попытка добавить слишком короткий текст в FTS.');
        return;
    }

    const query = `
        INSERT INTO all_texts_fts (text, chatId, type, timestamp)
        VALUES ($1, $2, $3, $4)
    `;
    try {
        await runCommand(query, [text, chatId, type, timestamp]); // Добавляем текст в FTS
    } catch (error) {
        console.error('Error adding text to FTS:', error);
        throw error; // Передаем ошибку дальше
    }
}

// Сохранение цитаты в таблицу saved_quotes
export async function saveQuote(chatId, text, category) {
    try {
        // Сохраняем цитату в таблицу saved_quotes
        await runCommand(
            `INSERT INTO saved_quotes (text, category, chatId) VALUES ($1, $2, $3)`,
            [text, category, chatId]
        );

        // Добавляем цитату в таблицу для полнотекстового поиска
        await addTextToFTS(text, chatId, 'quote');

        console.log(`Цитата успешно сохранена в категорию "${category}". Текст: "${text}"`);
    } catch (error) {
        console.error('Ошибка при сохранении цитаты:', error);
        throw error; // Передаем ошибку дальше
    }
}

// Поиск цитат с использованием LIKE (регистронезависимый поиск)
export async function searchQuotesWithPagination(searchText, limit, offset) {
    const query = `
        SELECT text 
        FROM saved_quotes 
        WHERE LOWER(text) LIKE LOWER($1) 
        LIMIT $2 OFFSET $3
    `;
    const params = [`%${searchText.toLowerCase()}%`, limit, offset];

    try {
        console.log(`Searching quotes with query: ${query} and params:`, params); // Логирование поиска
        const rows = await runQuery(query, params);
        return rows.map(row => row.text); // Возвращаем только тексты цитат
    } catch (error) {
        console.error('Ошибка при поиске цитат:', error);
        throw error; // Передаем ошибку дальше
    }
}

// Получение цитаты по ID
export async function getQuoteById(quoteId) {
    const query = `
        SELECT id, text, category 
        FROM saved_quotes 
        WHERE id = $1
    `;
    const params = [quoteId];

    try {
        const result = await runQuery(query, params);
        return result[0] || null; // Возвращаем первую найденную цитату или null
    } catch (error) {
        console.error('Ошибка при получении цитаты по ID:', error);
        throw error; // Передаем ошибку дальше
    }
}

// Удаление цитаты по ID
export async function deleteQuoteById(quoteId) {
    const query = `
        DELETE FROM saved_quotes 
        WHERE id = $1
    `;
    const params = [quoteId];

    try {
        await runCommand(query, params);
        console.log(`Цитата с ID ${quoteId} успешно удалена.`);
    } catch (error) {
        console.error('Ошибка при удалении цитаты:', error);
        throw error; // Передаем ошибку дальше
    }
}

// Обновление цитаты по ID
export async function updateQuoteById(quoteId, newText, category) {
    const query = `
        UPDATE saved_quotes 
        SET text = $1, category = $2 
        WHERE id = $3
    `;
    const params = [newText, category, quoteId];

    try {
        await runCommand(query, params);
        console.log(`Цитата с ID ${quoteId} успешно обновлена.`);
    } catch (error) {
        console.error('Ошибка при обновлении цитаты:', error);
        throw error; // Передаем ошибку дальше
    }
}

// Закрытие соединения с базой данных
export async function closeDB() {
    await pool.end(); // Закрываем пул подключений
    console.log('Соединение с базой данных закрыто.');
}

// Инициализация базы данных: проверка и создание таблиц
checkAndCreateDB()
    .then(createTables)
    .catch(err => console.error("Database initialization error:", err));