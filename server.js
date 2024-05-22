const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt'); // For password hashing

const app = express();
const port = 3000;

// Database Setup
const db = new sqlite3.Database('snack_requests.db', (err) => {
    if (err) {
        console.error(err.message);
    }
    console.log('Connected to the snack_requests database.');
});

db.serialize(() => {

    // Create the users table
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT DEFAULT 'user', 
        name TEXT NOT NULL
      )
    `);

    // Create the snack_requests table
    db.run(`
    CREATE TABLE IF NOT EXISTS snack_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER, 
        snack TEXT,
        drink TEXT,
        misc TEXT,
        link TEXT,
        ordered_flag INTEGER DEFAULT 0,
        created_at TEXT,
        ordered_at TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )
    `);
});

// Middleware
app.use(cors());
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
  try {
      const { user_id, snack, drink, misc, link } = req.body;
      console.log('Received snack request:', req.body);

      const result = await db.run(
        'INSERT INTO snack_requests (user_id, snack, drink, misc, link, created_at) VALUES (?, ?, ?, ?, ?, datetime("now", "localtime"))',
          [user_id, snack, drink, misc, link],
          function (err) {
              if (err) {
                  console.error('Error creating request:', err.message);
                  res.status(500).json({ error: 'Failed to create snack request' });
              } else {
                  res.status(201).json({
                      id: this.lastID, 
                      user_id,
                      snack, 
                      drink, 
                      misc, 
                      link 
                  });
              }
          }
      );
  } catch (err) {
      console.error(err.message);
      res.status(500).json({ error: 'Failed to create snack request' });
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
