require('dotenv').config();

const express = require('express');
const cors = require('cors');
const documentRoutes = require('./routes/documents');
const qaRoutes = require('./routes/qa');
const configRoutes = require('./routes/config');
const app = express();


app.use(cors());
app.use(express.json());


app.get('/health', (req, res) => {
    res.json({
        status:'ok',
        service:'express'
        });
    }
);


app.use('/api/documents',documentRoutes);
app.use('/api/qa',qaRoutes);
app.use('/api/config',configRoutes);

const PORT = process.env.PORT || 3000;


app.listen(PORT,() => {
        console.log(`Express running at http://127.0.0.1:${PORT}`);
    }
);