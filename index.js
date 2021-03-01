const express = require("express");
const bodyParser = require("body-parser");
const app = express();
const cors = require('cors');
const PORT = process.env.PORT || 3000;


app.use(cors({
	origin: ['https://insberr.github.io', 'https://uptimerbot.com'],
	methods: ['GET', 'POST']
}));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));


/* ===== Requests ===== */
app.get('/ping', async (req, res) => { return res.send('OK') });

const server = app.listen(PORT, function() {
	console.log("Server started on port %s", server.address().port);
});