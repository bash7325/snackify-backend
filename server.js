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
  try {
    const { username, password, role, name } = req.body;
    console.log("Received registration request:", req.body);  // Log the full request body

    // Check if username already exists (using await to ensure query completes)
    const existingUser = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM users WHERE username = ?', [username], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    console.log("Existing user query result:", existingUser); // Log the query result

    if (existingUser) {
      return res.status(409).json({ error: 'Username already exists' });
    }

    // Hash the password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Insert user into the database
    db.run(
      'INSERT INTO users (username, password, role, name) VALUES (?, ?, ?, ?)',
      [username, hashedPassword, role, name],
      function (err) { // Add callback for logging
        if (err) {
          console.error('Error inserting user:', err.message);
        } else {
          console.log('User registered successfully', this.lastID);
        }
        res.status(201).json({ message: 'User registered successfully', userId: this.lastID });
      }
    );

  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.get('/api/requests', (req, res) => {
db.all(`
SELECT sr.*, u.name AS user_name
FROM snack_requests sr
JOIN users u ON sr.user_id = u.id
ORDER BY
  CASE WHEN sr.ordered_flag = 1 THEN sr.ordered_at ELSE sr.created_at END DESC
`, (err, rows) => {
  if (err) {
    console.error('Error fetching requests:', err.message);
    res.status(500).json({ error: 'Failed to fetch snack requests' });
  } else {
    res.json(rows);
  }
});
});

app.get('/api/requests/user/:userId', (req, res) => {
const userId = req.params.userId;

db.all('SELECT * FROM snack_requests WHERE user_id = ? ORDER BY created_at desc', [userId], (err, rows) => {
  if (err) {
    console.error('Error fetching user requests:', err.message);
    res.status(500).json({ error: 'Failed to fetch snack requests' });
  } else {
    res.json(rows);
  }
});
});


app.post('/api/requests', async (req, res) => {
  const client = await pool.connect();
  try {
    const { user_id, snack, drink, misc, link } = req.body;
    console.log('Received snack request:', req.body);

    const result = await client.query(
      'INSERT INTO snack_requests (user_id, snack, drink, misc, link, created_at) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP) RETURNING *', 
      [user_id, snack, drink, misc, link]
    );
    res.status(201).json(result.rows[0]); 

  } catch (err) {
    console.error('Error creating request:', err.stack); 
    res.status(500).json({ error: 'Failed to create snack request' });
  } finally {
    client.release();
  }
});


app.put('/api/requests/:id/order', (req, res) => {
  const requestId = req.params.id;
  const newOrderedStatus = req.body.ordered ? 1 : 0; // Convert boolean to 1 or 0

  // Update the table column name
  db.run(      'UPDATE snack_requests SET ordered_flag = ?, ordered_at = datetime("now", "localtime") WHERE id = ?', [newOrderedStatus, requestId], function(err) {
    if (err) {
      console.error('Error updating request:', err.message);
      res.status(500).json({ error: 'Failed to update snack request' });
    } else {
      res.json({ message: 'Snack request updated successfully' });
    }
  });
});

app.put('/api/requests/:id/keep', (req, res) => {
  const requestId = req.params.id;
  const keepOnHand = req.body.keep_on_hand ? 1 : 0;

  db.run('UPDATE snack_requests SET keep_on_hand = ? WHERE id = ?', [keepOnHand, requestId], function(err) {
    if (err) {
      console.error('Error updating request:', err.message);
      res.status(500).json({ error: 'Failed to update snack request' });
    } else {
      res.json({ message: 'Snack request updated successfully' });
    }
  });
});


app.delete('/api/requests/:id', (req, res) => {
  const requestId = req.params.id;

  db.run('DELETE FROM snack_requests WHERE id = ?', requestId, function(err) {
    if (err) {
      console.error('Error deleting request:', err.message);
      res.status(500).json({ error: 'Failed to delete snack request' });
    } else {
      res.json({ message: 'Snack request deleted successfully' });
    }
  });
});



// Login Route (with async/await and password comparison)
app.post('/api/login', async (req, res) => {
  try {
      const { username, password } = req.body;

      const row = await new Promise((resolve, reject) => { // Promisify db.get
          db.get('SELECT * FROM users WHERE username = ?', [username], (err, row) => {
              if (err) reject(err);
              else resolve(row);
          });
      });
      
      if (!row) {
          return res.status(401).json({ error: 'Invalid username or password' });
      }
      
      const passwordMatch = await bcrypt.compare(password, row.password); 
      if (passwordMatch) {
          // Login successful - send relevant user data, excluding password
          res.json(row);
      } else {
          res.status(401).json({ error: 'Invalid username or password' });
      }
  } catch (err) {
      console.error(err.message);
      res.status(500).json({ error: 'Internal server error' });
  }
});


app.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});
