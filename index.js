const express = require("express");
const bodyParser = require("body-parser");
const app = express();
const cors = require('cors');
const PORT = process.env.PORT || 3000;
const superagent = require('superagent');

const showdown = require('showdown');
const converter = new showdown.Converter({
	underline: true,
	noHeaderId: true,
	simplifiedAutoLink: true,
	strikethrough: true,
	tasklists: true,
	simpleLineBreaks: true,
	openLinksInNewWindow: true,
	backslashEscapesHTMLTags: true,
	emoji: true,
});
const Turndown = require('turndown');
const turndownService = new Turndown();

/* === Database Stuff === */
const fs = require('fs');
const { Sequelize, Model, DataTypes } = require('sequelize');
const sqlite3 = require('sqlite3');
const sequelize = new Sequelize({
	dialect: 'sqlite',
	storage: 'database/posts.sqlite3',
	logging: false
});

class Post extends Model { }
Post.init({
	id: { type: DataTypes.INTEGER, autoIncrement: true, allowNull: false, primaryKey: true },
	title: { type: DataTypes.STRING, allowNull: false },
	body: { type: DataTypes.STRING, allowNull: false },
	commentCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
	show: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }
}, { sequelize, modelName: 'post' });

class Comment extends Model { }
Comment.init({
	id: { type: DataTypes.INTEGER, autoIncrement: true, allowNull: false, primaryKey: true },
	postId: { type: DataTypes.INTEGER, allowNull: false },
	username: { type: DataTypes.STRING, allowNull: false },
	title: { type: DataTypes.STRING, allowNull: false },
	body: { type: DataTypes.STRING, allowNull: false }
}, { sequelize, modelName: 'comment' });

sequelize.sync();

const PASSWORD = process.env.PASSWORD, USERNAME = process.env.USERNAME;


app.use(cors({
	origin: ['https://spidergamin.github.io', 'http://localhost'],
	methods: ['GET', 'POST']
}));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

/* ===== Requests ===== */
app.get('/', function(req, res) {
	fs.readFile('index.html', 'binary', function(err, file) {
		if (err) return res.send({ error: 'Cannot find that page' });
		return res.send(file);
	});
});

app.get('/ping', async (req, res) => { return res.send('OK') });

app.post('/login', async (req, res) => {
	var d = req.body;
	if (!checkPass(d.password, d.username)) return res.send({ error: 'Incorrect pass or user' });
	return res.send(true);
});

/* === Get Posts === */
app.post('/posts', async (req, res) => {
	let d = req.body;
	if (d.get) {
		let posts = await postsF('get', {
			where: {
				id: d.get,
				show: true
			}
		});
		if (posts.error) return res.send({ error: posts.error });
		return res.send({ posts: posts });
	} else if (d.password) {
		if (!checkPass(d.password, d.username)) return res.send({ error: 'Incorrect pass or user' });
		let posts = await postsF('get', {
			offset: d.have,
			limit: d.amount,
			order: [['createdAt', 'DESC']]
		});
		if (posts.error) return res.send({ error: posts.error });
		return res.send({ posts: posts });
	} else {
		let posts = await postsF('get', {
			offset: d.have,
			limit: d.amount,
			where: {
				show: true
			},
			order: [['createdAt', 'DESC']]
		});
		if (posts.error) return res.send({ error: posts.error });
		return res.send({ posts: posts });
	};
});

/* === Get Comments === */
app.post('/comments', async (req, res) => {
	let d = req.body;
	if (!d || !d.postId || d.postId <= 0) return res.send({ error: 'Missing arguments' });
	let comments = await commentsF('get', {
		where: {
			postId: d.postId
		}
	});
	if (comments.error) return res.send({ error: comments.error + ' || Cannot get comments' });
	return res.send({ comments: comments });
});

/* === Create A Post === */
app.post('/post', async (req, res) => {
	let d = req.body;
	if (!d || !d.title || !d.body) return res.send({ error: 'You did not provide the correct data' });
	if (!checkPass(d.password, d.username)) return res.send({ error: 'Incorrect pass or user' });
	let posts = await postsF('create', {
		username: d.username,
		title: converter.makeHtml(d.title).replace('<p>', '').replace('</p>', ''),
		body: converter.makeHtml(d.body)
	});
	if (posts.error) return res.send({ error: posts.error });
	rss(posts, 'post');
	return res.send({ posts: posts });
});

/* === Create A Comment === */
app.post('/comment', async (req, res) => {
	let d = req.body;
	if (!d || !d.postId || !d.username || !d.body) return res.send({ error: 'Missing arguments' });
	if (d.username.toLowerCase().includes('spider')) return res.send({ error: 'You cannot use spider in your username' });

	let comment = await commentsF('create', {
		postId: d.postId,
		username: d.username,
		title: converter.makeHtml(d.title).replace('<p>', '').replace('</p>', '') || '',
		body: converter.makeHtml(d.body),
	});
	if (comment.error) return res.send({ error: comment.error + ' || Cannot create a comment' });

	let posts = await postsF('inc', { where: { id: d.postId } }, ['commentCount'], 1);
	if (posts.error) return res.send({ error: posts.error + ' || Cannot get post for comment' });

	rss(comment, 'comment');
	let comments = await commentsF('get', {where:{ postId: d.postId }});
	if (comments.error) return res.send({ error: comments.error });
	return res.send({ comments: comments, posts: posts });
});

