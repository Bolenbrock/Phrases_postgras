import pg from 'pg';
import 'dotenv/config';

const { Pool } = pg;

// Извлекаем имя базы данных из DATABASE_URL
const dbName = process.env.DATABASE_URL.split('/').pop();

// Создаем пул подключений
const pool = new Pool({
    connectionString: process.env.DATABASE_URL, // Используем PROVIDED DATABASE_URL
});

// Проверка и создание базы данных
async function checkAndCreateDB() {
    const client = new pg.Client({
        connectionString: process.env.DATABASE_URL.replace(`/${dbName}`, ''),
    });
    try {
        await client.connect();
        const dbExists = await client.query(`SELECT 1 FROM pg_database WHERE datname=$1`, [dbName]);
        if (dbExists.rowCount === 0) {
            console.log(`Database "${dbName}" does not exist. Creating...`);
            await client.query(`CREATE DATABASE ${dbName}`);
            console.log(`Database "${dbName}" created successfully.`);
        } else {
            console.log(`Database "${dbName}" already exists.`);
        }
    } catch (err) {
        console.error('Error checking/creating database:', err);
        throw err;
    } finally {
        await client.end();
    }
}

// Создание необходимых таблиц
async function createTables() {
    const client = await pool.connect();
    try {
        console.log('Creating tables...');

        // Таблица categories
        await client.query(`
            CREATE TABLE IF NOT EXISTS categories (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL UNIQUE
            )
        `);

        // Таблица local_quotes
        await client.query(`
            CREATE TABLE IF NOT EXISTS local_quotes (
                id SERIAL PRIMARY KEY,
                text TEXT NOT NULL,
                author TEXT NOT NULL,
                category TEXT
            )
        `);

        // Таблица messages
        await client.query(`
            CREATE TABLE IF NOT EXISTS messages (
                id SERIAL PRIMARY KEY,
                text TEXT NOT NULL,
                chatId BIGINT NOT NULL,
                timestamp TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
            )
        `);

        // Таблица saved_quotes
        await client.query(`
            CREATE TABLE IF NOT EXISTS saved_quotes (
                id SERIAL PRIMARY KEY,
                text TEXT NOT NULL,
                category TEXT,
                chatId BIGINT NOT NULL,
                timestamp TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
            )
        `);

        // Таблица all_texts_fts
        await client.query(`
            CREATE TABLE IF NOT EXISTS all_texts_fts (
                text TEXT,
                chatId BIGINT,
                type TEXT,
                timestamp TIMESTAMP WITHOUT TIME ZONE,
                tsv tsvector GENERATED ALWAYS AS (to_tsvector('russian', text)) STORED
            )
        `);

        // Индекс для полнотекстового поиска
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_fts_text_search ON all_texts_fts USING GIN (tsv);
        `);

        console.log('Tables created successfully.');
    } catch (err) {
        console.error('Error creating tables:', err);
    } finally {
        client.release();
    }
}

// Заполнение категорий
async function fillCategories() {
    try {
        const rows = await runQuery('SELECT COUNT(*) AS count FROM categories');
        if (parseInt(rows[0].count) === 0) {
            const categories = ['Такое себе', 'Повседневное', 'Точно в цель'];
            for (const category of categories) {
                await runCommand('INSERT INTO categories (name) VALUES ($1)', [category]);
            }
            console.log('Categories added to the database.');
        }
    } catch (err) {
        console.error('Error filling categories:', err);
    }
}

// Инициализация базы данных
checkAndCreateDB()
    .then(createTables)
    .then(fillCategories)
    .catch(err => console.error("Database initialization error:", err));

// Выполнение SQL-запросов
export async function runQuery(query, params = []) {
    const client = await pool.connect();
    try {
        console.log(`Executing query: ${query} with params:`, params);
        const result = await client.query(query, params);
        return result.rows;
    } catch (error) {
        console.error('Error executing query:', error);
        throw error;
    } finally {
        client.release();
    }
}

// Выполнение SQL-команд
export async function runCommand(command, params = []) {
    const client = await pool.connect();
    try {
        console.log(`Executing command: ${command} with params:`, params);
        await client.query(command, params);
    } catch (error) {
        console.error('Error executing command:', error);
        throw error;
    } finally {
        client.release();
    }
}

// Добавление текста в FTS
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
        await runCommand(query, [text, chatId, type, timestamp]);
    } catch (error) {
        console.error('Error adding text to FTS:', error);
        throw error;
    }
}

// Сохранение цитаты
export async function saveQuote(chatId, text, category) {
    try {
        await runCommand(
            `INSERT INTO saved_quotes (text, category, chatId) VALUES ($1, $2, $3)`,
            [text, category, chatId]
        );
        await addTextToFTS(text, chatId, 'quote');
        console.log(`Цитата успешно сохранена в категорию "${category}". Текст: "${text}"`);
    } catch (error) {
        console.error('Ошибка при сохранении цитаты:', error);
        throw error;
    }
}

// Поиск цитат
export async function searchQuotesWithPagination(searchText, limit, offset) {
    const query = `
        SELECT text 
        FROM saved_quotes 
        WHERE LOWER(text) LIKE LOWER($1) 
        LIMIT $2 OFFSET $3
    `;
    const params = [`%${searchText.toLowerCase()}%`, limit, offset];
    try {
        console.log(`Searching quotes with query: ${query} and params:`, params);
        const rows = await runQuery(query, params);
        return rows.map(row => row.text);
    } catch (error) {
        console.error('Ошибка при поиске цитат:', error);
        throw error;
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
        return result[0] || null;
    } catch (error) {
        console.error('Ошибка при получении цитаты по ID:', error);
        throw error;
    }
}

// Удаление цитаты
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
        throw error;
    }
}

// Обновление цитаты
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
        throw error;
    }
}

// Закрытие соединения
export async function closeDB() {
    await pool.end();
    console.log('Соединение с базой данных закрыто.');
}
