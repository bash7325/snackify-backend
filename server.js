require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const app = express();
const port = process.env.PORT || 3000;
const allowedOrigins = ['https://production.d3wunp31todap.amplifyapp.com'];

// Database Setup (PostgreSQL) - Moved outside any functions
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } // for local development
});

pool.on('error', (err, client) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

// Test database connection (Ensure this is outside of the db.serialize block)
(async () => {
  const client = await pool.connect();
  try {
    const result = await client.query('SELECT NOW()');
    console.log('Connected to PostgreSQL database:', result.rows[0]);
  } catch (err) {
    console.error('Error connecting to PostgreSQL database:', err);
  } finally {
    client.release(); // Release the connection
  }
})();

// Create Tables (Async/Await Version) - Moved outside of the db.serialize block
async function createTables() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT DEFAULT 'user',
        name TEXT NOT NULL
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS snack_requests (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        snack TEXT,
        drink TEXT,
        misc TEXT,
        link TEXT,
        ordered_flag INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        ordered_at TIMESTAMP DEFAULT NULL,
        keep_on_hand INTEGER DEFAULT 0
      );
    `);
    console.log('Tables created or already exist');
  } catch (err) {
    console.error('Error creating tables:', err);
  } finally {
    client.release();
  }
}

createTables(); // Call the function to create tables

// Middleware
app.use(cors({
  origin: function (origin, callback) {
    // Check if origin is allowed or if it's a preflight request
    console.log('Origin received:', origin); // Add this log statement
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.options('/api/login', cors(), (req, res) => {
  console.log('OPTIONS request for /api/login'); // This should log now
  res.sendStatus(200);
});

app.use(bodyParser.json());

// Routes
// Registration Route
app.post('/api/register', async (req, res) => {
  const client = await pool.connect();
  try {
    const { username, password, role = 'user', name } = req.body;
    console.log("Received registration request:", req.body); 

    // Check if username already exists
    const existingUserResult = await client.query(
      'SELECT * FROM users WHERE username = $1', [username]
    );

    if (existingUserResult.rows.length > 0) {
      return res.status(409).json({ error: 'Username already exists' });
    }

    // Hash the password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Insert user into the database (using numbered placeholders)
    const result = await client.query(
      'INSERT INTO users (username, password, role, name) VALUES ($1, $2, $3, $4) RETURNING *', 
      [username, hashedPassword, role, name]
    );
    res.status(201).json({ message: 'User registered successfully', userId: result.rows[0].id });

  } catch (err) {
    console.error('Error inserting user:', err.stack); 
    res.status(500).json({ error: 'Registration failed' });
  } finally {
    client.release();
  }
});

app.get('/api/requests', async (req, res) => { // Use async here
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT sr.*, u.name AS user_name 
      FROM snack_requests sr
      JOIN users u ON sr.user_id = u.id
      ORDER BY
        CASE WHEN sr.ordered_flag = 1 THEN sr.ordered_at ELSE sr.created_at END DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching requests:', err);
    res.status(500).json({ error: 'Failed to fetch snack requests' });
  } finally {
    client.release();
  }
});
app.get('/api/requests/user/:userId', async (req, res) => {
  const userId = req.params.userId;

  const client = await pool.connect();
  try {
    const result = await client.query(
      'SELECT * FROM snack_requests WHERE user_id = $1 ORDER BY created_at desc', 
      [userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching user requests:', err);
    res.status(500).json({ error: 'Failed to fetch snack requests' });
  } finally {
    client.release();
  }
});

app.post('/api/requests', async (req, res) => {
  const client = await pool.connect();
  try {
    const { user_id, snack, drink, misc, link } = req.body;

    const result = await client.query(
      'INSERT INTO snack_requests (user_id, snack, drink, misc, link, created_at) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP) RETURNING *',
      [user_id, snack, drink, misc, link] // Removed ordered_at
    );

    if (result.rowCount > 0) {
      console.log('Successfully inserted snack request:', result.rows[0]);
      res.status(201).json({ message: 'Snack request created successfully', request: result.rows[0] });
    } else {
      console.error('No rows were inserted.');
      res.status(500).json({ error: 'Failed to create snack request' });
    }
  } catch (err) {
    console.error('Error creating request:', err.stack);
    res.status(500).json({ error: 'Failed to create snack request' });
  } finally {
    client.release();
  }
});


app.put('/api/requests/:id/order', async (req, res) => {
  const client = await pool.connect();
  try {
    const requestId = req.params.id;
    const newOrderedStatus = req.body.ordered ? 1 : 0;
  
    const result = await client.query(
      'UPDATE snack_requests SET ordered_flag = $1, ordered_at = $2 WHERE id = $3 RETURNING *',
      [newOrderedStatus, newOrderedStatus === 1 ? new Date().toISOString() : null, requestId]
    );
  
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Snack request not found' });
    } else {
      res.json({ message: 'Snack request updated successfully' });
    }
  } catch (err) {
    console.error('Error updating request:', err);
    res.status(500).json({ error: 'Failed to update snack request' });
  } finally {
    client.release();
  }
});


app.put('/api/requests/:id/keep', async (req, res) => {
  const client = await pool.connect();
  try {
    const requestId = req.params.id;
    const keepOnHand = req.body.keep_on_hand ? 1 : 0;
  
    const result = await client.query(
      'UPDATE snack_requests SET keep_on_hand = $1 WHERE id = $2 RETURNING *',
      [keepOnHand, requestId]
    );
  
    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Snack request not found' });
    } else {
      res.json({ message: 'Snack request updated successfully' });
    }
  } catch (err) {
    console.error('Error updating request:', err);
    res.status(500).json({ error: 'Failed to update snack request' });
  } finally {
    client.release();
  }
});

app.delete('/api/requests/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    const requestId = req.params.id;
  
    const result = await client.query(
      'DELETE FROM snack_requests WHERE id = $1 RETURNING *',
      [requestId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Snack request not found' });
    } else {
      res.json({ message: 'Snack request deleted successfully' });
    }
  } catch (err) {
    console.error('Error deleting request:', err);
    res.status(500).json({ error: 'Failed to delete snack request' });
  } finally {
    client.release();
  }
});



app.post('/api/login', async (req, res) => {
  const client = await pool.connect();
  try {
    const { username, password } = req.body;

    const result = await client.query(
      'SELECT * FROM users WHERE username = $1', [username]
    );
    const row = result.rows[0]; 

    if (!row) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const passwordMatch = await bcrypt.compare(password, row.password);
    if (passwordMatch) {
      res.json(row); // Send the user object
    } else {
      res.status(401).json({ error: 'Invalid username or password' });
    }
  } catch (err) {
    console.error('Error logging in:', err.stack); 
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});



app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});