/* === Hide/Unhide A Post === */
app.post('/hide', async (req, res) => {
	let d = req.body;
	if (!d || !d.postId) return res.send({ error: 'You did not provide all the arguments needed' });
	if (!checkPass(d.password, d.username)) return res.send({ error: 'Incorrect pass or user' });

	await Post.update({ show: d.show }, {
		where: {
			id: d.postId
		}
	});

	let posts = await postsF('get', { where: { id: d.postId } });
	if (posts.error) return res.send({ error: posts.error + ' || Cannot hide/unhide that post' });
	return res.send({ post: posts });
});

app.post('/suggest', async (req, res) => {
	let d = req.body;
	if (!d || !d.s || !d.username) return res.send({ error: 'Missing arguments' });

	superagent.post(`https://api.trello.com/1/cards?key=${process.env.KEY}&token=${process.env.TOKEN}&idList=${process.env.LIST}&name=${d.username + ': ' + d.s}&idLabels=5f28ee227669b22549c87d6c`)
		.end((err, res) => {
			if (err) return;
		});
	rss({ s: d.s, u: d.username }, 'suggestion');
	return res.send({ info: `Your suggestion '${d.s}' was sucessfully sent to the Trello Board` });
});


/* ===== Functions ===== */

async function postsF(action, options) {
	function clean(posts) {
		var p = [];
		try {
			posts.forEach(post => {
				p.push({
					id: post.id,
					title: post.title,
					body: post.body,
					commentCount: post.commentCount,
					date: date(post.createdAt)
				});
			});
		} catch (err) {
			try {
				p.push({
					id: posts.id,
					title: posts.title,
					body: posts.body,
					commentCount: posts.commentCount,
					date: date(posts.createdAt)
				});
			} catch (err) {
				return err;
			}
		}
		return p;
	};
	switch (action) {
		case 'get': {
			let posts = await clean(await Post.findAll(options));
			if (posts.length === 0) return [{ title: 'no posts' }];
			return posts;
		}
		case 'create': {
			let posts = await clean(await Post.create(options));
			if (posts.length === 0) return { error: 'Failed to create post' };
			return posts;
		}
		case 'inc': {
			let post = await Post.findAll(options);
			post[0].increment(arguments[2], { by: arguments[3] });
			return postsF('get', options);
		}
		default: {
			return await Post.findAll();
		}
	}
};

async function commentsF(action, options) {
	function clean(comments) {
		var c = [];
		try {
			comments.forEach(comment => {
				c.push({
					id: comment.id,
					postId: comment.postId,
					username: comment.username,
					title: comment.title || '',
					body: comment.body,
					date: date(comment.createdAt)
				});
			});
		} catch (err) {
			try {
				c.push({
					id: comments.id,
					postId: comments.postId,
					username: comments.username,
					title: comments.title,
					body: comments.body,
					date: date(comments.createdAt)
				})
			} catch (err) {
				return err;
			}
		}
		return c;
	};
	switch (action) {
		case 'get': {
			let comments = await clean(await Comment.findAll(options));
			if (comments.length === 0) return [{ title: 'no comments' }];
			return comments;
		}
		case 'create': {
			let comments = await clean(await Comment.create(options));
			if (comments.length === 0) return { error: 'Failed to create comment' };
			return comments;
		}
		default: {
			return await clean(await Comment.findAll());
		}
	}
};

async function checkPass(p, u) {
	if (p !== PASSWORD || u !== USERNAME) return false;
	return true;
};

function date(date) {
	let d = new Date(date);
	let utc = d.getTime() + (d.getTimezoneOffset() * 60000);
	let nd = new Date(utc + (3600000 * -7));
	let dateDone = nd.toLocaleDateString('en-US', { weekday: 'long' }).slice(0, 3);
	dateDone += ' ' + nd.toLocaleString().slice(0, 10).replace(',', '');
	dateDone += ' ' + nd.toLocaleString().slice(10, 22);
	return dateDone;
};

async function rss(data, type) {
	if (type === 'suggestion') {
		return superagent
			.post(process.env.WEBHOOKS)
			.send({
				embeds: [
					{
						title: 'Suggestion Created',
						description: data.s,
						url: `https://trello.com/b/BKwdwxpC/website`,
						footer: {
							text: `${data.u || 'Unknown'} ${type}ed | Suggestion`
						},
						timestamp: new Date(),
						color: 16776960
					}
				]
			})
			.set('accept', 'json')
			.end((err, res) => {
				if (err) return;
				return;
			});
	}
	superagent
		.post(process.env.WEBHOOKS)
		.send({
			embeds: [
				{
					title: turndownService.turndown(data[0].title) || 'No Title',
					description: turndownService.turndown(data[0].body),
					url: `https://spidergamin.github.io?l=posts-${data[0].postId || data[0].id}`,
					footer: {
						text: `${data[0].username || 'SpiderGaming'} ${type}ed | Post ${data[0].postId || data[0].id}`
					},
					timestamp: data[0].createdAt,
					color: 16711680
				}
			]
		})
		.set('accept', 'json')
		.end((err, res) => {
			if (err) return;
			return;
		});
}


/* JSON file send */
app.get('/links.json', function(req, res) {
	fs.readFile('links.json', (err, file) => {
		if (err) return res.send({ error: 'Failed to load json file' });
		return res.send(file);
	});
});

app.get('/lists.json', (req, res) => {
	fs.readFile('lists.json', (err, file) => {
		if (err) return res.send({ error: 'Failed to load json file' });
		return res.send(file);
	});
});


const server = app.listen(PORT, function() {
	console.log("Listening on port %s", server.address().port);
});